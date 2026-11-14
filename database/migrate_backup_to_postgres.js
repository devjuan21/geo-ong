/**
 * GeoSafe — PostgreSQL Schema & Full Backup Migration Utility
 *
 * Usage:
 *   node database/migrate_backup_to_postgres.js [--backup=path/to/backup.json] [--reset-schema]
 *
 * Environment variables (or backend/.env):
 *   PG_HOST (or DB_HOST, default: localhost)
 *   PG_PORT (default: 5432)
 *   PG_USER (default: postgres)
 *   PG_PASSWORD (or DB_PASSWORD)
 *   DB_NAME (default: geosafe_db)
 */
const fs = require('fs');
const path = require('path');
require(path.join(__dirname, '../backend/node_modules/dotenv')).config({
  path: path.join(__dirname, '../backend/.env'),
});
const { Client } = require(path.join(__dirname, '../backend/node_modules/pg'));

const TOPOLOGICAL_TABLE_ORDER = [
  'roles',
  'incident_categories',
  'evacuation_centers',
  'hospitals',
  'system_settings',
  'role_sequences',
  'users',
  'user_profiles',
  'responder_profiles',
  'account_status_history',
  'audit_logs',
  'auth_security_logs',
  'evacuation_center_facilities',
  'evacuation_routes',
  'evacuation_route_waypoints',
  'reports',
  'incident_attachments',
  'incident_assignments',
  'incident_status_history',
  'incident_updates',
  'rescue_requests',
  'rescue_attachments',
  'rescue_assignments',
  'rescue_status_history',
  'rescue_updates',
  'responder_assignment_history',
  'alerts',
  'emergency_broadcast_logs',
  'notifications',
  'notification_recipients',
];

const CONFLICT_KEY_MAP = {
  roles: 'id',
  role_sequences: 'role_id',
  user_profiles: 'user_id',
  responder_profiles: 'user_id',
  system_settings: 'setting_key',
};

// Nullable user FK columns: orphaned references are safely set to NULL
const NULLABLE_USER_FK_COLS = {
  audit_logs: ['user_id'],
  auth_security_logs: ['user_id'],
  notifications: ['user_id', 'created_by'],
  reports: ['assigned_to', 'verified_by'],
  rescue_requests: ['confirmed_by'],
  evacuation_routes: ['created_by'],
  system_settings: ['updated_by'],
};

// NOT NULL user FK columns: require archived placeholder users if missing
const REQUIRED_USER_FK_COLS = {
  user_profiles: ['user_id'],
  responder_profiles: ['user_id'],
  account_status_history: ['user_id', 'changed_by'],
  reports: ['user_id'],
  incident_attachments: ['uploaded_by'],
  incident_status_history: ['changed_by'],
  incident_assignments: ['responder_user_id', 'assigned_by'],
  incident_updates: ['responder_user_id'],
  rescue_requests: ['user_id'],
  rescue_attachments: ['uploaded_by'],
  rescue_assignments: ['responder_user_id', 'assigned_by'],
  rescue_status_history: ['changed_by'],
  rescue_updates: ['responder_user_id'],
  responder_assignment_history: ['responder_user_id'],
  alerts: ['created_by'],
  emergency_broadcast_logs: ['authorized_by'],
  notification_recipients: ['user_id'],
};

// Parent FK checks for child tables whose parent record may have been deleted
const PARENT_FK_RULES = {
  incident_attachments: [{ col: 'incident_id', parent: 'reports' }],
  incident_assignments: [{ col: 'report_id', parent: 'reports' }],
  incident_status_history: [{ col: 'incident_id', parent: 'reports' }],
  incident_updates: [{ col: 'report_id', parent: 'reports' }],
  rescue_attachments: [{ col: 'rescue_id', parent: 'rescue_requests' }],
  rescue_assignments: [{ col: 'rescue_id', parent: 'rescue_requests' }],
  rescue_status_history: [{ col: 'rescue_id', parent: 'rescue_requests' }],
  rescue_updates: [{ col: 'rescue_id', parent: 'rescue_requests' }],
  emergency_broadcast_logs: [{ col: 'alert_id', parent: 'alerts' }],
  notification_recipients: [{ col: 'notification_id', parent: 'notifications' }],
};

function parseArgs(argv) {
  const args = { resetSchema: false, backupPath: null };
  for (const arg of argv) {
    if (arg === '--reset-schema') {
      args.resetSchema = true;
    } else if (arg.startsWith('--backup=')) {
      args.backupPath = arg.slice('--backup='.length);
    }
  }
  return args;
}

function resolveBackupPath(explicitPath) {
  if (explicitPath) {
    return path.isAbsolute(explicitPath) ? explicitPath : path.resolve(process.cwd(), explicitPath);
  }
  const liveBackup = path.join(__dirname, 'archive/backup_20261113_live/geosafe_db_data_backup.json');
  if (fs.existsSync(liveBackup)) return liveBackup;
  return path.join(__dirname, 'archive/backup_20261113/geosafe_db_data_backup.json');
}

function normalizeValueForPg(val, dataType) {
  if (val === undefined || val === null) return null;
  if (dataType === 'boolean') {
    if (typeof val === 'boolean') return val;
    if (typeof val === 'number') return val !== 0;
    if (typeof val === 'string') return val === '1' || val.toLowerCase() === 'true';
    return Boolean(val);
  }
  if (dataType === 'jsonb' || dataType === 'json') {
    return typeof val === 'string' ? val : JSON.stringify(val);
  }
  return val;
}

function computeMaxRoleCodeSuffix(users, prefix) {
  const re = new RegExp(`^${prefix}-(\\d+)$`, 'i');
  let maxNum = 0;
  for (const u of users || []) {
    if (!u.user_code) continue;
    const m = String(u.user_code).match(re);
    if (m) {
      maxNum = Math.max(maxNum, parseInt(m[1], 10));
    }
  }
  return maxNum + 1;
}

async function getPgColumnMetadata(client) {
  const { rows } = await client.query(
    `SELECT table_name, column_name, data_type, column_default
     FROM information_schema.columns
     WHERE table_schema = 'public'
     ORDER BY table_name, ordinal_position`
  );
  const meta = {};
  for (const r of rows) {
    if (!meta[r.table_name]) meta[r.table_name] = [];
    meta[r.table_name].push({
      name: r.column_name,
      dataType: r.data_type,
      isSerial: typeof r.column_default === 'string' && r.column_default.includes('nextval('),
    });
  }
  return meta;
}

function rowHasMissingParent(tableName, row, parentIdSets) {
  const rules = PARENT_FK_RULES[tableName];
  if (!rules) return false;
  for (const { col, parent } of rules) {
    const val = row[col];
    if (val !== null && val !== undefined && !parentIdSets[parent]?.has(val)) {
      return true;
    }
  }
  return false;
}

async function migrateToPostgres() {
  const { resetSchema, backupPath: argBackupPath } = parseArgs(process.argv.slice(2));
  const backupFile = resolveBackupPath(argBackupPath);
  if (!fs.existsSync(backupFile)) {
    throw new Error(`Backup file not found: ${backupFile}`);
  }

  const host = process.env.PG_HOST || process.env.DB_HOST || 'localhost';
  const port = parseInt(process.env.PG_PORT || '5432', 10);
  const user = process.env.PG_USER || 'postgres';
  const password = process.env.PG_PASSWORD || process.env.DB_PASSWORD || '';
  const dbName = process.env.DB_NAME || 'geosafe_db';

  const adminClient = new Client({ host, port, user, password, database: 'postgres' });
  await adminClient.connect();
  const dbCheck = await adminClient.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (dbCheck.rowCount === 0) {
    await adminClient.query(`CREATE DATABASE "${dbName}"`);
    console.log(`Created PostgreSQL database: ${dbName}`);
  }
  await adminClient.end();

  const client = new Client({ host, port, user, password, database: dbName });
  await client.connect();

  try {
    const existingTablesRes = await client.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`
    );
    if (existingTablesRes.rowCount > 0 && !resetSchema) {
      throw new Error(
        `PostgreSQL database "${dbName}" already has ${existingTablesRes.rowCount} tables. ` +
          `Re-run with --reset-schema only after confirming you want to drop & recreate all tables.`
      );
    }

    const schemaSql = fs.readFileSync(path.join(__dirname, 'geosafe_db_postgres.sql'), 'utf8');
    await client.query(schemaSql);
    console.log('Applied PostgreSQL schema & canonical seed data.');

    const backup = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
    const tablesData = backup.tables || {};
    const pgMeta = await getPgColumnMetadata(client);
    const usersList = tablesData.users || [];
    const validUserIds = new Set(usersList.map((u) => u.id));

    const parentIdSets = {
      reports: new Set((tablesData.reports || []).map((r) => r.id)),
      rescue_requests: new Set((tablesData.rescue_requests || []).map((r) => r.id)),
      alerts: new Set((tablesData.alerts || []).map((r) => r.id)),
      notifications: new Set((tablesData.notifications || []).map((r) => r.id)),
    };

    // Identify missing user IDs required by NOT NULL user FK columns on non-orphaned rows
    const missingRequiredUserIds = new Set();
    for (const [tableName, cols] of Object.entries(REQUIRED_USER_FK_COLS)) {
      const rows = tablesData[tableName] || [];
      for (const row of rows) {
        if (rowHasMissingParent(tableName, row, parentIdSets)) continue;
        for (const col of cols) {
          const val = row[col];
          if (val !== null && val !== undefined && !validUserIds.has(val)) {
            missingRequiredUserIds.add(val);
          }
        }
      }
    }

    await client.query('BEGIN');

    const deferredUserSelfFks = [];
    const skippedByTable = {};
    const nulledUserRefsByTable = {};

    for (const tableName of TOPOLOGICAL_TABLE_ORDER) {
      const rows = tablesData[tableName];
      if (!Array.isArray(rows) || rows.length === 0) continue;

      const pgCols = pgMeta[tableName];
      if (!pgCols || pgCols.length === 0) {
        console.warn(`Skipping ${tableName}: not found in PostgreSQL schema.`);
        continue;
      }

      const pgColMap = new Map(pgCols.map((c) => [c.name, c]));
      const conflictCol = CONFLICT_KEY_MAP[tableName] || (pgColMap.has('id') ? 'id' : null);
      const nullableUserCols = NULLABLE_USER_FK_COLS[tableName] || [];

      let importedCount = 0;
      let skippedCount = 0;
      let nulledCount = 0;

      for (const row of rows) {
        if (rowHasMissingParent(tableName, row, parentIdSets)) {
          skippedCount++;
          continue;
        }

        const colsToInsert = [];
        const values = [];

        for (const colName of Object.keys(row)) {
          const colMeta = pgColMap.get(colName);
          if (!colMeta) continue;

          let val = row[colName];
          if (tableName === 'users' && (colName === 'suspended_by' || colName === 'status_updated_by') && val !== null) {
            deferredUserSelfFks.push({ id: row.id, colName, val });
            val = null;
          } else if (tableName === 'role_sequences' && colName === 'next_val') {
            const minRequired = computeMaxRoleCodeSuffix(usersList, row.prefix);
            val = Math.max(Number(val || 1), minRequired);
          } else if (nullableUserCols.includes(colName) && val !== null && val !== undefined && !validUserIds.has(val)) {
            val = null;
            nulledCount++;
          }

          colsToInsert.push(`"${colName}"`);
          values.push(normalizeValueForPg(val, colMeta.dataType));
        }

        if (colsToInsert.length === 0) continue;
        const placeholders = values.map((_, idx) => `$${idx + 1}`).join(', ');
        let conflictSql = '';
        if (conflictCol) {
          if (tableName === 'users') {
            conflictSql = ` ON CONFLICT ("id") DO UPDATE SET user_code = EXCLUDED.user_code`;
          } else if (tableName === 'role_sequences') {
            conflictSql = ` ON CONFLICT ("role_id") DO UPDATE SET next_val = EXCLUDED.next_val`;
          } else if (tableName === 'roles') {
            conflictSql = ` ON CONFLICT ("id") DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description`;
          } else {
            conflictSql = ` ON CONFLICT ("${conflictCol}") DO NOTHING`;
          }
        }

        const sql = `INSERT INTO "${tableName}" (${colsToInsert.join(', ')}) VALUES (${placeholders})${conflictSql}`;
        await client.query(sql, values);
        importedCount++;
      }

      if (skippedCount > 0) skippedByTable[tableName] = skippedCount;
      if (nulledCount > 0) nulledUserRefsByTable[tableName] = nulledCount;

      const extraNotes = [];
      if (skippedCount > 0) extraNotes.push(`skipped ${skippedCount} orphaned child row(s)`);
      if (nulledCount > 0) extraNotes.push(`nulled ${nulledCount} orphaned user ref(s)`);
      const suffix = extraNotes.length ? ` (${extraNotes.join(', ')})` : '';
      console.log(`Imported ${tableName}: ${importedCount} row(s)${suffix}`);

      // Insert deactivated non-login archived user placeholders right after users
      if (tableName === 'users' && missingRequiredUserIds.size > 0) {
        const sortedMissing = [...missingRequiredUserIds].sort((a, b) => a - b);
        for (const missingId of sortedMissing) {
          await client.query(
            `INSERT INTO users (id, user_code, name, email, password_hash, role_id, status, account_status)
             VALUES ($1, NULL, $2, $3, $4, 3, 'deactivated', 'deactivated')
             ON CONFLICT (id) DO NOTHING`,
            [
              missingId,
              `Archived User #${missingId}`,
              `archived.user.${missingId}@archived.geosafe.local`,
              '!ARCHIVED_ACCOUNT_LOGIN_DISABLED!',
            ]
          );
          validUserIds.add(missingId);
        }
        console.log(`Inserted ${sortedMissing.length} deactivated archived-user placeholder(s): [${sortedMissing.join(', ')}]`);
      }
    }

    for (const item of deferredUserSelfFks) {
      await client.query(`UPDATE users SET "${item.colName}" = $1 WHERE id = $2`, [item.val, item.id]);
    }

    // Reset all SERIAL/BIGSERIAL sequences
    for (const [tableName, cols] of Object.entries(pgMeta)) {
      for (const col of cols) {
        if (!col.isSerial) continue;
        await client.query(
          `SELECT setval(
             pg_get_serial_sequence($1, $2),
             GREATEST(COALESCE((SELECT MAX("${col.name}") FROM "${tableName}"), 1), 1),
             (SELECT MAX("${col.name}") IS NOT NULL FROM "${tableName}")
           )`,
          [tableName, col.name]
        );
      }
    }

    await client.query('COMMIT');
    console.log('Sequences reset and transaction committed.');

    // Verify counts across all 32 PostgreSQL tables
    let mismatches = 0;
    console.log('\n--- Migration Verification (Backup vs PostgreSQL) ---');
    for (const tableName of TOPOLOGICAL_TABLE_ORDER) {
      const backupCount = Array.isArray(tablesData[tableName]) ? tablesData[tableName].length : 0;
      const skipped = skippedByTable[tableName] || 0;
      const placeholders = tableName === 'users' ? missingRequiredUserIds.size : 0;
      const expectedPgCount = backupCount - skipped + placeholders;
      const { rows } = await client.query(`SELECT COUNT(*)::int AS cnt FROM "${tableName}"`);
      const actualCount = rows[0].cnt;

      let status = 'OK';
      if (backupCount === 0 && actualCount > 0) {
        status = 'SEEDED';
      } else if (actualCount !== expectedPgCount) {
        status = 'MISMATCH';
        mismatches++;
      } else if (skipped > 0) {
        status = `OK (-${skipped} orphaned)`;
      } else if (placeholders > 0) {
        status = `OK (+${placeholders} archived)`;
      }

      console.log(`${tableName.padEnd(32)} backup=${String(backupCount).padStart(4)}  pg=${String(actualCount).padStart(4)}  [${status}]`);
    }

    if (mismatches > 0) {
      throw new Error(`Migration verification failed with ${mismatches} table count mismatch(es).`);
    }
    console.log('\nMigration and verification completed successfully.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

migrateToPostgres().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
