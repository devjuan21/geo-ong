require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../models/db');
const { ROLE_IDS } = require('../config/roles');

/**
 * Fresh Database RBAC Initialization Only
 * Zero hardcoded user accounts, zero test passwords, zero fabricated records.
 */
const CANONICAL_ROLES = [
  { id: ROLE_IDS.ADMIN, name: 'Administrator', description: 'Full emergency operations command, user governance, and disaster dispatch oversight' },
  { id: ROLE_IDS.RESPONDER, name: 'Responder', description: 'Field responder unit handling active incident verification and rescue missions' },
  { id: ROLE_IDS.RESIDENT, name: 'Resident', description: 'Community member reporting incidents, requesting rescue, and monitoring alerts' },
];

async function seed() {
  console.log('Ensuring canonical RBAC roles (zero hardcoded user accounts)...');
  for (const r of CANONICAL_ROLES) {
    await pool.query(
      'INSERT INTO roles (id, name, description) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description)',
      [r.id, r.name, r.description]
    );
  }
  console.log('Done. Fresh database contains 0 user accounts.');
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
