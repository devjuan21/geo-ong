const pool = require('../config/db');
const { emitAlertExpired } = require('./socketService');

let expirationTimer = null;
let activeSweepPromise = null;

/**
 * Atomically transitions any Active broadcast alerts whose server-side expires_at
 * timestamp has passed to Expired, writes an audit trail entry, and emits
 * real-time Socket.IO expiration events.
 *
 * Idempotent: PostgreSQL row locking + WHERE (is_active = TRUE AND status = 'Active')
 * guarantees each alert can only be transitioned and broadcast once.
 */
async function expireDueBroadcasts() {
  if (activeSweepPromise) {
    return activeSweepPromise;
  }

  activeSweepPromise = (async () => {
    let conn;
    try {
      conn = await pool.getConnection();
      await conn.beginTransaction();

      const [updateRes] = await conn.query(
        `UPDATE emergency_broadcast_logs
         SET is_active = FALSE,
             status = 'Expired',
             expired_at = COALESCE(expired_at, NOW())
         WHERE is_active = TRUE
           AND status = 'Active'
           AND expires_at IS NOT NULL
           AND expires_at <= NOW()
         RETURNING id, title, message, category_id, advisory_type, target_scope, target_zones,
                   recipients_count, authorized_by, broadcasted_at, expires_at, expired_at, status, is_active`
      );
      const expiredRows = Array.isArray(updateRes)
        ? updateRes
        : (updateRes && Array.isArray(updateRes.rows) ? updateRes.rows : []);

      if (!Array.isArray(expiredRows) || expiredRows.length === 0) {
        await conn.commit();
        return [];
      }

      for (const row of expiredRows) {
        await conn.query(
          `INSERT INTO audit_logs
             (user_id, action, entity_type, entity_id, old_values, new_values, ip_address, user_agent)
           VALUES (?, 'EXPIRE_EMERGENCY_BROADCAST', 'emergency_broadcast_logs', ?, ?, ?, '127.0.0.1', 'GeoSafe-Expiration-Scheduler')`,
          [
            row.authorized_by || null,
            row.id,
            JSON.stringify({ status: 'Active', is_active: true }),
            JSON.stringify({
              status: 'Expired',
              is_active: false,
              expires_at: row.expires_at,
              expired_at: row.expired_at,
            }),
          ]
        );
      }

      await conn.commit();

      const expiredPayloads = expiredRows.map((row) => ({
        id: row.id,
        referenceNumber: `BRD-${String(row.id).padStart(4, '0')}`,
        title: row.title,
        categoryId: row.category_id || null,
        advisoryType: row.advisory_type || 'Other',
        targetScope: row.target_scope || 'All Barangay Bayanan',
        targetZones: row.target_zones || '',
        broadcastedAt: row.broadcasted_at,
        expiresAt: row.expires_at,
        expiredAt: row.expired_at,
        status: 'Expired',
        isActive: false,
      }));

      for (const payload of expiredPayloads) {
        emitAlertExpired(payload);
      }

      return expiredPayloads;
    } catch (err) {
      if (conn) {
        try {
          await conn.rollback();
        } catch (_) {}
      }
      console.error('[BroadcastExpiration] Sweep failed:', err.message);
      return [];
    } finally {
      if (conn) conn.release();
      activeSweepPromise = null;
    }
  })();

  return activeSweepPromise;
}

function startBroadcastExpirationScheduler(intervalMs = 10000) {
  if (expirationTimer) return expirationTimer;
  expireDueBroadcasts().catch(() => {});
  expirationTimer = setInterval(() => {
    expireDueBroadcasts().catch(() => {});
  }, intervalMs);
  if (typeof expirationTimer.unref === 'function') {
    expirationTimer.unref();
  }
  return expirationTimer;
}

function stopBroadcastExpirationScheduler() {
  if (expirationTimer) {
    clearInterval(expirationTimer);
    expirationTimer = null;
  }
}

module.exports = {
  expireDueBroadcasts,
  startBroadcastExpirationScheduler,
  stopBroadcastExpirationScheduler,
};
