const pool = require('../config/db');
const { ROLE_IDS } = require('../config/roles');
const {
  isAssignmentAccepted,
  syncConversationsForRescueRequests,
  verifyConversationAccess,
  createConversationMessage,
  formatMessageRow,
  getUnreadMessagesCountForUser,
} = require('../services/messageService');
const {
  emitConversationMessage,
  emitConversationMessagesRead,
  emitConversationArchiveUpdated,
} = require('../services/socketService');

async function writeMessageAuditLog(req, { action, entityId, details }) {
  try {
    const ip =
      (req.headers && req.headers['x-forwarded-for']) ||
      (req.socket && req.socket.remoteAddress) ||
      '127.0.0.1';
    const ua = (req.headers && req.headers['user-agent']) || 'GeoSafe-Portal';
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_values, ip_address, user_agent)
       VALUES (?, ?, 'conversations', ?, ?, ?, ?)`,
      [
        req.user ? req.user.id : null,
        action,
        String(entityId),
        details ? JSON.stringify(details) : null,
        String(ip).slice(0, 45),
        String(ua).slice(0, 255),
      ]
    );
  } catch (err) {
    console.warn('[Messages Audit] Failed to write audit log:', err.message);
  }
}

async function listConversations(req, res) {
  try {
    await syncConversationsForRescueRequests();

    const roleId = Number(req.user.role_id);
    const userId = Number(req.user.id);

    const archivedFilter = String(req.query.archived || 'all').trim().toLowerCase();
    let whereClause = '1=1';
    const params = [userId, userId, userId];

    if (roleId === ROLE_IDS.RESIDENT) {
      whereClause = `c.resident_user_id = ? AND EXISTS (
        SELECT 1 FROM conversation_participants cp
        WHERE cp.conversation_id = c.id AND cp.user_id = ? AND cp.is_active = TRUE
      )`;
      params.push(userId, userId);
    } else if (roleId === ROLE_IDS.RESPONDER) {
      whereClause = `c.responder_user_id = ? AND EXISTS (
        SELECT 1 FROM conversation_participants cp
        WHERE cp.conversation_id = c.id AND cp.user_id = ? AND cp.is_active = TRUE
      )`;
      params.push(userId, userId);
    } else if (roleId !== ROLE_IDS.ADMINISTRATOR) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const [rows] = await pool.query(
      `SELECT c.id,
              c.rescue_id,
              c.assignment_id,
              c.resident_user_id,
              c.responder_user_id,
              c.status AS conversation_status,
              c.last_message_at,
              c.created_at,
              COALESCE(cp_self.is_archived, FALSE) AS self_is_archived,
              cp_self.archived_at AS self_archived_at,
              rr.reference_number AS rescue_reference,
              rr.emergency_type,
              rr.status AS rescue_status,
              rr.address AS rescue_address,
              res_u.name AS resident_name,
              res_u.user_code AS resident_code,
              resp_u.name AS responder_name,
              resp_u.user_code AS responder_code,
              rp.badge_number AS responder_badge,
              rp.assigned_unit AS responder_unit,
              ra.id AS latest_assignment_id,
              ra.responder_user_id AS latest_responder_id,
              ra.assignment_status,
              ra.accepted_at,
              lm.id AS last_message_id,
              lm.body AS last_message_body,
              lm.sender_user_id AS last_message_sender_id,
              lm.created_at AS last_message_created_at,
              (
                SELECT COUNT(*)::int FROM messages m2
                WHERE m2.conversation_id = c.id
              ) AS total_messages,
              (
                SELECT COUNT(*)::int FROM messages m3
                WHERE m3.conversation_id = c.id
                  AND m3.sender_user_id <> ?
                  AND NOT EXISTS (
                    SELECT 1 FROM message_read_status mrs
                    WHERE mrs.message_id = m3.id AND mrs.user_id = ?
                  )
              ) AS unread_count
       FROM conversations c
       JOIN rescue_requests rr ON rr.id = c.rescue_id
       JOIN users res_u ON res_u.id = c.resident_user_id
       JOIN users resp_u ON resp_u.id = c.responder_user_id
       LEFT JOIN conversation_participants cp_self ON cp_self.conversation_id = c.id AND cp_self.user_id = ?
       LEFT JOIN responder_profiles rp ON rp.user_id = c.responder_user_id
       LEFT JOIN LATERAL (
         SELECT id, responder_user_id, assignment_status, accepted_at
         FROM rescue_assignments
         WHERE rescue_id = c.rescue_id
         ORDER BY assigned_at DESC, id DESC
         LIMIT 1
       ) ra ON TRUE
       LEFT JOIN LATERAL (
         SELECT id, body, sender_user_id, created_at
         FROM messages
         WHERE conversation_id = c.id
         ORDER BY created_at DESC, id DESC
         LIMIT 1
       ) lm ON TRUE
       WHERE ${whereClause}
       ORDER BY COALESCE(c.last_message_at, c.created_at) DESC, c.id DESC`,
      params
    );

    const conversations = rows
      .filter((r) => {
        if (roleId === ROLE_IDS.ADMINISTRATOR) return true;
        if (!isAssignmentAccepted(r.assignment_status, r.accepted_at)) return false;
        if (roleId === ROLE_IDS.RESPONDER && Number(r.latest_responder_id) !== userId) {
          return false;
        }
        const isArch = Boolean(r.self_is_archived);
        if (archivedFilter === 'true' && !isArch) return false;
        if (archivedFilter === 'false' && isArch) return false;
        return true;
      })
      .map((r) => ({
        id: Number(r.id),
        rescueId: Number(r.rescue_id),
        rescueReference: r.rescue_reference || `RES-${r.rescue_id}`,
        emergencyType: r.emergency_type || 'Rescue Request',
        rescueStatus: r.rescue_status || 'Pending Dispatch',
        rescueAddress: r.rescue_address || '',
        assignmentStatus: r.assignment_status || 'Assigned',
        conversationStatus: r.conversation_status || 'Active',
        isArchived: roleId === ROLE_IDS.ADMINISTRATOR ? false : Boolean(r.self_is_archived),
        archivedAt: roleId === ROLE_IDS.ADMINISTRATOR ? null : (r.self_archived_at || null),
        resident: {
          id: Number(r.resident_user_id),
          name: r.resident_name || 'Resident',
          userCode: r.resident_code || `RSDNT-${String(r.resident_user_id).padStart(4, '0')}`,
        },
        responder: {
          id: Number(r.responder_user_id),
          name: r.responder_name || 'Responder',
          userCode:
            r.responder_code ||
            r.responder_badge ||
            `RSPDR-${String(r.responder_user_id).padStart(4, '0')}`,
          unit: r.responder_unit || 'Barangay Bayanan Field Unit',
        },
        lastMessagePreview: r.last_message_body || null,
        lastMessageAt: r.last_message_created_at || r.last_message_at || null,
        lastMessageSenderId: r.last_message_sender_id ? Number(r.last_message_sender_id) : null,
        totalMessages: Number(r.total_messages || 0),
        unreadCount: roleId === ROLE_IDS.ADMINISTRATOR ? 0 : Number(r.unread_count || 0),
        createdAt: r.created_at,
      }));

    let pendingRequests = [];
    if (roleId === ROLE_IDS.RESIDENT) {
      const [pendRows] = await pool.query(
        `SELECT rr.id, rr.reference_number, rr.emergency_type, rr.status, rr.created_at,
                ra.assignment_status, ra.accepted_at, resp_u.name AS responder_name
         FROM rescue_requests rr
         LEFT JOIN LATERAL (
           SELECT responder_user_id, assignment_status, accepted_at
           FROM rescue_assignments
           WHERE rescue_id = rr.id
           ORDER BY assigned_at DESC, id DESC
           LIMIT 1
         ) ra ON TRUE
         LEFT JOIN users resp_u ON resp_u.id = ra.responder_user_id
         WHERE rr.user_id = ?
           AND rr.status NOT IN ('Completed', 'Cancelled')`,
        [userId]
      );
      pendingRequests = pendRows
        .filter((pr) => !isAssignmentAccepted(pr.assignment_status, pr.accepted_at))
        .map((pr) => ({
          rescueId: Number(pr.id),
          rescueReference: pr.reference_number || `RES-${pr.id}`,
          emergencyType: pr.emergency_type || 'Rescue Request',
          status: pr.status,
          assignmentStatus: pr.assignment_status || 'Unassigned',
          assignedResponderName: pr.responder_name || null,
          createdAt: pr.created_at,
        }));
    } else if (roleId === ROLE_IDS.RESPONDER) {
      const [pendRows] = await pool.query(
        `SELECT rr.id, rr.reference_number, rr.emergency_type, rr.status, rr.created_at,
                ra.assignment_status, ra.accepted_at, res_u.name AS resident_name
         FROM rescue_requests rr
         JOIN LATERAL (
           SELECT responder_user_id, assignment_status, accepted_at
           FROM rescue_assignments
           WHERE rescue_id = rr.id
           ORDER BY assigned_at DESC, id DESC
           LIMIT 1
         ) ra ON TRUE
         JOIN users res_u ON res_u.id = rr.user_id
         WHERE ra.responder_user_id = ?
           AND rr.status NOT IN ('Completed', 'Cancelled')`,
        [userId]
      );
      pendingRequests = pendRows
        .filter((pr) => !isAssignmentAccepted(pr.assignment_status, pr.accepted_at))
        .map((pr) => ({
          rescueId: Number(pr.id),
          rescueReference: pr.reference_number || `RES-${pr.id}`,
          emergencyType: pr.emergency_type || 'Rescue Request',
          status: pr.status,
          assignmentStatus: pr.assignment_status || 'Assigned',
          residentName: pr.resident_name || 'Resident',
          createdAt: pr.created_at,
        }));
    }

    return res.json({
      conversations,
      pendingRequests,
      total: conversations.length,
    });
  } catch (err) {
    console.error('[Messages API] listConversations failed:', err.message);
    return res.status(503).json({ error: 'Unable to load conversations.' });
  }
}

async function getConversationMessages(req, res) {
  try {
    const access = await verifyConversationAccess(req.user, req.params.id, {
      allowAdmin: true,
      requireSendPermission: false,
    });
    if (!access.ok) {
      return res.status(access.status).json({ error: access.error });
    }

    const conv = access.conversation;
    if (Number(req.user.role_id) === ROLE_IDS.ADMINISTRATOR) {
      await writeMessageAuditLog(req, {
        action: 'VIEW_CONVERSATION_HISTORY',
        entityId: conv.id,
        details: {
          conversation_id: conv.id,
          rescue_id: conv.rescue_id,
          rescue_reference: conv.rescue_reference,
        },
      });
    }

    const [msgRows] = await pool.query(
      `SELECT m.id,
              m.conversation_id,
              m.sender_user_id,
              m.client_message_id,
              m.body,
              m.created_at,
              u.name AS sender_name,
              u.role_id AS sender_role_id,
              EXISTS (
                SELECT 1 FROM message_read_status mrs
                WHERE mrs.message_id = m.id AND mrs.user_id <> m.sender_user_id
              ) AS is_read_by_other,
              (
                SELECT MAX(mrs2.read_at) FROM message_read_status mrs2
                WHERE mrs2.message_id = m.id AND mrs2.user_id <> m.sender_user_id
              ) AS other_read_at
       FROM messages m
       JOIN users u ON u.id = m.sender_user_id
       WHERE m.conversation_id = ?
       ORDER BY m.created_at ASC, m.id ASC`,
      [conv.id]
    );

    const messages = msgRows.map((m) => formatMessageRow(m, conv));
    let selfIsArchived = false;
    let selfArchivedAt = null;
    if (Number(req.user.role_id) !== ROLE_IDS.ADMINISTRATOR) {
      const [cpRows] = await pool.query(
        'SELECT is_archived, archived_at FROM conversation_participants WHERE conversation_id = ? AND user_id = ? LIMIT 1',
        [conv.id, req.user.id]
      );
      if (cpRows[0]) {
        selfIsArchived = Boolean(cpRows[0].is_archived);
        selfArchivedAt = cpRows[0].archived_at || null;
      }
    }

    return res.json({
      conversation: {
        id: Number(conv.id),
        rescueId: Number(conv.rescue_id),
        rescueReference: conv.rescue_reference || `RES-${conv.rescue_id}`,
        emergencyType: conv.emergency_type || 'Rescue Request',
        rescueStatus: conv.rescue_status || 'Pending Dispatch',
        rescueAddress: conv.rescue_address || '',
        assignmentStatus: conv.assignment_status || 'Accepted',
        conversationStatus: conv.conversation_status || 'Active',
        isArchived: selfIsArchived,
        archivedAt: selfArchivedAt,
        canSend:
          Number(req.user.role_id) !== ROLE_IDS.ADMINISTRATOR &&
          !['Completed', 'Closed'].includes(conv.conversation_status),
        resident: {
          id: Number(conv.resident_user_id),
          name: conv.resident_name || 'Resident',
          userCode: conv.resident_code || `RSDNT-${String(conv.resident_user_id).padStart(4, '0')}`,
        },
        responder: {
          id: Number(conv.responder_user_id),
          name: conv.responder_name || 'Responder',
          userCode:
            conv.responder_code ||
            conv.responder_badge ||
            `RSPDR-${String(conv.responder_user_id).padStart(4, '0')}`,
          unit: conv.responder_unit || 'Barangay Bayanan Field Unit',
        },
      },
      messages,
    });
  } catch (err) {
    console.error('[Messages API] getConversationMessages failed:', err.message);
    return res.status(503).json({ error: 'Unable to load conversation messages.' });
  }
}

async function sendConversationMessage(req, res) {
  try {
    const bodyText =
      req.body && (req.body.body !== undefined ? req.body.body : req.body.message);
    const clientMessageId = req.body ? req.body.clientMessageId || null : null;

    const result = await createConversationMessage({
      user: req.user,
      conversationId: req.params.id,
      body: bodyText,
      clientMessageId,
    });

    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }

    if (!result.deduplicated) {
      if (Array.isArray(result.unarchivedUserIds)) {
        for (const uid of result.unarchivedUserIds) {
          emitConversationArchiveUpdated(uid, result.conversation.id, false, { reason: 'new-message' });
        }
      }
      emitConversationMessage(result.conversation, result.message);
    }

    return res.status(result.deduplicated ? 200 : 201).json({
      message: result.message,
      deduplicated: Boolean(result.deduplicated),
    });
  } catch (err) {
    console.error('[Messages API] sendConversationMessage failed:', err.message);
    return res.status(500).json({ error: 'Unable to send message.' });
  }
}

async function markConversationRead(req, res) {
  try {
    const access = await verifyConversationAccess(req.user, req.params.id, {
      allowAdmin: false,
      requireSendPermission: false,
    });
    if (!access.ok) {
      return res.status(access.status).json({ error: access.error });
    }

    const conv = access.conversation;
    const [insRes] = await pool.query(
      `INSERT INTO message_read_status (message_id, conversation_id, user_id, read_at)
       SELECT m.id, m.conversation_id, ?, NOW()
       FROM messages m
       WHERE m.conversation_id = ?
         AND m.sender_user_id <> ?
       ON CONFLICT (message_id, user_id) DO NOTHING`,
      [req.user.id, conv.id, req.user.id]
    );

    const affected = insRes && insRes.affectedRows ? insRes.affectedRows : 0;
    const readAt = new Date().toISOString();
    if (affected > 0) {
      emitConversationMessagesRead(conv, req.user.id, readAt);
    }

    return res.json({ ok: true, readCount: affected, readAt });
  } catch (err) {
    console.error('[Messages API] markConversationRead failed:', err.message);
    return res.status(500).json({ error: 'Unable to mark messages as read.' });
  }
}

async function getUnreadCount(req, res) {
  try {
    const unreadCount = await getUnreadMessagesCountForUser(req.user);
    return res.json({ unreadCount });
  } catch (err) {
    console.error('[Messages API] getUnreadCount failed:', err.message);
    return res.status(503).json({ error: 'Unable to load unread count.' });
  }
}

async function setConversationArchiveState(req, res, shouldArchive) {
  try {
    const access = await verifyConversationAccess(req.user, req.params.id, {
      allowAdmin: false,
      requireSendPermission: false,
    });
    if (!access.ok) {
      return res.status(access.status).json({ error: access.error });
    }

    const conv = access.conversation;
    const userId = Number(req.user.id);
    const participantRole =
      Number(conv.resident_user_id) === userId ? 'Resident' : 'Responder';

    const [rows] = await pool.query(
      `INSERT INTO conversation_participants
         (conversation_id, user_id, role, is_active, is_archived, archived_at, joined_at, left_at)
       VALUES (?, ?, ?, TRUE, ?, ${shouldArchive ? 'NOW()' : 'NULL'}, NOW(), NULL)
       ON CONFLICT (conversation_id, user_id) DO UPDATE SET
         is_archived = EXCLUDED.is_archived,
         archived_at = ${shouldArchive ? 'NOW()' : 'NULL'}
       RETURNING is_archived, archived_at`,
      [conv.id, userId, participantRole, Boolean(shouldArchive)]
    );
    const updatedRow = rows && rows[0] ? rows[0] : {};
    const isArchived = Boolean(shouldArchive);
    const archivedAt = updatedRow.archived_at || (isArchived ? new Date().toISOString() : null);

    await writeMessageAuditLog(req, {
      action: isArchived ? 'ARCHIVE_CONVERSATION' : 'UNARCHIVE_CONVERSATION',
      entityId: conv.id,
      details: {
        conversation_id: conv.id,
        rescue_id: conv.rescue_id,
        is_archived: isArchived,
      },
    });

    emitConversationArchiveUpdated(userId, conv.id, isArchived, {
      reason: isArchived ? 'user-archived' : 'user-unarchived',
    });

    return res.json({
      ok: true,
      conversationId: Number(conv.id),
      isArchived,
      archivedAt,
    });
  } catch (err) {
    console.error('[Messages API] setConversationArchiveState failed:', err.message);
    return res.status(500).json({ error: 'Unable to update conversation archive state.' });
  }
}

async function archiveConversation(req, res) {
  return setConversationArchiveState(req, res, true);
}

async function unarchiveConversation(req, res) {
  return setConversationArchiveState(req, res, false);
}

module.exports = {
  listConversations,
  getConversationMessages,
  sendConversationMessage,
  markConversationRead,
  getUnreadCount,
  archiveConversation,
  unarchiveConversation,
};
