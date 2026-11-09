/**
 * GeoSafe canonical application roles.
 *
 * roles.id / users.role_id is the ONLY authoritative role relationship.
 * The string labels below are derived from role_id for API/JWT-facing code
 * (req.user.role, requireRole('admin')). They are never read from a users.role column.
 *
 * Exactly three roles exist. Adding a role requires a schema migration, not code.
 */
const ROLE_IDS = Object.freeze({
  ADMINISTRATOR: 1,
  RESPONDER: 2,
  RESIDENT: 3,
});

// role_id -> API label (kept stable for existing frontend and requireRole() callers)
const ROLE_LABELS = Object.freeze({
  [ROLE_IDS.ADMINISTRATOR]: 'admin',
  [ROLE_IDS.RESPONDER]: 'responder',
  [ROLE_IDS.RESIDENT]: 'resident',
});

function isValidRoleId(value) {
  const n = typeof value === 'string' && /^\d+$/.test(value) ? parseInt(value, 10) : value;
  return Number.isInteger(n) && Object.prototype.hasOwnProperty.call(ROLE_LABELS, n);
}

function roleLabel(roleId) {
  return ROLE_LABELS[roleId] || null;
}

module.exports = { ROLE_IDS, ROLE_LABELS, VALID_ROLE_LABELS: Object.values(ROLE_LABELS), isValidRoleId, roleLabel };

