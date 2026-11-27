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

let _activeSyncPromise = null;
let _lastSyncAt = 0;

/**
 * Synchronizes `conversations` and `conversation_participants` with the latest
 * `rescue_requests` and `rescue_assignments` records in PostgreSQL using set-based SQL.
 */
async function syncConversationsForRescueRequests({ force = true } = {}) {
  const now = Date.now();
  if (!force && now - _lastSyncAt < 60000) {
    return;
  }
  if (_activeSyncPromise) {
    return _activeSyncPromise;
  }

  _activeSyncPromise = (async () => {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // 1. Upsert conversations for all rescue requests with an accepted latest assignment
      await conn.query(
        `WITH latest_ra AS (
           SELECT DISTINCT ON (ra.rescue_id)
                  ra.rescue_id,
                  ra.id AS assignment_id,
                  ra.responder_user_id,
                  ra.assignment_status,
                  ra.accepted_at
           FROM rescue_assignments ra
           ORDER BY ra.rescue_id, ra.assigned_at DESC, ra.id DESC
         ),
         accepted_src AS (
           SELECT rr.id AS rescue_id,
                  rr.user_id AS resident_user_id,
                  lra.assignment_id,
                  lra.responder_user_id,
                  CASE
                    WHEN rr.status IN ('Completed', 'Cancelled') OR lra.assignment_status = 'Completed' THEN 'Closed'
                    ELSE 'Active'
                  END AS conv_status
           FROM rescue_requests rr
           JOIN latest_ra lra ON lra.rescue_id = rr.id
           WHERE rr.user_id IS NOT NULL
             AND lra.responder_user_id IS NOT NULL
             AND (lra.accepted_at IS NOT NULL OR lra.assignment_status IN ('Accepted', 'En Route', 'On Scene', 'In Progress', 'Completed'))
         )
         INSERT INTO conversations
           (rescue_id, assignment_id, resident_user_id, responder_user_id, status, updated_at)
         SELECT rescue_id, assignment_id, resident_user_id, responder_user_id, conv_status, NOW()
         FROM accepted_src
         ON CONFLICT (rescue_id) DO UPDATE SET
           assignment_id = EXCLUDED.assignment_id,
           resident_user_id = EXCLUDED.resident_user_id,
           responder_user_id = EXCLUDED.responder_user_id,
           status = EXCLUDED.status,
           updated_at = NOW()
         WHERE conversations.assignment_id IS DISTINCT FROM EXCLUDED.assignment_id
            OR conversations.resident_user_id IS DISTINCT FROM EXCLUDED.resident_user_id
            OR conversations.responder_user_id IS DISTINCT FROM EXCLUDED.responder_user_id
            OR conversations.status IS DISTINCT FROM EXCLUDED.status`
      );

      // 2. Ensure active Resident & current Responder participants exist for accepted conversations
      await conn.query(
        `INSERT INTO conversation_participants (conversation_id, user_id, role, is_active, joined_at, left_at)
         SELECT c.id, c.resident_user_id, 'Resident', TRUE, NOW(), NULL
         FROM conversations c
         JOIN rescue_assignments ra ON ra.id = c.assignment_id
         WHERE ra.accepted_at IS NOT NULL OR ra.assignment_status IN ('Accepted', 'En Route', 'On Scene', 'In Progress', 'Completed')
         ON CONFLICT (conversation_id, user_id) DO UPDATE SET
           role = 'Resident',
           is_active = TRUE,
           left_at = NULL
         WHERE conversation_participants.is_active IS DISTINCT FROM TRUE`
      );

      await conn.query(
        `INSERT INTO conversation_participants (conversation_id, user_id, role, is_active, joined_at, left_at)
         SELECT c.id, c.responder_user_id, 'Responder', TRUE, NOW(), NULL
         FROM conversations c
         JOIN rescue_assignments ra ON ra.id = c.assignment_id
         WHERE ra.accepted_at IS NOT NULL OR ra.assignment_status IN ('Accepted', 'En Route', 'On Scene', 'In Progress', 'Completed')
         ON CONFLICT (conversation_id, user_id) DO UPDATE SET
           role = 'Responder',
           is_active = TRUE,
           left_at = NULL
         WHERE conversation_participants.is_active IS DISTINCT FROM TRUE`
      );

      // 3. Revoke access for previously assigned responders
      await conn.query(
        `UPDATE conversation_participants cp
         SET is_active = FALSE,
             left_at = COALESCE(cp.left_at, NOW())
         FROM conversations c
         WHERE cp.conversation_id = c.id
           AND cp.role = 'Responder'
           AND cp.is_active = TRUE
           AND cp.user_id <> c.responder_user_id`
      );

      // 4. For unaccepted reassignments on existing conversations, update assignment and lock responder access
      await conn.query(
        `WITH latest_ra AS (
           SELECT DISTINCT ON (ra.rescue_id)
                  ra.rescue_id,
                  ra.id AS assignment_id,
                  ra.responder_user_id,
                  ra.assignment_status,
                  ra.accepted_at
           FROM rescue_assignments ra
           ORDER BY ra.rescue_id, ra.assigned_at DESC, ra.id DESC
         )
         UPDATE conversations c
         SET assignment_id = lra.assignment_id,
             responder_user_id = COALESCE(lra.responder_user_id, c.responder_user_id),
             updated_at = NOW()
         FROM latest_ra lra
         WHERE c.rescue_id = lra.rescue_id
           AND lra.accepted_at IS NULL
           AND lra.assignment_status NOT IN ('Accepted', 'En Route', 'On Scene', 'In Progress', 'Completed')
           AND c.assignment_id IS DISTINCT FROM lra.assignment_id`
      );

      await conn.query(
        `WITH latest_ra AS (
           SELECT DISTINCT ON (ra.rescue_id)
                  ra.rescue_id,
                  ra.assignment_status,
                  ra.accepted_at
           FROM rescue_assignments ra
           ORDER BY ra.rescue_id, ra.assigned_at DESC, ra.id DESC
         )
         UPDATE conversation_participants cp
         SET is_active = FALSE,
             left_at = COALESCE(cp.left_at, NOW())
         FROM conversations c
         JOIN latest_ra lra ON lra.rescue_id = c.rescue_id
         WHERE cp.conversation_id = c.id
           AND cp.role = 'Responder'
           AND cp.is_active = TRUE
           AND lra.accepted_at IS NULL
           AND lra.assignment_status NOT IN ('Accepted', 'En Route', 'On Scene', 'In Progress', 'Completed')`
      );

      await conn.commit();
      _lastSyncAt = Date.now();
    } catch (err) {
      await conn.rollback();
      console.error('[MessageService] syncConversationsForRescueRequests failed:', err.message);
    } finally {
      conn.release();
    }
  })();

  try {
    await _activeSyncPromise;
  } finally {
    _activeSyncPromise = null;
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

    // Automatically restore archived conversation to active inbox for the recipient(s)
    const [unarchivedRes] = await conn.query(
      `UPDATE conversation_participants
       SET is_archived = FALSE,
           archived_at = NULL
       WHERE conversation_id = ?
         AND user_id <> ?
         AND is_active = TRUE
         AND is_archived = TRUE
       RETURNING user_id`,
      [conv.id, user.id]
    );
    const unarchivedRows = Array.isArray(unarchivedRes)
      ? unarchivedRes
      : unarchivedRes && Array.isArray(unarchivedRes.rows)
      ? unarchivedRes.rows
      : [];
    const unarchivedUserIds = unarchivedRows.map((r) => Number(r.user_id)).filter((id) => id > 0);

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
      unarchivedUserIds,
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
