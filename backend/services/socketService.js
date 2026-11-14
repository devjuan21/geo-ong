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
    .to('role:Responder')
    .to('role:admin')
    .to('role:responder');
  target.emit('new-incident-report', report);
  target.emit('new-report', report);
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

function emitAlertBroadcast(alert) {
  if (!io) return;
  io.to('broadcast').emit('new-hazard-alert', alert);
  io.to('broadcast').emit('alert-broadcast', alert);
}

function emitAssignmentUpdate(assignment) {
  if (!io) return;
  let target = io
    .to('role:Administrator')
    .to('role:Responder')
    .to('role:admin')
    .to('role:responder');
  const residentId =
    assignment && (assignment.residentId || assignment.user_id || assignment.userId);
  if (residentId) {
    target = target.to(`user:${residentId}`);
  }
  const responderId =
    assignment && (assignment.responderId || assignment.responder_user_id || assignment.assignedTo);
  if (responderId) {
    target = target.to(`user:${responderId}`);
  }
  target.emit('rescue-assignment-updated', assignment);
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

  let target = io
    .to('role:Administrator')
    .to('role:Responder')
    .to('role:admin')
    .to('role:responder');

  const residentId =
    normalizedPayload.residentId ||
    normalizedPayload.user_id ||
    normalizedPayload.userId ||
    null;
  if (residentId) {
    target = target.to(`user:${residentId}`);
  }

  const responderId =
    normalizedPayload.assignedTo ||
    normalizedPayload.assigned_to ||
    normalizedPayload.responderId ||
    normalizedPayload.responder_user_id ||
    null;
  if (responderId) {
    target = target.to(`user:${responderId}`);
  }

  target.emit('rescue-status-updated', normalizedPayload);
  target.emit('status-update', normalizedPayload);
}

function emitAdminAnnouncement(announcement) {
  if (!io) return;
  io.to('broadcast').emit('administrator-announcement', announcement);
}

module.exports = {
  initSocket,
  getIO,
  emitNewReport,
  emitNewRescueRequest,
  emitAlertBroadcast,
  emitAssignmentUpdate,
  emitStatusUpdate,
  emitAdminAnnouncement,
};
