const { VALID_ROLE_LABELS } = require('../config/roles');

/**
 * Role gate. MUST run after authenticate(): req.user.role is derived from the
 * database role_id by the auth middleware, never from client-supplied token claims.
 * Unknown role labels passed by a developer are rejected at startup, not silently ignored.
 */
function requireRole(...roles) {
  const unknown = roles.filter((r) => !VALID_ROLE_LABELS.includes(r));
  if (unknown.length) {
    throw new Error(`requireRole() received unauthorized role(s): ${unknown.join(', ')}`);
  }

  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

module.exports = { requireRole };
