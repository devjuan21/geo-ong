/**
 * GeoSafe — Single Initial Administrator Provisioning Script (PostgreSQL-Compatible)
 *
 * Ensures exactly one active Administrator account exists (`admin@geosafe.ph`)
 * using the project's bcrypt cost factor (12) and canonical `ADM-0001` user_code.
 *
 * Usage:
 *   $env:ADMIN_INITIAL_PASSWORD="<initial_password>"
 *   node database/provision_initial_admin.js
 */
const path = require('path');
require(path.join(__dirname, '../backend/node_modules/dotenv')).config({
  path: path.join(__dirname, '../backend/.env'),
});
const bcrypt = require(path.join(__dirname, '../backend/node_modules/bcrypt'));
const pool = require('../backend/config/db');
const { ROLE_IDS } = require('../backend/config/roles');
const { generateNextUserCode } = require('../backend/services/userIdService');

const BCRYPT_ROUNDS = 12;
const TARGET_EMAIL = 'admin@geosafe.ph';
const TARGET_NAME = 'GeoSafe Administrator';

async function provisionAdmin() {
  const initialPassword = process.env.ADMIN_INITIAL_PASSWORD;
  if (!initialPassword || initialPassword.length < 6) {
    throw new Error('Set ADMIN_INITIAL_PASSWORD (min 6 chars) in the environment before running.');
  }

  const passwordHash = await bcrypt.hash(initialPassword, BCRYPT_ROUNDS);
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const [existingRows] = await conn.query(
      'SELECT id, user_code, email, role_id, status, account_status FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1 FOR UPDATE',
      [TARGET_EMAIL]
    );

    let adminId;
    let userCode;

    if (existingRows.length > 0) {
      adminId = existingRows[0].id;
      if (existingRows[0].user_code) {
        userCode = existingRows[0].user_code;
      } else {
        const gen = await generateNextUserCode(conn, ROLE_IDS.ADMINISTRATOR);
        userCode = gen.userCode;
      }
      await conn.query(
        `UPDATE users
         SET name = ?, password_hash = ?, role_id = ?, status = 'active', account_status = 'active',
             user_code = COALESCE(user_code, ?)
         WHERE id = ?`,
        [TARGET_NAME, passwordHash, ROLE_IDS.ADMINISTRATOR, userCode, adminId]
      );
      console.log(`Updated existing Administrator account (id=${adminId}, user_code=${userCode}).`);
    } else {
      const gen = await generateNextUserCode(conn, ROLE_IDS.ADMINISTRATOR);
      userCode = gen.userCode;
      const [insRes] = await conn.query(
        `INSERT INTO users (user_code, name, email, password_hash, role_id, status, account_status)
         VALUES (?, ?, ?, ?, ?, 'active', 'active')`,
        [userCode, TARGET_NAME, TARGET_EMAIL, passwordHash, ROLE_IDS.ADMINISTRATOR]
      );
      adminId = insRes.insertId;
      console.log(`Provisioned initial Administrator account (id=${adminId}, user_code=${userCode}).`);
    }

    await conn.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_values)
       VALUES (?, 'INITIAL_ADMIN_PROVISIONED', 'users', ?, ?)`,
      [adminId, String(adminId), JSON.stringify({ email: TARGET_EMAIL, user_code: userCode, role_id: ROLE_IDS.ADMINISTRATOR })]
    );

    await conn.commit();
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
    await pool.end();
  }
}

provisionAdmin().catch((err) => {
  console.error('Admin provisioning failed:', err.message);
  process.exit(1);
});

