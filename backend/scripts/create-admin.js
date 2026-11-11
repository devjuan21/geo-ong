#!/usr/bin/env node
/**
 * GeoSafe — One-Time Initial Administrator Provisioning CLI
 * ============================================================================
 * Purpose:
 *   Securely provisions the first Administrator account (role_id = 1) in a
 *   freshly installed `geosafe_db` MySQL database.
 *
 * Security Guarantees:
 *   - Requires deliberate interactive terminal execution (TTY check).
 *   - Refuses to run if ANY Administrator account (role_id = 1) already exists.
 *   - Enforces a MySQL transaction with `FOR UPDATE` locks to prevent race conditions.
 *   - Prompts interactively for Email, First Name, Surname, and Password.
 *   - Masks password characters during terminal input and never logs plaintext passwords.
 *   - Hashes password with bcrypt before inserting into `users`.
 *   - Sets both `role_id = 1` (authoritative FK to `roles.id`) and `role = 'admin'`.
 * ============================================================================
 */

const path = require('path');
const readline = require('readline');

// Load backend .env configuration regardless of working directory
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const bcrypt = require('bcrypt');
const pool = require('../models/db');
const { ROLE_IDS, roleLabel } = require('../config/roles');
const { generateNextUserCode } = require('../services/userIdService');

const BCRYPT_ROUNDS = 12;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function askText(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(String(answer || '').trim());
    });
  });
}

function askHiddenPassword(promptText) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;

    stdout.write(promptText);

    const wasRaw = stdin.isRaw;
    if (stdin.isTTY && typeof stdin.setRawMode === 'function') {
      stdin.setRawMode(true);
    }
    stdin.resume();
    stdin.setEncoding('utf8');

    let password = '';

    function cleanup() {
      stdin.removeListener('data', onData);
      if (stdin.isTTY && typeof stdin.setRawMode === 'function') {
        stdin.setRawMode(Boolean(wasRaw));
      }
      stdin.pause();
    }

    function onData(char) {
      const str = String(char);

      // Ctrl+C or Ctrl+D
      if (str === '\u0003' || str === '\u0004') {
        cleanup();
        stdout.write('\n');
        reject(new Error('Operation cancelled by operator.'));
        return;
      }

      // Enter / Return
      if (str === '\r' || str === '\n' || str === '\r\n') {
        cleanup();
        stdout.write('\n');
        resolve(password);
        return;
      }

      // Backspace or Delete
      if (str === '\u0008' || str === '\u007f') {
        if (password.length > 0) {
          password = password.slice(0, -1);
          stdout.write('\b \b');
        }
        return;
      }

      // Handle pasted or multi-character chunks (strip any trailing newline)
      for (const ch of str) {
        if (ch === '\r' || ch === '\n') {
          cleanup();
          stdout.write('\n');
          resolve(password);
          return;
        }
        if (ch >= ' ') {
          password += ch;
          stdout.write('*');
        }
      }
    }

    stdin.on('data', onData);
  });
}

async function main() {
  console.log('======================================================================');
  console.log(' GeoSafe — Initial Administrator Account Provisioning Tool');
  console.log(' Target Database: geosafe_db (MySQL)');
  console.log('======================================================================\n');

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error('[ABORTED] This provisioning tool requires an interactive terminal (TTY).');
    process.exit(1);
  }

  let preCheckConn;
  try {
    preCheckConn = await pool.getConnection();
  } catch (err) {
    console.error('[ERROR] Could not connect to MySQL database (`geosafe_db`).');
    console.error(`        Reason: ${err.message}`);
    console.error('        Verify DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, and DB_NAME in backend/.env.');
    await pool.end().catch(() => {});
    process.exit(1);
  }

  try {
    // 1. Verify canonical Administrator role exists in `roles`
    const [roleRows] = await preCheckConn.query(
      'SELECT id, name FROM roles WHERE id = ? LIMIT 1',
      [ROLE_IDS.ADMINISTRATOR]
    );
    if (!roleRows.length || roleRows[0].name !== 'Administrator') {
      console.error(
        `[ABORTED] Canonical Administrator role (id=${ROLE_IDS.ADMINISTRATOR}, name='Administrator') was not found in the \`roles\` table.`
      );
      process.exit(1);
    }

    // 2. One-Time Protection Pre-Check: Refuse if an Administrator already exists
    const [existingAdmins] = await preCheckConn.query(
      'SELECT id, email, created_at FROM users WHERE role_id = ? LIMIT 1',
      [ROLE_IDS.ADMINISTRATOR]
    );
    if (existingAdmins.length > 0) {
      console.error('[REFUSED] An Administrator account already exists in `geosafe_db`.');
      console.error('          This CLI tool is strictly for one-time initial Administrator setup.');
      console.error('          Additional accounts must be created by an authenticated Administrator');
      console.error('          through the GeoSafe Administrator portal.');
      process.exit(1);
    }
  } finally {
    preCheckConn.release();
  }

  try {
    // 3. Collect & validate Email, First Name, Surname, and Password interactively
    let email = '';
    while (!email) {
      const rawEmail = await askText('1. Enter Administrator Email Address: ');
      const normalized = rawEmail.toLowerCase();
      if (!normalized || !EMAIL_REGEX.test(normalized) || normalized.length > 160) {
        console.log('   [!] Please enter a valid email address (max 160 characters).');
        continue;
      }

      const [dupRows] = await pool.query('SELECT id FROM users WHERE email = ? LIMIT 1', [normalized]);
      if (dupRows.length > 0) {
        console.log('   [!] That email address is already registered in `users`. Please use a unique email.');
        continue;
      }
      email = normalized;
    }

    let firstName = '';
    while (!firstName) {
      const input = await askText('2. Enter First Name: ');
      if (input.length < 1 || input.length > 60) {
        console.log('   [!] First name is required (1 to 60 characters).');
        continue;
      }
      firstName = input;
    }

    let surname = '';
    while (!surname) {
      const input = await askText('3. Enter Surname (Last Name): ');
      if (input.length < 1 || input.length > 60) {
        console.log('   [!] Surname is required (1 to 60 characters).');
        continue;
      }
      surname = input;
    }

    const fullName = `${firstName} ${surname}`.trim();
    if (fullName.length < 2 || fullName.length > 120) {
      console.error('[ABORTED] Combined full name must be between 2 and 120 characters.');
      process.exit(1);
    }

    let password = '';
    while (!password) {
      const p1 = await askHiddenPassword('4. Enter Password (minimum 8 characters, input hidden): ');
      if (!p1 || p1.length < 8) {
        console.log('   [!] Password must be at least 8 characters long.');
        continue;
      }
      if (p1.length > 72) {
        console.log('   [!] Password must not exceed 72 characters.');
        continue;
      }

      const p2 = await askHiddenPassword('5. Confirm Password (input hidden): ');
      if (p1 !== p2) {
        console.log('   [!] Passwords do not match. Please try again.');
        continue;
      }
      password = p1;
    }

    console.log('\nHashing password and provisioning initial Administrator in MySQL...');
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    // Clear plaintext password reference from memory immediately
    password = '';

    // 4. Execute atomic MySQL transaction with FOR UPDATE lock
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // Lock the Administrator role row to serialize any concurrent provisioning attempts
      const [lockedRole] = await conn.query(
        'SELECT id, name FROM roles WHERE id = ? AND name = ? FOR UPDATE',
        [ROLE_IDS.ADMINISTRATOR, 'Administrator']
      );
      if (!lockedRole.length) {
        await conn.rollback();
        console.error('[ABORTED] Administrator role record is missing in `roles`.');
        process.exit(1);
      }

      // Re-verify inside transaction that no Administrator account exists
      const [adminCheck] = await conn.query(
        'SELECT id FROM users WHERE role_id = ? LIMIT 1 FOR UPDATE',
        [ROLE_IDS.ADMINISTRATOR]
      );
      if (adminCheck.length > 0) {
        await conn.rollback();
        console.error('[REFUSED] An Administrator account already exists. Transaction rolled back.');
        process.exit(1);
      }

      // Re-verify email uniqueness inside transaction
      const [emailCheck] = await conn.query(
        'SELECT id FROM users WHERE email = ? LIMIT 1 FOR UPDATE',
        [email]
      );
      if (emailCheck.length > 0) {
        await conn.rollback();
        console.error('[ABORTED] Email address is already registered. Transaction rolled back.');
        process.exit(1);
      }

      const adminRoleId = ROLE_IDS.ADMINISTRATOR;
      const legacyRoleEnum = roleLabel(adminRoleId); // 'admin'
      const { userCode } = await generateNextUserCode(conn, adminRoleId);

      const [insertUser] = await conn.query(
        `INSERT INTO users (user_code, name, email, password_hash, role_id, role, status, account_status)
         VALUES (?, ?, ?, ?, ?, ?, 'active', 'active')`,
        [userCode, fullName, email, passwordHash, adminRoleId, legacyRoleEnum]
      );

      const newAdminId = insertUser.insertId;

      // Create corresponding 1:1 profile in user_profiles (fixed Barangay Bayanan jurisdiction)
      await conn.query(
        `INSERT INTO user_profiles
           (user_id, first_name, last_name, barangay, city, province, verification_status)
         VALUES (?, ?, ?, 'Barangay Bayanan', 'Muntinlupa City', 'Metro Manila', 'Verified Resident')`,
        [newAdminId, firstName, surname]
      );

      // Record immutable administrative audit trail
      await conn.query(
        `INSERT INTO audit_logs
           (user_id, action, entity_type, entity_id, new_values, ip_address, user_agent)
         VALUES (?, 'INITIAL_ADMIN_PROVISIONED', 'users', ?, ?, '127.0.0.1', 'geosafe-cli/create-admin')`,
        [
          newAdminId,
          String(newAdminId),
          JSON.stringify({
            id: newAdminId,
            user_code: userCode,
            name: fullName,
            email,
            role_id: adminRoleId,
            role: legacyRoleEnum,
            status: 'active',
          }),
        ]
      );

      await conn.commit();

      console.log('\n======================================================================');
      console.log(' [SUCCESS] Initial Administrator Account Provisioned');
      console.log('======================================================================');
      console.log(` User ID    : ${userCode} (Role Prefix: ADM)`);
      console.log(` Account ID : ${newAdminId}`);
      console.log(` Full Name  : ${fullName}`);
      console.log(` Email      : ${email}`);
      console.log(` Role       : Administrator (role_id = ${adminRoleId})`);
      console.log(` Status     : active`);
      console.log('----------------------------------------------------------------------');
      console.log(' Next Steps:');
      console.log('   1. Start the backend server: npm start');
      console.log('   2. Open http://localhost:3000/login.html in your browser');
      console.log('   3. Sign in with your Administrator email and password');
      console.log('   4. You will be automatically routed to /admin.html');
      console.log('======================================================================\n');
    } catch (txErr) {
      await conn.rollback().catch(() => {});
      throw txErr;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error(`\n[ERROR] Administrator provisioning failed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
  }
}

main();

