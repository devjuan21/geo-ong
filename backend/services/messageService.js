const pool = require('../config/db');
const { ROLE_IDS } = require('../config/roles');

const ACCEPTED_ASSIGNMENT_STATUSES = new Set([
  'Accepted',
  'En Route',
  'On Scene',
  'In Progress',
  'Completed',
]);

function isAssignmentAccepted(assignmentStatus, acceptedAt) {
  if (acceptedAt) return true;
  return ACCEPTED_ASSIGNMENT_STATUSES.has(String(assignmentStatus || '').trim());
}

/**
 * Synchronizes `conversations` and `conversation_participants` with the latest
 * `rescue_requests` and `rescue_assignments` records in PostgreSQL.
 * Ensures:
 * - Conversations exist for all rescue requests with an accepted assignment.
 * - Reassigned responders immediately lose access (`is_active = FALSE`).
 * - Unaccepted reassignments remain locked until the new responder accepts.
 */
async function syncConversationsForRescueRequests() {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT rr.id AS rescue_id,
              rr.user_id AS resident_user_id,
              rr.status AS rescue_status,
              ra.id AS assignment_id,
              ra.responder_user_id,
              ra.assignment_status,
              ra.accepted_at
       FROM rescue_requests rr
       LEFT JOIN LATERAL (
         SELECT id, responder_user_id, assignment_status, accepted_at
         FROM rescue_assignments
         WHERE rescue_id = rr.id
         ORDER BY assigned_at DESC, id DESC
         LIMIT 1
       ) ra ON TRUE
       WHERE ra.id IS NOT NULL`
    );

    const syncedByRescueId = new Map();
    for (const r of rows) {
      const accepted = isAssignmentAccepted(r.assignment_status, r.accepted_at);
      const convStatus =
        r.rescue_status === 'Completed' || r.assignment_status === 'Completed' || r.rescue_status === 'Cancelled'
          ? 'Closed'
          : 'Active';

      if (accepted && r.resident_user_id && r.responder_user_id) {
        const [upsertRes] = await conn.query(
          `INSERT INTO conversations
             (rescue_id, assignment_id, resident_user_id, responder_user_id, status, updated_at)
           VALUES (?, ?, ?, ?, ?, NOW())
           ON CONFLICT (rescue_id) DO UPDATE SET
             assignment_id = EXCLUDED.assignment_id,
             resident_user_id = EXCLUDED.resident_user_id,
             responder_user_id = EXCLUDED.responder_user_id,
             status = EXCLUDED.status,
             updated_at = NOW()
           RETURNING id`,
          [r.rescue_id, r.assignment_id, r.resident_user_id, r.responder_user_id, convStatus]
        );
        const convRows = Array.isArray(upsertRes)
          ? upsertRes
          : upsertRes && Array.isArray(upsertRes.rows)
          ? upsertRes.rows
          : [];
        const convId = convRows[0] ? convRows[0].id : upsertRes.insertId;

        if (convId) {
          // Ensure Resident is active participant
          await conn.query(
            `INSERT INTO conversation_participants (conversation_id, user_id, role, is_active, joined_at, left_at)
             VALUES (?, ?, 'Resident', TRUE, NOW(), NULL)
             ON CONFLICT (conversation_id, user_id) DO UPDATE SET
               role = 'Resident',
               is_active = TRUE,
               left_at = NULL`,
            [convId, r.resident_user_id]
          );

          // Ensure current accepted Responder is active participant
          await conn.query(
            `INSERT INTO conversation_participants (conversation_id, user_id, role, is_active, joined_at, left_at)
             VALUES (?, ?, 'Responder', TRUE, NOW(), NULL)
             ON CONFLICT (conversation_id, user_id) DO UPDATE SET
               role = 'Responder',
               is_active = TRUE,
               left_at = NULL`,
            [convId, r.responder_user_id]
          );

          // Revoke access for any previously assigned Responder on this conversation
          await conn.query(
            `UPDATE conversation_participants
             SET is_active = FALSE,
                 left_at = COALESCE(left_at, NOW())
             WHERE conversation_id = ?
               AND role = 'Responder'
               AND user_id <> ?`,
            [convId, r.responder_user_id]
          );
        }
      } else {
        // Assignment exists but is NOT accepted yet: if a conversation already existed, revoke responder access until accepted
        const [existingConv] = await conn.query(
          'SELECT id FROM conversations WHERE rescue_id = ? LIMIT 1',
          [r.rescue_id]
        );
        if (existingConv[0]) {
          await conn.query(
            `UPDATE conversations
             SET assignment_id = ?,
                 responder_user_id = COALESCE(?, responder_user_id),
                 updated_at = NOW()
             WHERE id = ?`,
            [r.assignment_id, r.responder_user_id || null, existingConv[0].id]
          );
          await conn.query(
            `UPDATE conversation_participants
             SET is_active = FALSE,
                 left_at = COALESCE(left_at, NOW())
             WHERE conversation_id = ?
               AND role = 'Responder'`,
            [existingConv[0].id]
          );
        }
      }
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    console.error('[MessageService] syncConversationsForRescueRequests failed:', err.message);
  } finally {
    conn.release();
  }
}

/**
 * Verifies whether `user` is authorized to view (or send messages in) `conversationId`.
 */
async function verifyConversationAccess(
  user,
  conversationId,
  { allowAdmin = false, requireSendPermission = false } = {}
) {
  const convId = parseInt(conversationId, 10);
  if (!user || !Number.isInteger(convId) || convId <= 0) {
    return { ok: false, status: 400, error: 'Invalid conversation identifier.' };
  }

  await syncConversationsForRescueRequests();

  const [rows] = await pool.query(
    `SELECT c.id,
            c.rescue_id,
            c.assignment_id,
            c.resident_user_id,
            c.responder_user_id,
            c.status AS conversation_status,
            c.last_message_at,
            c.created_at,
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
            ra.accepted_at
     FROM conversations c
     JOIN rescue_requests rr ON rr.id = c.rescue_id
     JOIN users res_u ON res_u.id = c.resident_user_id
     JOIN users resp_u ON resp_u.id = c.responder_user_id
     LEFT JOIN responder_profiles rp ON rp.user_id = c.responder_user_id
     LEFT JOIN LATERAL (
       SELECT id, responder_user_id, assignment_status, accepted_at
       FROM rescue_assignments
       WHERE rescue_id = c.rescue_id
       ORDER BY assigned_at DESC, id DESC
       LIMIT 1
     ) ra ON TRUE
     WHERE c.id = ?
     LIMIT 1`,
    [convId]
  );

  const conv = rows[0];
  if (!conv) {
    return { ok: false, status: 404, error: 'Conversation not found.' };
  }

  const roleId = Number(user.role_id);
  if (roleId === ROLE_IDS.ADMINISTRATOR) {
    if (requireSendPermission) {
      return {
        ok: false,
        status: 403,
        error: 'Administrators have read-only oversight and cannot send messages as participants.',
      };
    }
    if (!allowAdmin) {
      return { ok: false, status: 403, error: 'Access denied.' };
    }
    return { ok: true, conversation: conv, participantRole: 'Administrator' };
  }

  const accepted = isAssignmentAccepted(conv.assignment_status, conv.accepted_at);
  if (!accepted) {
    return {
      ok: false,
      status: 403,
      error: 'Messaging is unavailable until the assigned Responder accepts the rescue assignment.',
    };
  }

  const [partRows] = await pool.query(
    `SELECT is_active, role
     FROM conversation_participants
     WHERE conversation_id = ? AND user_id = ?
     LIMIT 1`,
    [convId, user.id]
  );
  const part = partRows[0];
  if (!part || !part.is_active) {
    return { ok: false, status: 403, error: 'You are not an authorized participant of this conversation.' };
  }

  if (roleId === ROLE_IDS.RESIDENT) {
    if (Number(conv.resident_user_id) !== Number(user.id)) {
      return { ok: false, status: 403, error: 'Residents may only access their own rescue conversations.' };
    }
  } else if (roleId === ROLE_IDS.RESPONDER) {
    if (
      Number(conv.responder_user_id) !== Number(user.id) ||
      Number(conv.latest_responder_id) !== Number(user.id)
    ) {
      return {
        ok: false,
        status: 403,
        error: 'You are no longer the assigned Responder for this rescue request.',
      };
    }
  } else {
    return { ok: false, status: 403, error: 'Unauthorized role.' };
  }

  if (
    requireSendPermission &&
    (['Completed', 'Closed'].includes(conv.conversation_status) ||
      conv.rescue_status === 'Completed' ||
      conv.assignment_status === 'Completed')
  ) {
    return {
      ok: false,
      status: 403,
      error: 'Conversation Closed – Assignment Completed. Messaging is unavailable.',
    };
  }

  return { ok: true, conversation: conv, participantRole: part.role };
}

/**
 * Persists a message inside a PostgreSQL transaction (with client_message_id deduplication).
 */
async function createConversationMessage({ user, conversationId, body, clientMessageId = null }) {
  const access = await verifyConversationAccess(user, conversationId, {
    allowAdmin: false,
    requireSendPermission: true,
  });
  if (!access.ok) {
    return access;
  }

  const trimmedBody = String(body || '').trim();
  if (!trimmedBody) {
    return { ok: false, status: 400, error: 'Message content cannot be empty.' };
  }
  if (trimmedBody.length > 2000) {
    return { ok: false, status: 400, error: 'Message cannot exceed 2000 characters.' };
  }

  const cleanClientMsgId = clientMessageId ? String(clientMessageId).trim().slice(0, 80) : null;
  const conv = access.conversation;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Row-level lock on conversation + rescue/assignment to prevent concurrent message insertion after completion
    const [lockedRows] = await conn.query(
      `SELECT c.status AS conv_status, rr.status AS rescue_status, ra.assignment_status
       FROM conversations c
       JOIN rescue_requests rr ON rr.id = c.rescue_id
       LEFT JOIN LATERAL (
         SELECT assignment_status
         FROM rescue_assignments
         WHERE rescue_id = c.rescue_id
         ORDER BY assigned_at DESC, id DESC
         LIMIT 1
       ) ra ON TRUE
       WHERE c.id = ?
       FOR UPDATE OF c`,
      [conv.id]
    );
    const locked = lockedRows[0];
    if (
      !locked ||
      ['Completed', 'Closed'].includes(locked.conv_status) ||
      locked.rescue_status === 'Completed' ||
      locked.assignment_status === 'Completed'
    ) {
      await conn.rollback();
      return {
        ok: false,
        status: 403,
        error: 'Conversation Closed – Assignment Completed. Messaging is unavailable.',
      };
    }

    if (cleanClientMsgId) {
      const [existing] = await conn.query(
        `SELECT m.id, m.conversation_id, m.sender_user_id, m.client_message_id, m.body, m.created_at,
                u.name AS sender_name, u.role_id AS sender_role_id
         FROM messages m
         JOIN users u ON u.id = m.sender_user_id
         WHERE m.conversation_id = ? AND m.sender_user_id = ? AND m.client_message_id = ?
         LIMIT 1`,
        [conv.id, user.id, cleanClientMsgId]
      );
      if (existing[0]) {
        await conn.commit();
        return {
          ok: true,
          deduplicated: true,
          conversation: conv,
          message: formatMessageRow(existing[0], conv),
        };
      }
    }

    const [insRes] = await conn.query(
      `INSERT INTO messages (conversation_id, sender_user_id, client_message_id, body, created_at)
       VALUES (?, ?, ?, ?, NOW())
       RETURNING id, conversation_id, sender_user_id, client_message_id, body, created_at`,
      [conv.id, user.id, cleanClientMsgId, trimmedBody]
    );
    const insRows = Array.isArray(insRes)
      ? insRes
      : insRes && Array.isArray(insRes.rows)
      ? insRes.rows
      : [];
    const createdRow = insRows[0] || {
      id: insRes.insertId,
      conversation_id: conv.id,
      sender_user_id: user.id,
      client_message_id: cleanClientMsgId,
      body: trimmedBody,
      created_at: new Date().toISOString(),
    };

    // Mark sender's own read status
    await conn.query(
      `INSERT INTO message_read_status (message_id, conversation_id, user_id, read_at)
       VALUES (?, ?, ?, NOW())
       ON CONFLICT (message_id, user_id) DO NOTHING`,
      [createdRow.id, conv.id, user.id]
    );

    await conn.query(
      `UPDATE conversations
       SET last_message_at = ?,
           updated_at = NOW()
       WHERE id = ?`,
      [createdRow.created_at, conv.id]
    );

    await conn.commit();

    const formatted = formatMessageRow(
      {
        ...createdRow,
        sender_name: user.name,
        sender_role_id: user.role_id,
        is_read_by_other: false,
      },
      conv
    );

    return {
      ok: true,
      deduplicated: false,
      conversation: conv,
      message: formatted,
    };
  } catch (err) {
    await conn.rollback();
    console.error('[MessageService] createConversationMessage failed:', err.message);
    return { ok: false, status: 500, error: 'Unable to send message.' };
  } finally {
    conn.release();
  }
}

function formatMessageRow(m, conv) {
  const senderRole =
    Number(m.sender_role_id) === ROLE_IDS.RESPONDER
      ? 'Responder'
      : Number(m.sender_role_id) === ROLE_IDS.RESIDENT
      ? 'Resident'
      : 'Administrator';
  return {
    id: Number(m.id),
    conversationId: Number(m.conversation_id),
    rescueId: conv ? Number(conv.rescue_id) : null,
    senderUserId: Number(m.sender_user_id),
    senderName: m.sender_name || 'Participant',
    senderRole,
    clientMessageId: m.client_message_id || null,
    body: m.body,
    createdAt: m.created_at,
    isRead: Boolean(m.is_read_by_other),
    readAt: m.other_read_at || null,
  };
}

async function getUnreadMessagesCountForUser(user) {
  if (!user || !user.id) return 0;
  const roleId = Number(user.role_id);
  if (roleId !== ROLE_IDS.RESIDENT && roleId !== ROLE_IDS.RESPONDER) {
    return 0;
  }

  const userCol = roleId === ROLE_IDS.RESIDENT ? 'c.resident_user_id' : 'c.responder_user_id';
  const [rows] = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     JOIN conversation_participants cp ON cp.conversation_id = c.id AND cp.user_id = ? AND cp.is_active = TRUE
     WHERE ${userCol} = ?
       AND m.sender_user_id <> ?
       AND NOT EXISTS (
         SELECT 1 FROM message_read_status mrs
         WHERE mrs.message_id = m.id AND mrs.user_id = ?
       )`,
    [user.id, user.id, user.id, user.id]
  );
  return Number((rows[0] && rows[0].count) || 0);
}

module.exports = {
  isAssignmentAccepted,
  syncConversationsForRescueRequests,
  verifyConversationAccess,
  createConversationMessage,
  formatMessageRow,
  getUnreadMessagesCountForUser,
};
