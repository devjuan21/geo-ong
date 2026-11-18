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

    socket.on('join-conversation', async (payload, ack) => {
      try {
        const rawConvId =
          payload && typeof payload === 'object' ? payload.conversationId || payload.id : payload;
        const { verifyConversationAccess } = require('./messageService');
        const check = await verifyConversationAccess(socket.user, rawConvId, {
          allowAdmin: true,
          requireSendPermission: false,
        });
        if (!check.ok) {
          if (typeof ack === 'function') ack({ ok: false, status: check.status, error: check.error });
          return;
        }
        socket.join(`conversation:${check.conversation.id}`);
        if (typeof ack === 'function') ack({ ok: true, conversationId: check.conversation.id });
      } catch (err) {
        if (typeof ack === 'function') ack({ ok: false, status: 500, error: 'Failed to join conversation.' });
      }
    });

    socket.on('leave-conversation', (payload) => {
      const rawConvId =
        payload && typeof payload === 'object' ? payload.conversationId || payload.id : payload;
      const id = parseInt(rawConvId, 10);
      if (Number.isInteger(id) && id > 0) {
        socket.leave(`conversation:${id}`);
        emitTypingStopForSocket(socket, id);
      }
    });

    socket.on('conversation:typing-start', async (payload) => {
      await handleSocketTypingEvent(socket, payload, true);
    });

    socket.on('conversation:typing-stop', async (payload) => {
      await handleSocketTypingEvent(socket, payload, false);
    });

    socket.on('disconnect', () => {
      if (socket.activeTypingConvs && socket.activeTypingConvs.size > 0) {
        for (const convId of Array.from(socket.activeTypingConvs)) {
          emitTypingStopForSocket(socket, convId);
        }
      }
    });

    socket.on('send-conversation-message', async (payload, ack) => {
      try {
        const { createConversationMessage } = require('./messageService');
        const { conversationId, body, clientMessageId } = payload || {};
        const result = await createConversationMessage({
          user: socket.user,
          conversationId,
          body,
          clientMessageId,
        });
        if (!result.ok) {
          if (typeof ack === 'function') ack({ ok: false, status: result.status, error: result.error });
          return;
        }
        if (!result.deduplicated) {
          emitConversationMessage(result.conversation, result.message);
        }
        if (typeof ack === 'function') ack({ ok: true, message: result.message });
      } catch (err) {
        if (typeof ack === 'function') ack({ ok: false, status: 500, error: 'Unable to send message.' });
      }
    });
  });

  return io;
}

function emitTypingStopForSocket(socket, convId) {
  if (!io || !socket || !socket.user) return;
  const cached = socket.authorizedTypingConvs && socket.authorizedTypingConvs.get(convId);
  if (socket.activeTypingConvs) {
    socket.activeTypingConvs.delete(convId);
  }
  if (!cached || !cached.recipientUserId) return;
  io.to(`user:${cached.recipientUserId}`).emit('conversation:typing', {
    conversationId: convId,
    userId: Number(socket.user.id),
    userName: socket.user.name || 'Participant',
    isTyping: false,
    updatedAt: Date.now(),
  });
}

async function handleSocketTypingEvent(socket, payload, isTyping) {
  if (!io || !socket || !socket.user) return;
  const rawConvId = payload && typeof payload === 'object' ? payload.conversationId || payload.id : payload;
  const convId = parseInt(rawConvId, 10);
  if (!Number.isInteger(convId) || convId <= 0) return;

  if (!socket.authorizedTypingConvs) socket.authorizedTypingConvs = new Map();
  if (!socket.activeTypingConvs) socket.activeTypingConvs = new Set();

  let cached = socket.authorizedTypingConvs.get(convId);
  if (!cached) {
    try {
      const { verifyConversationAccess } = require('./messageService');
      const check = await verifyConversationAccess(socket.user, convId, {
        allowAdmin: false,
        requireSendPermission: true,
      });
      if (!check.ok || !check.conversation) return;
      const senderId = Number(socket.user.id);
      const residentId = Number(check.conversation.resident_user_id);
      const responderId = Number(check.conversation.responder_user_id);
      const recipientUserId = senderId === residentId ? responderId : senderId === responderId ? residentId : null;
      if (!recipientUserId || recipientUserId === senderId) return;
      cached = { residentId, responderId, recipientUserId };
      socket.authorizedTypingConvs.set(convId, cached);
    } catch (_) {
      return;
    }
  }

  if (isTyping) {
    socket.activeTypingConvs.add(convId);
  } else {
    socket.activeTypingConvs.delete(convId);
  }

  io.to(`user:${cached.recipientUserId}`).emit('conversation:typing', {
    conversationId: convId,
    userId: Number(socket.user.id),
    userName: socket.user.name || 'Participant',
    isTyping: Boolean(isTyping),
    updatedAt: Date.now(),
  });
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

function buildLifecycleTarget(payload) {
  if (!io) return null;
  const scope = String((payload && (payload.targetScope || payload.target_scope)) || '').trim();
  let target = io
    .to('role:Administrator')
    .to('role:admin')
    .to('role:Responder')
    .to('role:responder');
  if (scope !== 'Responders Only') {
    target = target.to('role:Resident').to('role:resident');
  }
  return target;
}

function emitAlertExpired(alert) {
  const target = buildLifecycleTarget(alert);
  if (!target) return;
  target.emit('hazard-alert-expired', alert);
  target.emit('alert-expired', alert);
}

function emitAlertCancelled(alert) {
  const target = buildLifecycleTarget(alert);
  if (!target) return;
  target.emit('hazard-alert-cancelled', alert);
  target.emit('alert-cancelled', alert);
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

function emitConversationMessage(conv, message) {
  if (!io || !conv || !message) return;
  const convRoom = `conversation:${conv.id}`;
  const resRoom = `user:${conv.resident_user_id}`;
  const respRoom = `user:${conv.responder_user_id}`;

  io.to(convRoom)
    .to(resRoom)
    .to(respRoom)
    .emit('conversation:new-message', message);

  io.to(resRoom)
    .to(respRoom)
    .emit('messages:unread-update', {
      conversationId: conv.id,
      rescueId: conv.rescue_id,
      lastMessageAt: message.createdAt,
      senderUserId: message.senderUserId,
    });

  // Strict Backend Recipient Validation: deliver private chat notification ONLY to the intended recipient's user room
  const senderId = Number(message.senderUserId);
  const residentId = Number(conv.resident_user_id);
  const responderId = Number(conv.responder_user_id);
  let recipientUserId = null;
  if (senderId === residentId && Number.isInteger(responderId) && responderId > 0) {
    recipientUserId = responderId;
  } else if (senderId === responderId && Number.isInteger(residentId) && residentId > 0) {
    recipientUserId = residentId;
  }

  if (recipientUserId && recipientUserId !== senderId) {
    const rawBody = String(message.body || '').trim();
    const preview = rawBody.length > 90 ? `${rawBody.slice(0, 87)}...` : rawBody;
    io.to(`user:${recipientUserId}`).emit('messages:incoming-notification', {
      conversationId: conv.id,
      rescueId: conv.rescue_id,
      messageId: message.id,
      senderUserId: senderId,
      senderName: message.senderName || 'Participant',
      senderRole: message.senderRole || '',
      preview,
      createdAt: message.createdAt || new Date().toISOString(),
    });
  }

  io.to('role:Administrator')
    .to('role:admin')
    .emit('admin:conversation-activity', {
      conversationId: conv.id,
      rescueId: conv.rescue_id,
      lastMessageAt: message.createdAt,
    });
}

function emitConversationMessagesRead(conv, readerUserId, readAt) {
  if (!io || !conv) return;
  const payload = {
    conversationId: conv.id,
    readerUserId: Number(readerUserId),
    readAt: readAt || new Date().toISOString(),
  };
  io.to(`conversation:${conv.id}`)
    .to(`user:${conv.resident_user_id}`)
    .to(`user:${conv.responder_user_id}`)
    .emit('conversation:messages-read', payload);

  io.to(`user:${readerUserId}`).emit('messages:unread-update', payload);
}

function emitConversationAccessUpdated({
  conversationId,
  rescueId,
  residentUserId,
  responderUserId,
  revokedResponderUserId,
  status = null,
  reason = null,
} = {}) {
  if (!io) return;
  if (revokedResponderUserId && conversationId) {
    try {
      io.in(`user:${revokedResponderUserId}`).socketsLeave(`conversation:${conversationId}`);
    } catch (_) { }
  }

  const isClosed = status === 'Closed' || status === 'Completed';
  if (isClosed) {
    const targetRooms = [residentUserId, responderUserId].filter(Boolean).map((id) => `user:${id}`);
    targetRooms.forEach((room) => {
      try {
        const roomSockets = io.sockets.adapter.rooms.get(room);
        if (roomSockets) {
          roomSockets.forEach((sid) => {
            const s = io.sockets.sockets.get(sid);
            if (!s) return;
            if (conversationId) {
              if (s.authorizedTypingConvs) s.authorizedTypingConvs.delete(Number(conversationId));
              if (s.activeTypingConvs) s.activeTypingConvs.delete(Number(conversationId));
            } else {
              if (s.authorizedTypingConvs) s.authorizedTypingConvs.clear();
              if (s.activeTypingConvs) s.activeTypingConvs.clear();
            }
          });
        }
      } catch (_) {}
      io.to(room).emit('conversation:typing', {
        conversationId: conversationId || null,
        rescueId: rescueId || null,
        isTyping: false,
        updatedAt: Date.now(),
      });
    });
  }

  const payload = {
    conversationId: conversationId || null,
    rescueId: rescueId || null,
    status: status || null,
    reason: reason || null,
  };
  if (residentUserId) io.to(`user:${residentUserId}`).emit('messages:access-updated', payload);
  if (responderUserId) io.to(`user:${responderUserId}`).emit('messages:access-updated', payload);
  if (revokedResponderUserId) {
    io.to(`user:${revokedResponderUserId}`).emit('messages:access-updated', payload);
  }
  io.to('role:Administrator').to('role:admin').emit('admin:conversation-activity', payload);
}

const liveResponderLocations = new Map();

function emitResponderLocationUpdate(payload) {
  if (!payload || !payload.userId) return null;
  const uid = Number(payload.userId);
  const incomingMs = payload.updatedAt ? new Date(payload.updatedAt).getTime() : Date.now();
  const prev = liveResponderLocations.get(uid);
  if (prev && prev.updatedAtMs && incomingMs < prev.updatedAtMs) {
    return prev;
  }
  const entry = {
    userId: uid,
    responderId: payload.responderId || payload.badgeNumber || `RSP-${uid}`,
    name: payload.name || 'Responder',
    assignedUnit: payload.assignedUnit || 'Response Unit',
    organization: payload.organization || 'Emergency Operations',
    callsign: payload.callsign || null,
    badgeNumber: payload.badgeNumber || null,
    availabilityStatus: payload.availabilityStatus || 'On Duty',
    lat: Number(payload.lat),
    lng: Number(payload.lng),
    accuracy: Number.isFinite(Number(payload.accuracy)) ? Number(payload.accuracy) : null,
    sharingEnabled: true,
    updatedAt: new Date(incomingMs).toISOString(),
    updatedAtMs: incomingMs,
  };
  liveResponderLocations.set(uid, entry);

  if (io) {
    io.to('role:Administrator')
      .to('role:admin')
      .emit('responder:location-updated', entry);
    io.to(`user:${uid}`).emit('responder:location-updated', entry);
  }
  return entry;
}

function emitResponderLocationOffline(userId) {
  const uid = Number(userId);
  if (!Number.isInteger(uid) || uid <= 0) return;
  liveResponderLocations.delete(uid);
  if (io) {
    io.to('role:Administrator')
      .to('role:admin')
      .emit('responder:location-offline', { userId: uid, updatedAt: new Date().toISOString() });
  }
}

function emitConversationArchiveUpdated(userId, conversationId, isArchived, extra = {}) {
  const uid = Number(userId);
  const cid = Number(conversationId);
  if (!io || !Number.isInteger(uid) || uid <= 0 || !Number.isInteger(cid) || cid <= 0) return;
  io.to(`user:${uid}`).emit('conversation:archive-updated', {
    userId: uid,
    conversationId: cid,
    isArchived: Boolean(isArchived),
    reason: extra.reason || null,
    updatedAt: new Date().toISOString(),
  });
}

function getLiveResponderLocations() {
  return Array.from(liveResponderLocations.values());
}

module.exports = {
  initSocket,
  getIO,
  emitNewReport,
  emitPublicVerifiedReport,
  emitReportVerificationResult,
  emitNewRescueRequest,
  emitAlertBroadcast,
  emitAlertExpired,
  emitAlertCancelled,
  emitAssignmentUpdate,
  emitStatusUpdate,
  emitIncidentResolved,
  emitAdminAnnouncement,
  emitConversationMessage,
  emitConversationMessagesRead,
  emitConversationAccessUpdated,
  emitConversationArchiveUpdated,
  emitResponderLocationUpdate,
  emitResponderLocationOffline,
  getLiveResponderLocations,
  disconnectUserSockets,
};
