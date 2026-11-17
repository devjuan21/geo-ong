/**
 * GeoSafe Automatic Arrival Detection Configuration
 *
 * Central defaults for GPS-based arrival confirmation. Values may be overridden
 * via rows in PostgreSQL `system_settings` (keys prefixed with `arrival_`).
 */
const DEFAULT_ARRIVAL_CONFIG = Object.freeze({
  geofenceRadiusMeters: 15,
  maxGpsAccuracyMeters: 150,
  consecutiveReadingsRequired: 2,
  confirmationWindowMs: 1500,
});

function toPositiveNumber(val, fallback) {
  const n = Number(val);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function getArrivalConfig(db) {
  const config = { ...DEFAULT_ARRIVAL_CONFIG };
  try {
    const [rows] = await db.query(
      `SELECT setting_key, setting_value
       FROM system_settings
       WHERE setting_key IN (
         'arrival_geofence_radius_meters',
         'arrival_max_gps_accuracy_meters',
         'arrival_consecutive_readings',
         'arrival_confirmation_window_ms'
       )`
    );
    for (const row of rows) {
      if (row.setting_key === 'arrival_geofence_radius_meters') {
        config.geofenceRadiusMeters = toPositiveNumber(row.setting_value, config.geofenceRadiusMeters);
      } else if (row.setting_key === 'arrival_max_gps_accuracy_meters') {
        config.maxGpsAccuracyMeters = toPositiveNumber(row.setting_value, config.maxGpsAccuracyMeters);
      } else if (row.setting_key === 'arrival_consecutive_readings') {
        config.consecutiveReadingsRequired = Math.max(2, Math.round(toPositiveNumber(row.setting_value, config.consecutiveReadingsRequired)));
      } else if (row.setting_key === 'arrival_confirmation_window_ms') {
        config.confirmationWindowMs = toPositiveNumber(row.setting_value, config.confirmationWindowMs);
      }
    }
  } catch (_) {
    // Use central defaults if system_settings keys are not defined
  }
  return config;
}

function computeHaversineMeters(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

module.exports = {
  DEFAULT_ARRIVAL_CONFIG,
  getArrivalConfig,
  computeHaversineMeters,
};
