/**
 * GeoSafe - Family Safety Tracker & QR Membership Controller
 * ============================================================================
 * Production-ready backend business logic:
 * - Secure QR invitation token hashing (SHA-256)
 * - Anti-tampering server-side authorization
 * - Manager approval workflow for join requests
 * - Explicit, revocable location sharing privacy enforcement
 * - Zero hardcoded/mock user records
 * ============================================================================
 */

const crypto = require('crypto');
const { validationResult } = require('express-validator');
const pool = require('../models/db');

// Helper to hash raw tokens
function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

// Generate cryptographically secure random token (32 bytes = 64 hex chars)
function generateSecureToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Helper: Retrieve caller's active family membership
 */
async function getCallerActiveMembership(userId) {
  const [rows] = await pool.query(
    `SELECT fm.id AS member_id, fm.family_id, fm.user_id, fm.relationship,
            fm.membership_role, fm.membership_status, fm.joined_at,
            fg.family_name, fg.created_by, fg.status AS group_status,
            fg.region, fg.province, fg.city, fg.barangay, fg.street, fg.house_number, fg.subdivision_purok,
            flc.sharing_enabled, flc.consented_at
     FROM family_members fm
     JOIN family_groups fg ON fm.family_id = fg.id
     LEFT JOIN family_location_sharing_consents flc ON fm.id = flc.family_member_id
     WHERE fm.user_id = ? AND fm.membership_status = 'active' AND fg.status = 'active'
     LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

/**
 * 1. Create Family Group
 * POST /api/family/groups
 */
async function createFamilyGroup(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: 'Validation failed', details: errors.array() });
  }

  const userId = req.user.id;
  const { family_name, relationship, house_number, street } = req.body;

  const cleanHouseNumber = typeof house_number === 'string' ? house_number.trim() : '';
  const cleanStreet = typeof street === 'string' ? street.trim() : '';

  if (!cleanHouseNumber || !cleanStreet) {
    return res.status(400).json({
      error: 'Both House / Building Number and Street Name are required when creating a family group.'
    });
  }

  // Prevent multiple active family memberships
  const existing = await getCallerActiveMembership(userId);
  if (existing) {
    return res.status(400).json({
      error: 'You are already an active member of a family group. Leave your current family before creating a new one.'
    });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Insert family group with required Barangay Bayanan household address
    const [groupResult] = await connection.query(
      `INSERT INTO family_groups
        (family_name, created_by, house_number, street, barangay, city, province, region, country, status)
       VALUES (?, ?, ?, ?, 'Bayanan', 'Muntinlupa City', 'Metro Manila', 'National Capital Region', 'Philippines', 'active')`,
      [family_name.trim(), userId, cleanHouseNumber, cleanStreet]
    );
    const familyId = groupResult.insertId;

    // 2. Insert creator as initial member with 'manager' role
    const [memberResult] = await connection.query(
      `INSERT INTO family_members (family_id, user_id, relationship, membership_role, membership_status)
       VALUES (?, ?, ?, 'manager', 'active')`,
      [familyId, userId, (relationship || 'Head of Household').trim()]
    );
    const memberId = memberResult.insertId;

    // 3. Initialize default location sharing consent (Disabled by default per privacy guidelines)
    await connection.query(
      `INSERT INTO family_location_sharing_consents (family_member_id, sharing_enabled, consented_at)
       VALUES (?, 0, NULL)`,
      [memberId]
    );

    await connection.commit();

    const formattedAddress = `${cleanHouseNumber} ${cleanStreet}, Barangay Bayanan, Muntinlupa City, Metro Manila, Philippines`;

    return res.status(201).json({
      message: 'Family group created successfully.',
      family: {
        id: familyId,
        family_name: family_name.trim(),
        created_by: userId,
        status: 'active',
        is_manager: true,
        member_count: 1,
        address: {
          house_number: cleanHouseNumber,
          street: cleanStreet,
          barangay: 'Bayanan',
          city: 'Muntinlupa City',
          province: 'Metro Manila',
          region: 'National Capital Region',
          country: 'Philippines',
          formatted: formattedAddress
        }
      },
      myMembership: {
        id: memberId,
        membership_role: 'manager',
        membership_status: 'active',
        relationship: (relationship || 'Head of Household').trim(),
        location_sharing_enabled: false
      }
    });
  } catch (err) {
    await connection.rollback();
    console.error('[Family API] createFamilyGroup error:', err);
    return res.status(500).json({ error: 'Failed to create family group.' });
  } finally {
    connection.release();
  }
}

/**
 * 2. Get Current User's Family & Active Members
 * GET /api/family/my-family
 */
async function getMyFamily(req, res) {
  const userId = req.user.id;

  try {
    const membership = await getCallerActiveMembership(userId);
    if (!membership) {
      return res.json({
        family: null,
        members: [],
        pendingRequests: [],
        activeInvitation: null,
        myMembership: null
      });
    }

    const familyId = membership.family_id;
    const isManager = membership.membership_role === 'manager';

    // Fetch all active members in this family with their location sharing consent and latest update
    const [members] = await pool.query(
      `SELECT fm.id AS member_id, fm.user_id, fm.relationship, fm.membership_role,
              fm.membership_status, fm.joined_at,
              u.name AS user_name, u.email AS user_email,
              flc.sharing_enabled, flc.consented_at,
              flu.latitude, flu.longitude, flu.battery_level, flu.safety_status, flu.recorded_at
       FROM family_members fm
       JOIN users u ON fm.user_id = u.id
       LEFT JOIN family_location_sharing_consents flc ON fm.id = flc.family_member_id
       LEFT JOIN (
         SELECT flu1.*
         FROM family_location_updates flu1
         INNER JOIN (
           SELECT family_member_id, MAX(recorded_at) AS max_rec
           FROM family_location_updates
           GROUP BY family_member_id
         ) flu2 ON flu1.family_member_id = flu2.family_member_id AND flu1.recorded_at = flu2.max_rec
       ) flu ON fm.id = flu.family_member_id
       WHERE fm.family_id = ? AND fm.membership_status = 'active'
       ORDER BY (fm.membership_role = 'manager') DESC, fm.joined_at ASC`,
      [familyId]
    );

    // Format members respecting explicit location privacy
    const formattedMembers = members.map(m => {
      const isSharing = !!m.sharing_enabled;
      return {
        id: m.member_id,
        user_id: m.user_id,
        name: m.user_name || 'Family Member',
        email: m.user_email,
        relationship: m.relationship || 'Member',
        membership_role: m.membership_role,
        membership_status: m.membership_status,
        joined_at: m.joined_at,
        is_self: m.user_id === userId,
        locationSharing: {
          enabled: isSharing,
          status: isSharing
            ? (m.latitude && m.longitude ? 'Sharing Location' : 'Location unavailable')
            : 'Location sharing off',
          lastUpdated: isSharing && m.recorded_at ? m.recorded_at : null,
          latitude: isSharing ? (m.latitude ? parseFloat(m.latitude) : null) : null,
          longitude: isSharing ? (m.longitude ? parseFloat(m.longitude) : null) : null,
          batteryLevel: isSharing ? (m.battery_level !== null ? m.battery_level : null) : null,
          safetyStatus: isSharing && m.safety_status ? m.safety_status : 'no_response'
        }
      };
    });

    // If manager, fetch pending join requests
    let pendingRequests = [];
    if (isManager) {
      const [requests] = await pool.query(
        `SELECT fjr.id, fjr.user_id, fjr.invitation_id, fjr.relationship, fjr.request_status, fjr.requested_at,
                u.name AS applicant_name, u.email AS applicant_email
         FROM family_join_requests fjr
         JOIN users u ON fjr.user_id = u.id
         WHERE fjr.family_id = ? AND fjr.request_status = 'pending'
         ORDER BY fjr.requested_at ASC`,
        [familyId]
      );
      pendingRequests = requests;
    }

    // Active unexpired invitation if manager
    let activeInvitation = null;
    if (isManager) {
      const [invitations] = await pool.query(
        `SELECT id, expires_at, created_at
         FROM family_invitations
         WHERE family_id = ? AND revoked_at IS NULL AND expires_at > NOW()
         ORDER BY created_at DESC
         LIMIT 1`,
        [familyId]
      );
      if (invitations.length > 0) {
        activeInvitation = invitations[0];
      }
    }

    return res.json({
      family: {
        id: familyId,
        family_name: membership.family_name,
        created_by: membership.created_by,
        status: membership.group_status,
        is_manager: isManager,
        member_count: formattedMembers.length,
        address: {
          house_number: membership.house_number || null,
          street: membership.street || null,
          barangay: membership.barangay || 'Bayanan',
          city: membership.city || 'Muntinlupa City',
          province: membership.province || 'Metro Manila',
          region: membership.region || 'National Capital Region',
          country: 'Philippines',
          formatted: (membership.street && membership.house_number)
            ? `${membership.house_number} ${membership.street}, Barangay ${membership.barangay || 'Bayanan'}, ${membership.city || 'Muntinlupa City'}, ${membership.province || 'Metro Manila'}, Philippines`
            : null
        }
      },
      myMembership: {
        id: membership.member_id,
        membership_role: membership.membership_role,
        membership_status: membership.membership_status,
        relationship: membership.relationship,
        location_sharing_enabled: !!membership.sharing_enabled,
        consented_at: membership.consented_at
      },
      members: formattedMembers,
      pendingRequests,
      activeInvitation
    });
  } catch (err) {
    console.error('[Family API] getMyFamily error:', err);
    return res.status(500).json({ error: 'Failed to retrieve family details.' });
  }
}

/**
 * 3. Generate Secure Family QR Invitation
 * POST /api/family/invitations
 * Only authorized family managers can generate an invitation.
 */
async function generateInvitation(req, res) {
  const userId = req.user.id;
  const expiresInHours = parseInt(req.body.expires_in_hours, 10) || 72; // default 3 days

  try {
    const membership = await getCallerActiveMembership(userId);
    if (!membership) {
      return res.status(404).json({ error: 'You do not belong to a family group.' });
    }
    if (membership.membership_role !== 'manager') {
      return res.status(403).json({ error: 'Only authorized family managers can generate QR invitations.' });
    }

    const familyId = membership.family_id;

    // Revoke any previous active invitations to keep a single valid QR code
    await pool.query(
      `UPDATE family_invitations
       SET revoked_at = NOW()
       WHERE family_id = ? AND revoked_at IS NULL`,
      [familyId]
    );

    // Generate cryptographically secure random token
    const rawToken = generateSecureToken();
    const tokenHash = hashToken(rawToken);

    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

    const [result] = await pool.query(
      `INSERT INTO family_invitations (family_id, token_hash, created_by, expires_at)
       VALUES (?, ?, ?, ?)`,
      [familyId, tokenHash, userId, expiresAt]
    );

    // Return the raw token ONCE to the authorized caller for QR rendering
    return res.status(201).json({
      message: 'Invitation generated successfully.',
      invitation: {
        id: result.insertId,
        family_id: familyId,
        family_name: membership.family_name,
        token: rawToken, // Returned strictly to the generator
        expires_at: expiresAt.toISOString(),
        created_at: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error('[Family API] generateInvitation error:', err);
    return res.status(500).json({ error: 'Failed to generate invitation.' });
  }
}

/**
 * 4. Validate Invitation Token (Public / Semi-Public safe endpoint)
 * GET /api/family/invitations/validate/:token
 * Validates token expiration and returns ONLY safe presentation metadata (family name & inviter display name).
 */
async function validateInvitation(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ valid: false, error: 'Invalid token format.' });
  }

  const { token } = req.params;
  if (!token || typeof token !== 'string' || token.trim().length < 16 || token.trim().length > 128) {
    return res.status(400).json({ valid: false, error: 'Invalid token format.' });
  }

  const tokenHash = hashToken(token.trim());

  try {
    const [rows] = await pool.query(
      `SELECT fi.id AS invitation_id, fi.family_id, fi.expires_at, fi.revoked_at,
              fg.family_name, fg.status AS group_status,
              u.name AS inviter_name
       FROM family_invitations fi
       JOIN family_groups fg ON fi.family_id = fg.id
       JOIN users u ON fi.created_by = u.id
       WHERE fi.token_hash = ?
       LIMIT 1`,
      [tokenHash]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        valid: false,
        error: 'Invitation is invalid or does not exist.'
      });
    }

    const inv = rows[0];

    if (inv.group_status !== 'active') {
      return res.status(410).json({
        valid: false,
        error: 'The family group associated with this invitation is no longer active.'
      });
    }

    if (inv.revoked_at !== null) {
      return res.status(410).json({
        valid: false,
        error: 'This invitation QR code has been revoked by the family manager.'
      });
    }

    if (new Date(inv.expires_at) < new Date()) {
      return res.status(410).json({
        valid: false,
        error: 'This invitation QR code has expired. Please request a new QR code from your family manager.'
      });
    }

    // Return strictly non-sensitive confirmation metadata
    return res.json({
      valid: true,
      family_id: inv.family_id,
      family_name: inv.family_name,
      inviter_name: inv.inviter_name || 'Family Manager',
      expires_at: inv.expires_at
    });
  } catch (err) {
    console.error('[Family API] validateInvitation error:', err);
    return res.status(500).json({ valid: false, error: 'Failed to validate invitation.' });
  }
}

/**
 * 5. Submit Join Request
 * POST /api/family/join-requests
 * Authenticated user submits a join request using a validated token.
 */
async function submitJoinRequest(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: 'Validation failed', details: errors.array() });
  }

  const userId = req.user.id;
  const { invitation_token, relationship } = req.body;
  const tokenHash = hashToken(invitation_token.trim());

  try {
    // 1. Check if user already has an active family membership
    const activeMember = await getCallerActiveMembership(userId);
    if (activeMember) {
      return res.status(400).json({
        error: `You are already an active member of "${activeMember.family_name}". Leave your current family before joining another.`
      });
    }

    // 2. Validate token
    const [invRows] = await pool.query(
      `SELECT fi.id AS invitation_id, fi.family_id, fi.expires_at, fi.revoked_at,
              fg.family_name, fg.status AS group_status
       FROM family_invitations fi
       JOIN family_groups fg ON fi.family_id = fg.id
       WHERE fi.token_hash = ?
       LIMIT 1`,
      [tokenHash]
    );

    if (invRows.length === 0) {
      return res.status(404).json({ error: 'Invalid invitation token.' });
    }

    const inv = invRows[0];
    if (inv.group_status !== 'active') {
      return res.status(410).json({ error: 'This family group is no longer active.' });
    }
    if (inv.revoked_at !== null) {
      return res.status(410).json({ error: 'This invitation QR code has been revoked.' });
    }
    if (new Date(inv.expires_at) < new Date()) {
      return res.status(410).json({ error: 'This invitation QR code has expired.' });
    }

    // 3. Prevent duplicate active or pending join requests
    const [existingReq] = await pool.query(
      `SELECT id, request_status FROM family_join_requests
       WHERE family_id = ? AND user_id = ? AND request_status = 'pending'`,
      [inv.family_id, userId]
    );

    if (existingReq.length > 0) {
      return res.status(409).json({
        error: 'You already have a pending join request for this family. Please wait for the family manager to approve.'
      });
    }

    // 4. Create join request (preserving requested relationship for manager review)
    const cleanRelationship = relationship && relationship.trim() ? relationship.trim().slice(0, 60) : 'Member';
    const [insertResult] = await pool.query(
      `INSERT INTO family_join_requests (family_id, user_id, invitation_id, relationship, request_status)
       VALUES (?, ?, ?, ?, 'pending')`,
      [inv.family_id, userId, inv.invitation_id, cleanRelationship]
    );

    return res.status(201).json({
      message: 'Join request submitted successfully. Awaiting approval from the family manager.',
      request: {
        id: insertResult.insertId,
        family_id: inv.family_id,
        family_name: inv.family_name,
        relationship: cleanRelationship,
        request_status: 'pending',
        requested_at: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error('[Family API] submitJoinRequest error:', err);
    return res.status(500).json({ error: 'Failed to submit join request.' });
  }
}

/**
 * 6. Get Pending Join Requests (Manager Only)
 * GET /api/family/join-requests
 */
async function getPendingJoinRequests(req, res) {
  const userId = req.user.id;

  try {
    const membership = await getCallerActiveMembership(userId);
    if (!membership || membership.membership_role !== 'manager') {
      return res.status(403).json({ error: 'Only family managers can view pending join requests.' });
    }

    const [requests] = await pool.query(
      `SELECT fjr.id, fjr.user_id, fjr.invitation_id, fjr.relationship, fjr.request_status, fjr.requested_at,
              u.name AS applicant_name, u.email AS applicant_email
       FROM family_join_requests fjr
       JOIN users u ON fjr.user_id = u.id
       WHERE fjr.family_id = ? AND fjr.request_status = 'pending'
       ORDER BY fjr.requested_at ASC`,
      [membership.family_id]
    );

    return res.json({ pendingRequests: requests });
  } catch (err) {
    console.error('[Family API] getPendingJoinRequests error:', err);
    return res.status(500).json({ error: 'Failed to retrieve pending join requests.' });
  }
}

/**
 * 7. Review Join Request (Approve or Reject)
 * PUT /api/family/join-requests/:id/review
 * Only family manager can approve/reject.
 * Prevents approving one's own request if requested as another user.
 */
async function reviewJoinRequest(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: 'Validation failed', details: errors.array() });
  }

  const managerUserId = req.user.id;
  const requestId = parseInt(req.params.id, 10);
  const { action } = req.body; // 'approve' | 'reject'

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Verify caller is an active manager of an active family group
    const [managerRows] = await connection.query(
      `SELECT fm.id, fm.family_id, fm.membership_role
       FROM family_members fm
       JOIN family_groups fg ON fg.id = fm.family_id
       WHERE fm.user_id = ?
         AND fm.membership_status = 'active'
         AND fm.membership_role = 'manager'
         AND fg.status = 'active'
       LIMIT 1`,
      [managerUserId]
    );

    if (managerRows.length === 0) {
      await connection.rollback();
      return res.status(403).json({ error: 'Only authorized family managers can review join requests.' });
    }

    const familyId = managerRows[0].family_id;

    // 2. Fetch target request
    const [requestRows] = await connection.query(
      `SELECT fjr.*, u.name AS applicant_name, u.status AS applicant_status
       FROM family_join_requests fjr
       JOIN users u ON fjr.user_id = u.id
       WHERE fjr.id = ? AND fjr.family_id = ? AND fjr.request_status = 'pending'
       FOR UPDATE`,
      [requestId, familyId]
    );

    if (requestRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Pending join request not found.' });
    }

    const request = requestRows[0];

    // Security check: cannot approve own request
    if (request.user_id === managerUserId) {
      await connection.rollback();
      return res.status(400).json({ error: 'Managers cannot approve their own requests.' });
    }

    const now = new Date();
    const newStatus = action === 'approve' ? 'approved' : 'rejected';

    // 3. If approving, verify applicant does not already hold an active membership in ANY family
    let newMemberId = null;
    if (action === 'approve') {
      if (request.applicant_status && request.applicant_status !== 'active') {
        await connection.rollback();
        return res.status(400).json({ error: 'Cannot approve join request: applicant account is not active.' });
      }

      const [existingActive] = await connection.query(
        `SELECT fm.id, fm.family_id
         FROM family_members fm
         WHERE fm.user_id = ? AND fm.membership_status = 'active'
         FOR UPDATE`,
        [request.user_id]
      );

      if (existingActive.length > 0) {
        await connection.rollback();
        if (existingActive[0].family_id === familyId) {
          return res.status(409).json({ error: 'User is already an active member of this family group.' });
        }
        return res.status(409).json({
          error: 'Applicant is already an active member of another family group and cannot hold multiple active memberships.'
        });
      }

      const memberRelationship = (request.relationship && String(request.relationship).trim())
        ? String(request.relationship).trim().slice(0, 60)
        : 'Member';

      // Insert new member or reactivate previously inactive/removed membership row
      const [memInsert] = await connection.query(
        `INSERT INTO family_members (family_id, user_id, relationship, membership_role, membership_status, joined_at)
         VALUES (?, ?, ?, 'member', 'active', ?)
         ON DUPLICATE KEY UPDATE
           relationship = VALUES(relationship),
           membership_role = 'member',
           membership_status = 'active',
           joined_at = VALUES(joined_at)`,
        [familyId, request.user_id, memberRelationship, now]
      );
      newMemberId = memInsert.insertId || null;

      // Fetch inserted/updated id if ON DUPLICATE KEY reactivated an existing historical row
      if (!newMemberId) {
        const [findId] = await connection.query(
          `SELECT id FROM family_members WHERE family_id = ? AND user_id = ? LIMIT 1`,
          [familyId, request.user_id]
        );
        newMemberId = findId[0]?.id || null;
      }

      // Initialize location consent as disabled (Explicit member consent required)
      if (newMemberId) {
        await connection.query(
          `INSERT INTO family_location_sharing_consents (family_member_id, sharing_enabled, consented_at, revoked_at)
           VALUES (?, 0, NULL, NULL)
           ON DUPLICATE KEY UPDATE
             sharing_enabled = 0,
             consented_at = NULL,
             revoked_at = ?`,
          [newMemberId, now]
        );
      }

      // Cancel any other pending join requests from this user across any family
      await connection.query(
        `UPDATE family_join_requests
         SET request_status = 'cancelled', reviewed_at = ?
         WHERE user_id = ? AND request_status = 'pending' AND id <> ?`,
        [now, request.user_id, requestId]
      );
    }

    // 4. Update join request status
    await connection.query(
      `UPDATE family_join_requests
       SET request_status = ?, reviewed_by = ?, reviewed_at = ?
       WHERE id = ?`,
      [newStatus, managerUserId, now, requestId]
    );

    await connection.commit();

    return res.json({
      message: `Join request successfully ${newStatus}.`,
      request_id: requestId,
      status: newStatus,
      new_member_id: newMemberId
    });
  } catch (err) {
    await connection.rollback();
    console.error('[Family API] reviewJoinRequest error:', err);
    return res.status(500).json({ error: 'Failed to review join request.' });
  } finally {
    connection.release();
  }
}

/**
 * 8. Remove Family Member
 * DELETE /api/family/members/:memberId
 * Managers can remove members. Regular members cannot remove others.
 */
async function removeFamilyMember(req, res) {
  const managerUserId = req.user.id;
  const targetMemberId = parseInt(req.params.memberId, 10);

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [managerRows] = await connection.query(
      `SELECT fm.id, fm.family_id, fm.membership_role
       FROM family_members fm
       WHERE fm.user_id = ? AND fm.membership_status = 'active' AND fm.membership_role = 'manager'
       LIMIT 1`,
      [managerUserId]
    );

    if (managerRows.length === 0) {
      await connection.rollback();
      return res.status(403).json({ error: 'Only authorized family managers can remove family members.' });
    }

    const familyId = managerRows[0].family_id;

    // Check target member
    const [targetRows] = await connection.query(
      `SELECT id, user_id, membership_role FROM family_members
       WHERE id = ? AND family_id = ? AND membership_status = 'active'`,
      [targetMemberId, familyId]
    );

    if (targetRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Member not found in your family group.' });
    }

    // Do not remove self via this endpoint (use leaveFamilyGroup instead)
    if (targetRows[0].user_id === managerUserId) {
      await connection.rollback();
      return res.status(400).json({ error: 'Use the leave family option to remove yourself.' });
    }

    // Mark as removed rather than hard-deleting
    await connection.query(
      `UPDATE family_members
       SET membership_status = 'removed'
       WHERE id = ?`,
      [targetMemberId]
    );

    // Revoke any active location consent
    await connection.query(
      `UPDATE family_location_sharing_consents
       SET sharing_enabled = 0, revoked_at = NOW()
       WHERE family_member_id = ?`,
      [targetMemberId]
    );

    await connection.commit();

    return res.json({
      message: 'Family member removed successfully.',
      member_id: targetMemberId
    });
  } catch (err) {
    await connection.rollback();
    console.error('[Family API] removeFamilyMember error:', err);
    return res.status(500).json({ error: 'Failed to remove family member.' });
  } finally {
    connection.release();
  }
}

/**
 * 9. Revoke Active Invitation
 * DELETE /api/family/invitations/:id
 */
async function revokeInvitation(req, res) {
  const userId = req.user.id;
  const invitationId = parseInt(req.params.id, 10);

  try {
    const membership = await getCallerActiveMembership(userId);
    if (!membership || membership.membership_role !== 'manager') {
      return res.status(403).json({ error: 'Only family managers can revoke invitations.' });
    }

    const [result] = await pool.query(
      `UPDATE family_invitations
       SET revoked_at = NOW()
       WHERE id = ? AND family_id = ? AND revoked_at IS NULL`,
      [invitationId, membership.family_id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Active invitation not found or already revoked.' });
    }

    return res.json({ message: 'Invitation QR code successfully revoked.' });
  } catch (err) {
    console.error('[Family API] revokeInvitation error:', err);
    return res.status(500).json({ error: 'Failed to revoke invitation.' });
  }
}

/**
 * 10. Toggle Location Sharing Privacy Consent
 * PUT /api/family/location-sharing
 * Explicit consent required. Can be revoked at any time.
 */
async function toggleLocationSharing(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: 'Validation failed', details: errors.array() });
  }

  const userId = req.user.id;
  const { enabled } = req.body;

  try {
    const membership = await getCallerActiveMembership(userId);
    if (!membership) {
      return res.status(404).json({ error: 'You are not an active member of any family group.' });
    }

    const memberId = membership.member_id;
    const now = new Date();

    if (enabled) {
      // User grants explicit location sharing consent
      await pool.query(
        `INSERT INTO family_location_sharing_consents (family_member_id, sharing_enabled, consented_at, revoked_at)
         VALUES (?, 1, ?, NULL)
         ON DUPLICATE KEY UPDATE sharing_enabled = 1, consented_at = ?, revoked_at = NULL`,
        [memberId, now, now]
      );
    } else {
      // User revokes location sharing consent
      await pool.query(
        `INSERT INTO family_location_sharing_consents (family_member_id, sharing_enabled, consented_at, revoked_at)
         VALUES (?, 0, NULL, ?)
         ON DUPLICATE KEY UPDATE sharing_enabled = 0, revoked_at = ?`,
        [memberId, now, now]
      );
    }

    return res.json({
      message: enabled ? 'Location sharing enabled.' : 'Location sharing revoked. Your location is no longer visible to family members.',
      location_sharing_enabled: !!enabled,
      status: enabled ? 'Sharing Location' : 'Location sharing off'
    });
  } catch (err) {
    console.error('[Family API] toggleLocationSharing error:', err);
    return res.status(500).json({ error: 'Failed to update location sharing consent.' });
  }
}

/**
 * 11. Post Location Coordinate Update
 * POST /api/family/location-update
 * Only accepted if location sharing is currently enabled.
 */
async function updateLocationCoordinates(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: 'Validation failed', details: errors.array() });
  }

  const userId = req.user.id;
  const { latitude, longitude, battery_level, safety_status } = req.body;

  try {
    const membership = await getCallerActiveMembership(userId);
    if (!membership) {
      return res.status(404).json({ error: 'Active family membership not found.' });
    }

    if (!membership.sharing_enabled) {
      return res.status(403).json({
        error: 'Location sharing is disabled for your account. Enable location sharing first.'
      });
    }

    // Never default a member's safety_status to 'safe' when not explicitly reported
    const normalizedSafetyStatus = safety_status || 'no_response';

    await pool.query(
      `INSERT INTO family_location_updates (family_member_id, latitude, longitude, battery_level, safety_status)
       VALUES (?, ?, ?, ?, ?)`,
      [membership.member_id, latitude, longitude, battery_level !== undefined ? battery_level : null, normalizedSafetyStatus]
    );

    return res.json({
      message: 'Location coordinate recorded.',
      recorded_at: new Date().toISOString()
    });
  } catch (err) {
    console.error('[Family API] updateLocationCoordinates error:', err);
    return res.status(500).json({ error: 'Failed to record location update.' });
  }
}

/**
 * 12. Retrieve Authorized Family Locations
 * GET /api/family/locations
 * Only returns coordinates for members who have sharing_enabled = 1.
 */
async function getFamilyLocations(req, res) {
  const userId = req.user.id;

  try {
    const membership = await getCallerActiveMembership(userId);
    if (!membership) {
      return res.json({ locations: [] });
    }

    // Strictly enforce consent: only select coordinates where sharing_enabled = 1
    const [locations] = await pool.query(
      `SELECT fm.id AS member_id, fm.relationship, u.name,
              flu.latitude, flu.longitude, flu.battery_level, flu.safety_status, flu.recorded_at
       FROM family_members fm
       JOIN users u ON fm.user_id = u.id
       JOIN family_location_sharing_consents flc ON fm.id = flc.family_member_id
       JOIN (
         SELECT flu1.*
         FROM family_location_updates flu1
         INNER JOIN (
           SELECT family_member_id, MAX(recorded_at) AS max_rec
           FROM family_location_updates
           GROUP BY family_member_id
         ) flu2 ON flu1.family_member_id = flu2.family_member_id AND flu1.recorded_at = flu2.max_rec
       ) flu ON fm.id = flu.family_member_id
       WHERE fm.family_id = ? AND fm.membership_status = 'active' AND flc.sharing_enabled = 1`,
      [membership.family_id]
    );

    return res.json({
      locations: locations.map(loc => ({
        member_id: loc.member_id,
        name: loc.name,
        relationship: loc.relationship,
        latitude: parseFloat(loc.latitude),
        longitude: parseFloat(loc.longitude),
        battery_level: loc.battery_level,
        safety_status: loc.safety_status || 'no_response',
        recorded_at: loc.recorded_at
      }))
    });
  } catch (err) {
    console.error('[Family API] getFamilyLocations error:', err);
    return res.status(500).json({ error: 'Failed to retrieve family locations.' });
  }
}

/**
 * 13. Leave Family Group
 * POST /api/family/leave
 */
async function leaveFamilyGroup(req, res) {
  const userId = req.user.id;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [callerRows] = await connection.query(
      `SELECT fm.id AS member_id, fm.family_id, fm.membership_role
       FROM family_members fm
       JOIN family_groups fg ON fg.id = fm.family_id
       WHERE fm.user_id = ? AND fm.membership_status = 'active' AND fg.status = 'active'
       FOR UPDATE`,
      [userId]
    );

    if (callerRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'You are not an active member of any family.' });
    }

    const membership = callerRows[0];

    // Check remaining active members in the family group
    const [otherMembers] = await connection.query(
      `SELECT id, membership_role FROM family_members
       WHERE family_id = ? AND user_id != ? AND membership_status = 'active'
       ORDER BY joined_at ASC, id ASC
       FOR UPDATE`,
      [membership.family_id, userId]
    );

    // If manager leaves and other members remain, ensure another manager exists
    if (membership.membership_role === 'manager' && otherMembers.length > 0) {
      const hasOtherManager = otherMembers.some(m => m.membership_role === 'manager');
      if (!hasOtherManager) {
        // Promote the longest-standing active member to manager
        await connection.query(
          `UPDATE family_members
           SET membership_role = 'manager'
           WHERE id = ?`,
          [otherMembers[0].id]
        );
      }
    }

    // Set membership to inactive (preserving membership history)
    await connection.query(
      `UPDATE family_members
       SET membership_status = 'inactive'
       WHERE id = ?`,
      [membership.member_id]
    );

    // Revoke location sharing consent
    await connection.query(
      `UPDATE family_location_sharing_consents
       SET sharing_enabled = 0, revoked_at = NOW()
       WHERE family_member_id = ?`,
      [membership.member_id]
    );

    // If no active members remain, archive the family group and revoke/cancel pending invites & requests
    if (otherMembers.length === 0) {
      await connection.query(
        `UPDATE family_groups SET status = 'archived' WHERE id = ?`,
        [membership.family_id]
      );
      await connection.query(
        `UPDATE family_invitations SET revoked_at = NOW() WHERE family_id = ? AND revoked_at IS NULL`,
        [membership.family_id]
      );
      await connection.query(
        `UPDATE family_join_requests SET request_status = 'cancelled', reviewed_at = NOW() WHERE family_id = ? AND request_status = 'pending'`,
        [membership.family_id]
      );
    }

    await connection.commit();
    return res.json({ message: 'You have left the family group.' });
  } catch (err) {
    await connection.rollback();
    console.error('[Family API] leaveFamilyGroup error:', err);
    return res.status(500).json({ error: 'Failed to leave family group.' });
  } finally {
    connection.release();
  }
}

/**
 * 14. Update Family Address
 * PUT /api/family/address
 * Only authorized family managers may update the shared family address.
 * Fixed location is strictly enforced server-side:
 * - Barangay: Bayanan
 * - City: Muntinlupa City
 * - Province: Metro Manila
 * - Region: National Capital Region
 * - Country: Philippines
 */
async function updateFamilyAddress(req, res) {
  const userId = req.user.id;
  // Only these two resident inputs are read. Any frontend-supplied barangay, city,
  // province, region, country, zip or subdivision values are deliberately ignored.
  const house_number = typeof req.body.house_number === 'string' ? req.body.house_number.trim() : '';
  const street = typeof req.body.street === 'string' ? req.body.street.trim() : '';

  try {
    const membership = await getCallerActiveMembership(userId);
    if (!membership) {
      return res.status(404).json({ error: 'You are not an active member of any family group.' });
    }

    if (membership.membership_role !== 'manager') {
      return res.status(403).json({ error: 'Only authorized family managers may update the shared family address.' });
    }

    if (!street || !house_number) {
      return res.status(400).json({ error: 'House / Building Number and Street Name are required.' });
    }
    if (house_number.length > 50 || street.length > 150) {
      return res.status(400).json({ error: 'House / Building Number (max 50) or Street Name (max 150) is too long.' });
    }

    // Fixed location values - system-assigned, never taken from the request
    const FIXED_BARANGAY = 'Bayanan';
    const FIXED_CITY = 'Muntinlupa City';
    const FIXED_PROVINCE = 'Metro Manila';
    const FIXED_REGION = 'National Capital Region';
    const FIXED_COUNTRY = 'Philippines';

    const familyId = membership.family_id;

    await pool.query(
      `UPDATE family_groups
       SET house_number = ?, street = ?, barangay = ?, city = ?, province = ?, region = ?, country = ?
       WHERE id = ?`,
      [house_number, street, FIXED_BARANGAY, FIXED_CITY, FIXED_PROVINCE, FIXED_REGION, FIXED_COUNTRY, familyId]
    );

    const formattedAddress = `${house_number} ${street}, Barangay ${FIXED_BARANGAY}, ${FIXED_CITY}, ${FIXED_PROVINCE}, ${FIXED_COUNTRY}`;

    return res.json({
      message: 'Family address updated successfully.',
      address: {
        house_number,
        street,
        barangay: FIXED_BARANGAY,
        city: FIXED_CITY,
        province: FIXED_PROVINCE,
        region: FIXED_REGION,
        country: FIXED_COUNTRY,
        formatted: formattedAddress
      }
    });
  } catch (err) {
    console.error('[Family API] updateFamilyAddress error:', err);
    return res.status(500).json({ error: 'Failed to update family address.' });
  }
}

module.exports = {
  createFamilyGroup,
  getMyFamily,
  generateInvitation,
  validateInvitation,
  submitJoinRequest,
  getPendingJoinRequests,
  reviewJoinRequest,
  removeFamilyMember,
  revokeInvitation,
  toggleLocationSharing,
  updateLocationCoordinates,
  getFamilyLocations,
  leaveFamilyGroup,
  updateFamilyAddress,
};
