const defaultPool = require('../models/db');
const { emitIncidentResolvedCommunityNotification } = require('./socketService');

const RETRY_DELAYS_MS = [2000, 5000, 15000];

function formatResolvedTimestamp(resolvedAt) {
  const d = resolvedAt ? new Date(resolvedAt) : new Date();
  if (Number.isNaN(d.getTime())) return new Date().toLocaleString('en-PH');
  return d.toLocaleString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatIncidentResolvedMessage({
  incidentCategory,
  verifiedLocation,
  referenceNumber,
  resolvedAt,
}) {
  const category = String(incidentCategory || 'Community').trim() || 'Community';
  const location = String(verifiedLocation || 'Barangay Bayanan').trim() || 'Barangay Bayanan';
  const refPart = referenceNumber ? `Ref: ${String(referenceNumber).trim()}` : '';
  const timePart = `Resolved: ${formatResolvedTimestamp(resolvedAt)}`;
  const meta = [refPart, timePart].filter(Boolean).join(' • ');
  return `The reported ${category} incident in ${location} has been marked as resolved. Thank you for your cooperation.${meta ? ` (${meta})` : ''}`;
}

async function logBroadcastFailure(pool, { incidentId, referenceNumber, actorUserId, errorMessage }) {
  try {
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_values)
       VALUES (?, 'INCIDENT_RESOLVED_BROADCAST_FAILED', 'reports', ?, ?)`,
      [
        actorUserId || null,
        String(referenceNumber || incidentId || ''),
        JSON.stringify({ incidentId, error: String(errorMessage || 'Unknown error') }),
      ]
    );
  } catch (auditErr) {
    console.error('[IncidentResolutionService] Failed to write audit_logs:', auditErr.message);
  }
}

/**
 * Persist and emit an idempotent "Incident Resolved" community notification
 * to all eligible active Resident accounts after an incident is confirmed resolved in PostgreSQL.
 */
async function broadcastIncidentResolvedCommunityNotification(
  {
    incidentId,
    referenceNumber = null,
    incidentCategory = null,
    verifiedLocation = null,
    resolvedAt = null,
    actorUserId = null,
  },
  options = {}
) {
  const pool = options.pool || defaultPool;
  const emitFn = options.emitFn || emitIncidentResolvedCommunityNotification;
  const numericIncidentId = Number(incidentId);

  if (!Number.isInteger(numericIncidentId) || numericIncidentId <= 0) {
    return { created: false, reason: 'invalid_incident_id' };
  }

  // Verify from PostgreSQL that the incident in `reports` is genuinely resolved
  const [reportRows] = await pool.query(
    `SELECT id, reference_number, incident_type, address, status, resolved_at
     FROM reports
     WHERE id = ?`,
    [numericIncidentId]
  );

  const report = reportRows && reportRows[0];
  if (!report) {
    return { created: false, reason: 'incident_not_found' };
  }
  if (String(report.status || '').toLowerCase() !== 'resolved') {
    return { created: false, reason: 'incident_not_resolved' };
  }

  const finalRef = referenceNumber || report.reference_number || `INC-${numericIncidentId}`;
  const finalCategory = incidentCategory || report.incident_type || 'Incident';
  const finalLocation = verifiedLocation || report.address || 'Barangay Bayanan';
  const finalResolvedAt = resolvedAt || report.resolved_at || new Date().toISOString();

  const message = formatIncidentResolvedMessage({
    incidentCategory: finalCategory,
    verifiedLocation: finalLocation,
    referenceNumber: finalRef,
    resolvedAt: finalResolvedAt,
  });

  const conn = await pool.getConnection();
  let notificationId = null;
  let recipientIds = [];

  try {
    await conn.beginTransaction();

    // Idempotent insert: at most ONE 'incident_resolved' notification per resolved incident
    const [notifRows] = await conn.query(
      `INSERT INTO notifications (
         title, message, category, severity, action_url, related_entity_type, related_entity_id, created_by
       )
       VALUES (?, ?, 'Incident', 'Info', 'index.html', 'incident_resolved', ?, ?)
       ON CONFLICT (related_entity_type, related_entity_id)
         WHERE related_entity_type = 'incident_resolved' AND related_entity_id IS NOT NULL
       DO NOTHING
       RETURNING id`,
      ['Incident Resolved', message, numericIncidentId, actorUserId || null]
    );

    if (!notifRows || !notifRows.length || !notifRows[0].id) {
      await conn.rollback();
      return { created: false, duplicate: true, incidentId: numericIncidentId };
    }

    notificationId = notifRows[0].id;

    // Fan out ONLY to eligible active Resident accounts (canonical role 'resident' / role_id = 3)
    const [recipientRows] = await conn.query(
      `INSERT INTO notification_recipients (notification_id, user_id, is_read)
       SELECT ?, u.id, FALSE
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE (LOWER(r.name) = 'resident' OR u.role_id = 3)
         AND LOWER(COALESCE(u.status, '')) = 'active'
         AND LOWER(COALESCE(u.account_status, '')) = 'active'
       ON CONFLICT (notification_id, user_id) DO NOTHING
       RETURNING user_id`,
      [notificationId]
    );

    recipientIds = (recipientRows || []).map((r) => Number(r.user_id)).filter(Boolean);
    await conn.commit();
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }

  let deliveredCount = 0;
  try {
    if (recipientIds.length > 0 && typeof emitFn === 'function') {
      deliveredCount = emitFn(recipientIds, {
        notificationId,
        title: 'Incident Resolved',
        message,
        category: 'incident',
        incidentId: numericIncidentId,
        referenceNumber: finalRef,
        incidentType: finalCategory,
        location: finalLocation,
        resolvedAt: finalResolvedAt,
      });
    }
  } catch (emitErr) {
    console.error('[IncidentResolutionService] Socket.IO emit failed after persistence:', emitErr.message);
    await logBroadcastFailure(pool, {
      incidentId: numericIncidentId,
      referenceNumber: finalRef,
      actorUserId,
      errorMessage: `Socket emit failed: ${emitErr.message}`,
    });
  }

  return {
    created: true,
    duplicate: false,
    notificationId,
    incidentId: numericIncidentId,
    referenceNumber: finalRef,
    recipientCount: recipientIds.length,
    deliveredCount,
  };
}

/**
 * Fire-and-forget post-commit wrapper with automatic bounded retry on transient failures.
 * Never throws or rolls back an already-committed incident closure.
 */
function dispatchIncidentResolvedCommunityBroadcast(payload, options = {}) {
  const pool = options.pool || defaultPool;
  const attempt = async (retryIndex) => {
    try {
      await broadcastIncidentResolvedCommunityNotification(payload, options);
    } catch (err) {
      console.error(
        `[IncidentResolutionService] Broadcast attempt ${retryIndex + 1} failed for incident ${payload && payload.incidentId}:`,
        err.message
      );
      await logBroadcastFailure(pool, {
        incidentId: payload && payload.incidentId,
        referenceNumber: payload && payload.referenceNumber,
        actorUserId: payload && payload.actorUserId,
        errorMessage: err.message,
      });
      if (retryIndex < RETRY_DELAYS_MS.length) {
        const delay = RETRY_DELAYS_MS[retryIndex];
        const timer = setTimeout(() => attempt(retryIndex + 1), delay);
        if (typeof timer.unref === 'function') timer.unref();
      }
    }
  };
  return attempt(0);
}

module.exports = {
  formatIncidentResolvedMessage,
  broadcastIncidentResolvedCommunityNotification,
  dispatchIncidentResolvedCommunityBroadcast,
};
