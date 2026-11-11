const pool = require('./db');
const { roleLabel } = require('../config/roles');

async function findByEmail(email) {
  const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
  if (!rows[0]) return null;
  const user = rows[0];
  user.role = roleLabel(user.role_id) || user.role;
  return user;
}

async function findById(id) {
  const [rows] = await pool.query(
    'SELECT id, user_code, name, email, role_id, role, status, created_at FROM users WHERE id = ?',
    [id]
  );
  if (!rows[0]) return null;
  const user = rows[0];
  user.role = roleLabel(user.role_id) || user.role;
  return user;
}

module.exports = { findByEmail, findById };
