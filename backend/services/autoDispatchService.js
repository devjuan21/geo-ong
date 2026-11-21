const pool = require('../models/db');
const { computeHaversineMeters } = require('../config/arrivalConfig');
const { emitAssignmentUpdate, emitStatusUpdate } = require('./socketService');

async function fetchOsrmRoadDistanceMeters(originLat, originLng, destLat, destLng) {
  if (
    !Number.isFinite(originLat) ||
    !Number.isFinite(originLng) ||
    !Number.isFinite(destLat) ||
    !Number.isFinite(destLng)
  ) {
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${originLng},${originLat};${destLng},${destLat}?overview=false`;
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
    if (!res.ok) return null;
    const data = await res.json();
    if (data && data.code === 'Ok' && Array.isArray(data.routes) && data.routes[0] && Number.isFinite(data.routes[0].distance)) {
      return Number(data.routes[0].distance);
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function selectBestEligibleResponder(conn, destLat, destLng) {
  const [candidates] = await conn.query(
    `SELECT u.id, u.name, u.email,
            rp.availability_status, rp.current_latitude, rp.current_longitude, rp.last_location_updated_at,
            (
              (SELECT COUNT(*) FROM incident_assignments ia WHERE ia.responder_user_id = u.id AND ia.assignment_status <> 'Completed') +
              (SELECT COUNT(*) FROM rescue_assignments ra WHERE ra.responder_user_id = u.id AND ra.assignment_status <> 'Completed')
            )::int AS active_assignments_count
     FROM users u
     JOIN roles r ON u.role_id = r.id
     LEFT JOIN responder_profiles rp ON rp.user_id = u.id
     WHERE u.status = 'active'
       AND LOWER(r.name) = 'responder'
       AND COALESCE(rp.availability_status, 'On Duty') = 'On Duty'
     ORDER BY active_assignments_count ASC, u.id ASC`
  );

  const idleCandidates = candidates.filter((c) => Number(c.active_assignments_count || 0) === 0);
  if (idleCandidates.length === 0) {
    return null;
  }
  if (idleCandidates.length === 1) {
    return idleCandidates[0];
  }

  const hasDest = Number.isFinite(Number(destLat)) && Number.isFinite(Number(destLng));
  const scored = await Promise.all(
    idleCandidates.map(async (c) => {
      const rLat = c.current_latitude !== null && c.current_latitude !== undefined ? Number(c.current_latitude) : null;
      const rLng = c.current_longitude !== null && c.current_longitude !== undefined ? Number(c.current_longitude) : null;
      const hasGps = Number.isFinite(rLat) && Number.isFinite(rLng) && !(rLat === 0 && rLng === 0);
      let distanceMeters = Number.POSITIVE_INFINITY;
      if (hasDest && hasGps) {
        const osrmDist = await fetchOsrmRoadDistanceMeters(rLat, rLng, Number(destLat), Number(destLng));
        distanceMeters = osrmDist !== null ? osrmDist : computeHaversineMeters(rLat, rLng, Number(destLat), Number(destLng));
      }
      return { candidate: c, hasGps, distanceMeters };
    })
  );

  scored.sort((a, b) => {
    if (a.hasGps !== b.hasGps) return a.hasGps ? -1 : 1;
    if (a.distanceMeters !== b.distanceMeters) return a.distanceMeters - b.distanceMeters;
    return Number(a.candidate.id) - Number(b.candidate.id);
  });

  return scored[0].candidate;
}

async function notifyAdminsUnassignedQueue(conn, refCode, kindLabel, actorUserId) {
  const [notifRes] = await conn.query(
    `INSERT INTO notifications (title, message, category, created_by)
     VALUES (?, ?, 'Alert', ?)`,
    [
      `Unassigned ${kindLabel} Queue: ${refCode}`,
      `No On-Duty idle responder is currently available for ${refCode}. Queued for automatic dispatch retry.`,
      actorUserId,
    ]
  );
  const [adminUsers] = await conn.query(
    `SELECT u.id FROM users u JOIN roles r ON u.role_id = r.id WHERE LOWER(r.name) IN ('admin', 'administrator') AND u.status = 'active'`
  );
  for (const adm of adminUsers) {
    await conn.query(
      `INSERT INTO notification_recipients (notification_id, user_id) VALUES (?, ?)`,
      [notifRes.insertId, adm.id]
    );
  }
}

async function autoDispatchIncident(reportId, actorUserId = null) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [reportRows] = await conn.query(
      `SELECT * FROM reports WHERE id = ? LIMIT 1 FOR UPDATE`,
      [reportId]
    );
    if (!reportRows.length) {
      await conn.rollback();
      return { assigned: false, reason: 'not_found' };
    }

    const reportRow = reportRows[0];
    const st = String(reportRow.status || '').toLowerCase();
    if (['resolved', 'false_alarm', 'dismissed'].includes(st)) {
      await conn.rollback();
      return { assigned: false, reason: 'closed_or_rejected' };
    }

    const [existingAssign] = await conn.query(
      `SELECT id FROM incident_assignments WHERE report_id = ? AND assignment_status <> 'Completed' LIMIT 1 FOR UPDATE`,
      [reportRow.id]
    );
    if (reportRow.assigned_to || existingAssign.length > 0) {
      await conn.rollback();
      return { assigned: false, reason: 'already_assigned' };
    }

    const responder = await selectBestEligibleResponder(conn, reportRow.latitude, reportRow.longitude);
    const refCode = reportRow.reference_number || `INC-${reportRow.id}`;
    if (!responder) {
      await notifyAdminsUnassignedQueue(conn, refCode, 'Incident', actorUserId || reportRow.user_id || 1);
      await conn.commit();
      return { assigned: false, reason: 'no_eligible_responder' };
    }

    const [assignResult] = await conn.query(
      `INSERT INTO incident_assignments (
         report_id, responder_user_id, assigned_by, assignment_status, dispatch_instructions,
         assigned_at, accepted_at
       )
       VALUES (?, ?, ?, 'Accepted', 'Automatically dispatched. Proceed directly to incident coordinates.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [reportRow.id, responder.id, actorUserId || responder.id]
    );

    const nextReportStatus = ['pending', 'verified'].includes(st) ? 'dispatched' : reportRow.status;
    await conn.query(
      `UPDATE reports
       SET assigned_to = ?,
           status = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [responder.id, nextReportStatus, reportRow.id]
    );

    await conn.query(
      `INSERT INTO incident_updates (report_id, responder_user_id, status_update, work_notes, is_internal_only)
       VALUES (?, ?, 'Accepted', ?, FALSE)`,
      [reportRow.id, responder.id, `Automatically dispatched to ${responder.name || 'Responder'}.`]
    );

    await conn.query(
      `INSERT INTO incident_status_history (incident_id, old_status, new_status, changed_by, remarks)
       VALUES (?, ?, ?, ?, ?)`,
      [reportRow.id, reportRow.status, nextReportStatus, responder.id, `Automatic dispatch to ${responder.name || 'Responder'}`]
    );

    const [notifRes] = await conn.query(
      `INSERT INTO notifications (title, message, category, created_by)
       VALUES (?, ?, 'Alert', ?)`,
      [
        `Auto-Dispatched Incident: ${refCode}`,
        `${responder.name || 'Responder'} has been automatically assigned to ${refCode}.`,
        responder.id,
      ]
    );

    const [adminUsers] = await conn.query(
      `SELECT u.id FROM users u JOIN roles r ON u.role_id = r.id WHERE LOWER(r.name) IN ('admin', 'administrator') AND u.status = 'active'`
    );
    const recipientIds = new Set(adminUsers.map((u) => Number(u.id)));
    recipientIds.add(Number(responder.id));
    if (reportRow.user_id) recipientIds.add(Number(reportRow.user_id));

    for (const rid of recipientIds) {
      await conn.query(
        `INSERT INTO notification_recipients (notification_id, user_id) VALUES (?, ?)`,
        [notifRes.insertId, rid]
      );
    }

    await conn.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_values)
       VALUES (?, 'AUTO_DISPATCH_INCIDENT', 'reports', ?, ?)`,
      [responder.id, reportRow.id, JSON.stringify({ assignment_id: assignResult.insertId, responder_user_id: responder.id, status: nextReportStatus })]
    );

    await conn.commit();

    emitAssignmentUpdate({
      assignmentId: assignResult.insertId,
      reportId: reportRow.id,
      assignmentType: 'incident',
      referenceNumber: refCode,
      responderId: responder.id,
      responderName: responder.name || 'Responder',
      assignmentStatus: 'Accepted',
      status: 'Accepted',
      userId: reportRow.user_id,
    });

    emitStatusUpdate({
      reportId: reportRow.id,
      assignmentType: 'incident',
      referenceNumber: refCode,
      userId: reportRow.user_id,
      status: nextReportStatus,
      assignmentStatus: 'Accepted',
      updatedBy: responder.name || 'Auto-Dispatch',
    });

    return {
      assigned: true,
      assignmentId: assignResult.insertId,
      responderId: responder.id,
      responderName: responder.name,
    };
  } catch (err) {
    try { await conn.rollback(); } catch {}
    console.error('[AutoDispatch] autoDispatchIncident failed:', err.message);
    return { assigned: false, reason: 'error', error: err.message };
  } finally {
    conn.release();
  }
}

async function autoDispatchRescue(rescueId, actorUserId = null) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rescueRows] = await conn.query(
      `SELECT * FROM rescue_requests WHERE id = ? LIMIT 1 FOR UPDATE`,
      [rescueId]
    );
    if (!rescueRows.length) {
      await conn.rollback();
      return { assigned: false, reason: 'not_found' };
    }

    const rescueRow = rescueRows[0];
    if (['Completed', 'Cancelled'].includes(String(rescueRow.status || ''))) {
      await conn.rollback();
      return { assigned: false, reason: 'closed_or_cancelled' };
    }

    const [existingAssign] = await conn.query(
      `SELECT id FROM rescue_assignments WHERE rescue_id = ? AND assignment_status <> 'Completed' LIMIT 1 FOR UPDATE`,
      [rescueRow.id]
    );
    if (existingAssign.length > 0) {
      await conn.rollback();
      return { assigned: false, reason: 'already_assigned' };
    }

    const responder = await selectBestEligibleResponder(conn, rescueRow.latitude, rescueRow.longitude);
    const refCode = rescueRow.reference_number || `RES-${rescueRow.id}`;
    if (!responder) {
      await notifyAdminsUnassignedQueue(conn, refCode, 'Rescue', actorUserId || rescueRow.user_id || 1);
      await conn.commit();
      return { assigned: false, reason: 'no_eligible_responder' };
    }

    const [assignResult] = await conn.query(
      `INSERT INTO rescue_assignments (
         rescue_id, responder_user_id, assigned_by, assignment_status, dispatch_instructions,
         assigned_at, accepted_at
       )
       VALUES (?, ?, ?, 'Accepted', 'Automatically dispatched. Proceed directly to rescue coordinates.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [rescueRow.id, responder.id, actorUserId || responder.id]
    );

    await conn.query(
      `UPDATE rescue_requests
       SET status = 'Accepted',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [rescueRow.id]
    );

    await conn.query(
      `INSERT INTO rescue_updates (rescue_id, responder_user_id, status_update, work_notes, is_internal_only)
       VALUES (?, ?, 'Accepted', ?, FALSE)`,
      [rescueRow.id, responder.id, `Automatically dispatched to ${responder.name || 'Responder'}.`]
    );

    await conn.query(
      `INSERT INTO rescue_status_history (rescue_id, old_status, new_status, changed_by, work_notes)
       VALUES (?, ?, 'Accepted', ?, ?)`,
      [rescueRow.id, rescueRow.status, responder.id, `Automatic dispatch to ${responder.name || 'Responder'}`]
    );

    const [notifRes] = await conn.query(
      `INSERT INTO notifications (title, message, category, created_by)
       VALUES (?, ?, 'Alert', ?)`,
      [
        `Auto-Dispatched Rescue: ${refCode}`,
        `${responder.name || 'Responder'} has been automatically dispatched to rescue request ${refCode}.`,
        responder.id,
      ]
    );

    const [adminUsers] = await conn.query(
      `SELECT u.id FROM users u JOIN roles r ON u.role_id = r.id WHERE LOWER(r.name) IN ('admin', 'administrator') AND u.status = 'active'`
    );
    const recipientIds = new Set(adminUsers.map((u) => Number(u.id)));
    recipientIds.add(Number(responder.id));
    if (rescueRow.user_id) recipientIds.add(Number(rescueRow.user_id));

    for (const rid of recipientIds) {
      await conn.query(
        `INSERT INTO notification_recipients (notification_id, user_id) VALUES (?, ?)`,
        [notifRes.insertId, rid]
      );
    }

    await conn.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_values)
       VALUES (?, 'AUTO_DISPATCH_RESCUE', 'rescue_requests', ?, ?)`,
      [responder.id, rescueRow.id, JSON.stringify({ assignment_id: assignResult.insertId, responder_user_id: responder.id, status: 'Accepted' })]
    );

    await conn.commit();

    emitAssignmentUpdate({
      assignmentId: assignResult.insertId,
      rescueId: rescueRow.id,
      assignmentType: 'rescue',
      referenceNumber: refCode,
      responderId: responder.id,
      responderName: responder.name || 'Responder',
      assignmentStatus: 'Accepted',
      status: 'Accepted',
      userId: rescueRow.user_id,
    });

    emitStatusUpdate({
      rescueId: rescueRow.id,
      assignmentType: 'rescue',
      referenceNumber: refCode,
      userId: rescueRow.user_id,
      status: 'Accepted',
      assignmentStatus: 'Accepted',
      updatedBy: responder.name || 'Auto-Dispatch',
    });

    return {
      assigned: true,
      assignmentId: assignResult.insertId,
      responderId: responder.id,
      responderName: responder.name,
    };
  } catch (err) {
    try { await conn.rollback(); } catch {}
    console.error('[AutoDispatch] autoDispatchRescue failed:', err.message);
    return { assigned: false, reason: 'error', error: err.message };
  } finally {
    conn.release();
  }
}

async function retryPendingAutoDispatches() {
  try {
    const [pendingRescues] = await pool.query(
      `SELECT rr.id
       FROM rescue_requests rr
       LEFT JOIN rescue_assignments ra ON ra.rescue_id = rr.id AND ra.assignment_status <> 'Completed'
       WHERE rr.status NOT IN ('Completed', 'Cancelled')
         AND ra.id IS NULL
       ORDER BY rr.created_at ASC
       LIMIT 10`
    );
    for (const row of pendingRescues) {
      const res = await autoDispatchRescue(row.id);
      if (!res.assigned && res.reason === 'no_eligible_responder') break;
    }

    const [pendingIncidents] = await pool.query(
      `SELECT r.id
       FROM reports r
       LEFT JOIN incident_assignments ia ON ia.report_id = r.id AND ia.assignment_status <> 'Completed'
       WHERE r.status IN ('pending', 'verified')
         AND r.assigned_to IS NULL
         AND ia.id IS NULL
       ORDER BY r.created_at ASC
       LIMIT 10`
    );
    for (const row of pendingIncidents) {
      const res = await autoDispatchIncident(row.id);
      if (!res.assigned && res.reason === 'no_eligible_responder') break;
    }
  } catch (err) {
    console.error('[AutoDispatch] retryPendingAutoDispatches failed:', err.message);
  }
}

module.exports = {
  autoDispatchIncident,
  autoDispatchRescue,
  retryPendingAutoDispatches,
};
