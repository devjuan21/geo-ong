/**
 * GeoSafe — Centralized User Identifier Service
 * ============================================================================
 * Generates human-readable, role-specific, transaction-safe User Identifiers:
 *   - Administrator (Role ID 1): ADM-0001, ADM-0002...
 *   - Responder     (Role ID 2): RSPDR-0001, RSPDR-0002...
 *   - Resident      (Role ID 3): RSDNT-0001, RSDNT-0002...
 *
 * Guarantees:
 *   1. Independent sequence counter for each canonical role.
 *   2. Atomic and race-condition free via MySQL `SELECT ... FOR UPDATE` locks.
 *   3. IDs are permanent and never reused even if an account is deleted.
 *   4. Generated solely on the backend; never accepted from client input.
 * ============================================================================
 */

const pool = require('../models/db');
const { ROLE_IDS, isValidRoleId } = require('../config/roles');

const ROLE_PREFIXES = Object.freeze({
  [ROLE_IDS.ADMINISTRATOR]: 'ADM',
  [ROLE_IDS.RESPONDER]: 'RSPDR',
  [ROLE_IDS.RESIDENT]: 'RSDNT',
});

/**
 * Format a prefix and sequence number into canonical user code
 * @param {string} prefix - e.g. 'ADM', 'RSPDR', 'RSDNT'
 * @param {number} sequence - e.g. 1
 * @returns {string} - e.g. 'RSDNT-0001'
 */
function formatUserCode(prefix, sequence) {
  const padded = String(sequence).padStart(4, '0');
  return `${prefix}-${padded}`;
}

/**
 * Generates the next sequential user code for a role within a MySQL transaction.
 * Uses `SELECT ... FOR UPDATE` on `role_sequences` to guarantee concurrency safety.
 *
 * @param {object} connection - Active MySQL connection (already inside a transaction)
 * @param {number} roleId - Canonical Role ID (1, 2, or 3)
 * @returns {Promise<{ userCode: string, sequenceNumber: number, roleId: number, prefix: string }>}
 */
async function generateNextUserCode(connection, roleId) {
  if (!isValidRoleId(roleId)) {
    throw new Error(`Invalid role_id ${roleId}. Must be 1 (Administrator), 2 (Responder), or 3 (Resident).`);
  }

  const numericRoleId = parseInt(roleId, 10);
  const fallbackPrefix = ROLE_PREFIXES[numericRoleId];

  // Atomic lock on the specific role sequence row
  const [rows] = await connection.query(
    'SELECT role_id, role_name, prefix, next_val FROM role_sequences WHERE role_id = ? FOR UPDATE',
    [numericRoleId]
  );

  let prefix = fallbackPrefix;
  let nextVal = 1;

  if (!rows || rows.length === 0) {
    // If sequence row hasn't been initialized yet, insert it atomically
    const roleName = numericRoleId === 1 ? 'Administrator' : numericRoleId === 2 ? 'Responder' : 'Resident';
    await connection.query(
      `INSERT INTO role_sequences (role_id, role_name, prefix, next_val)
       VALUES (?, ?, ?, 2)
       ON DUPLICATE KEY UPDATE next_val = next_val + 1`,
      [numericRoleId, roleName, fallbackPrefix]
    );
    nextVal = 1;
    prefix = fallbackPrefix;
  } else {
    prefix = rows[0].prefix || fallbackPrefix;
    nextVal = rows[0].next_val;

    // Advance sequence counter
    await connection.query(
      'UPDATE role_sequences SET next_val = next_val + 1 WHERE role_id = ?',
      [numericRoleId]
    );
  }

  const userCode = formatUserCode(prefix, nextVal);
  return {
    userCode,
    sequenceNumber: nextVal,
    roleId: numericRoleId,
    prefix,
  };
}

/**
 * Standalone wrapper for callers that don't already have an open connection/transaction.
 * Acquires a pooled connection, runs the generation in an atomic transaction, and returns.
 */
async function getNextUserCodeStandalone(roleId) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await generateNextUserCode(connection, roleId);
    await connection.commit();
    return result;
  } catch (err) {
    await connection.rollback().catch(() => {});
    throw err;
  } finally {
    connection.release();
  }
}

module.exports = {
  ROLE_PREFIXES,
  formatUserCode,
  generateNextUserCode,
  getNextUserCodeStandalone,
};

