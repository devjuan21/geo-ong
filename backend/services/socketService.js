const { verifyRequestSession } = require('../middleware/auth');

let io = null;

function normalizeRoleName(user) {
  if (!user) return 'Resident';
  if (user.role_name && ['Administrator', 'Responder', 'Resident'].includes(user.role_name)) {
    return user.role_name;
  }
  const raw = String(user.role || '').toLowerCase();
  if (raw === 'admin' || raw === 'administrator' || user.role_id === 1) return 'Administrator';
  if (raw === 'responder' || user.role_id === 2) return 'Responder';
  return 'Resident';
}

function normalizeRoleLabel(user) {
  if (!user) return 'resident';
  const raw = String(user.role || '').toLowerCase();
  if (raw === 'admin' || raw === 'administrator' || user.role_id === 1) return 'admin';
  if (raw === 'responder' || user.role_id === 2) return 'responder';
  return 'resident';
}

function initSocket(server) {
  const { Server } = require('socket.io');
  io = new Server(server, {
    cors: { origin: true, credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH'] },
  });

  io.use(async (socket, next) => {
    try {
      const headers = { ...((socket.handshake && socket.handshake.headers) || {}) };
      const authToken =
        socket.handshake &&
        socket.handshake.auth &&
        typeof socket.handshake.auth.token === 'string'
          ? socket.handshake.auth.token.trim()
          : '';

      if (!headers.authorization && authToken) {
        headers.authorization = authToken.startsWith('Bearer ') ? authToken : `Bearer ${authToken}`;
      }

      const session = await verifyRequestSession({ headers });
      if (!session || !session.ok || !session.user) {
        return next(new Error((session && session.error) || 'Authentication required'));
      }

      const roleName = normalizeRoleName(session.user);
      const roleLabel = normalizeRoleLabel(session.user);

      socket.user = {
        ...session.user,
        role: roleName,
        roleLabel,
      };
      return next();
    } catch (err) {
      return next(new Error('Authentication required'));
    }
  });

  io.on('connection', (socket) => {
    if (socket.user) {
      socket.join(`role:${socket.user.role}`);
      socket.join(`role:${socket.user.roleLabel}`);
      socket.join(`user:${socket.user.id}`);
    }
    socket.join('broadcast');

    socket.on('join-role', (requestedRole) => {
      if (!socket.user || !requestedRole) return;
      const reqLower = String(requestedRole).toLowerCase();
      if (
        reqLower === socket.user.role.toLowerCase() ||
        reqLower === socket.user.roleLabel.toLowerCase()
      ) {
        socket.join(`role:${socket.user.role}`);
        socket.join(`role:${socket.user.roleLabel}`);
      }
    });
  });

  return io;
}

function getIO() {
  return io;
}

function emitNewReport(report) {
  if (!io) return;
  const target = io
    .to('role:Administrator')
    .to('role:admin');
  target.emit('new-incident-report', report);
  target.emit('new-report', report);
}

function emitPublicVerifiedReport(report) {
  if (!io || !report) return;
  const allowedStatuses = new Set(['verified', 'dispatched', 'responding', 'on_site', 'in_progress', 'resolved']);
  const rawStatus = String(report.rawStatus || report.status || '').toLowerCase();
  if (!allowedStatuses.has(rawStatus) && rawStatus !== 'verified') return;

  io.to('broadcast').emit('public-report-verified', {
    id: report.referenceNumber || report.id,
    referenceNumber: report.referenceNumber || report.id,
    incidentType: report.incidentType || report.incident_type || 'Incident',
    title: report.title || '',
    description: report.description || '',
    latitude: report.latitude,
    longitude: report.longitude,
    address: report.address || report.location || 'Barangay Bayanan',
    status: 'Verified',
    createdAt: report.createdAt || report.created_at || new Date().toISOString(),
  });
}

function emitNewRescueRequest(rescue) {
  if (!io) return;
  const target = io
    .to('role:Administrator')
    .to('role:Responder')
    .to('role:admin')
    .to('role:responder');
  target.emit('new-rescue-request', rescue);
}

function buildBroadcastTarget(payload) {
  if (!io) return null;
  const actorId = payload && (payload.actorUserId || payload.authorizedById);
  const scope = String((payload && (payload.targetScope || payload.target_scope)) || '').trim();
  let target =
    scope === 'Responders Only'
      ? io.to('role:Responder').to('role:responder')
      : io
          .to('role:Resident')
          .to('role:resident')
          .to('role:Responder')
          .to('role:responder');
  if (actorId) {
    target = target.except(`user:${actorId}`);
  }
  return target;
}

function emitAlertBroadcast(alert) {
  const target = buildBroadcastTarget(alert);
  if (!target) return;
  target.emit('new-hazard-alert', alert);
  target.emit('alert-broadcast', alert);
}

function emitAssignmentUpdate(assignment) {
  if (!io) return;
  const residentId =
    assignment && (assignment.residentId || assignment.user_id || assignment.userId);
  const responderId =
    assignment && (assignment.responderId || assignment.responder_user_id || assignment.assignedTo);

  let target = null;
  if (responderId) {
    target = io.to(`user:${responderId}`);
  }
  if (residentId) {
    target = target ? target.to(`user:${residentId}`) : io.to(`user:${residentId}`);
  }
  if (!target) {
    target = io.to('role:admin');
  }
  target.emit('rescue-assignment-updated', assignment);
}

function emitReportVerificationResult(payload) {
  if (!io || !payload) return;
  const residentId = payload.residentId || payload.user_id || payload.userId || null;
  if (residentId) {
    io.to(`user:${residentId}`).emit('report-verification-result', {
      id: payload.id,
      referenceNumber: payload.referenceNumber,
      recordType: 'incident',
      status: payload.status,
      decision: payload.decision || payload.status,
      reason: payload.reason || '',
      message: payload.message || '',
    });
  }
  // Silent data refresh for other open Admin dashboards (never triggers a toast)
  io.to('role:admin').emit('admin-sync', {
    recordType: 'incident',
    referenceNumber: payload.referenceNumber,
    status: payload.status,
  });
}

function emitStatusUpdate(payload, entityType, newStatus, extra) {
  if (!io) return;
  let normalizedPayload;
  if (payload && typeof payload === 'object') {
    normalizedPayload = { ...payload };
  } else {
    normalizedPayload = {
      id: payload,
      entityType: entityType || 'incident',
      recordType: entityType || 'incident',
      status: newStatus,
      ...(extra && typeof extra === 'object' ? extra : {}),
    };
  }

  const residentId =
    normalizedPayload.residentId ||
    normalizedPayload.user_id ||
    normalizedPayload.userId ||
    null;
  const responderId =
    normalizedPayload.assignedTo ||
    normalizedPayload.assigned_to ||
    normalizedPayload.responderId ||
    normalizedPayload.responder_user_id ||
    null;

  const actorUserId = normalizedPayload.actorUserId || null;

  let target = null;
  if (residentId && (!actorUserId || Number(residentId) !== Number(actorUserId))) {
    target = io.to(`user:${residentId}`);
  }
  if (responderId && (!actorUserId || Number(responderId) !== Number(actorUserId))) {
    target = target ? target.to(`user:${responderId}`) : io.to(`user:${responderId}`);
  }
  if (target) {
    target.emit('rescue-status-updated', normalizedPayload);
  }

  // Silent data refresh for open Admin dashboards (never triggers a toast)
  io.to('role:admin').emit('admin-sync', {
    recordType: normalizedPayload.entityType || normalizedPayload.recordType || 'rescue',
    referenceNumber: normalizedPayload.referenceNumber || normalizedPayload.id,
    status: normalizedPayload.status,
  });
}

function emitIncidentResolved(payload) {
  if (!io || !payload) return;
  const refNum = payload.referenceNumber || payload.id;
  const recordType = payload.recordType || 'incident';
  const resolvedStatus = payload.status || (recordType === 'rescue' ? 'Completed' : 'resolved');
  // Minimum-info removal signal for active maps & operational lists (silent, no global toast)
  io.to('broadcast').emit('incident-resolved', {
    id: refNum,
    dbId: payload.id || payload.dbId || null,
    referenceNumber: refNum,
    recordType,
    status: resolvedStatus,
  });

  // Notify submitting resident & assigned responder privately if applicable
  const residentId = payload.residentId || payload.user_id || payload.userId || null;
  const responderId = payload.assignedTo || payload.assigned_to || null;
  if (residentId) {
    io.to(`user:${residentId}`).emit('report-verification-result', {
      id: payload.id,
      referenceNumber: refNum,
      recordType: 'incident',
      status: 'resolved',
      decision: 'resolved',
      reason: payload.reason || '',
      message: `Your incident report ${refNum} has been marked Resolved.`,
    });
  }
  if (responderId) {
    io.to(`user:${responderId}`).emit('rescue-status-updated', {
      id: payload.id,
      referenceNumber: refNum,
      recordType: 'incident',
      status: 'resolved',
      message: `Incident ${refNum} has been marked Resolved.`,
    });
  }
}

async function disconnectUserSockets(userId) {
  if (!io || !userId) return;
  try {
    const sockets = await io.in(`user:${userId}`).fetchSockets();
    for (const s of sockets) {
      for (const room of s.rooms) {
        if (room !== s.id) s.leave(room);
      }
      s.disconnect(true);
    }
  } catch (err) {
    console.warn('[Socket.IO] disconnectUserSockets failed:', err.message);
  }
}

function emitAdminAnnouncement(announcement) {
  const target = buildBroadcastTarget(announcement);
  if (!target) return;
  target.emit('administrator-announcement', announcement);
}

module.exports = {
  initSocket,
  getIO,
  emitNewReport,
  emitPublicVerifiedReport,
  emitReportVerificationResult,
  emitNewRescueRequest,
  emitAlertBroadcast,
  emitAssignmentUpdate,
  emitStatusUpdate,
  emitIncidentResolved,
  emitAdminAnnouncement,
  disconnectUserSockets,
};
