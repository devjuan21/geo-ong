/**
 * GeoSafe — Read-only MySQL Full Data Backup Exporter
 * Exports all tables from live MySQL `geosafe_db` to a timestamped JSON file.
 */
const fs = require('fs');
const path = require('path');
require(path.join(__dirname, '../backend/node_modules/dotenv')).config({ path: path.join(__dirname, '../backend/.env') });
const mysql = require(path.join(__dirname, '../backend/node_modules/mysql2/promise'));

async function exportBackup() {
  const outDir = path.join(__dirname, 'archive/backup_20261113_live');
  const outFile = path.join(outDir, 'geosafe_db_data_backup.json');
  fs.mkdirSync(outDir, { recursive: true });

  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'geosafe_db',
  });

  try {
    const [tableRows] = await conn.query('SHOW TABLES');
    const tables = {};
    for (const row of tableRows) {
      const tableName = Object.values(row)[0];
      const [rows] = await conn.query(`SELECT * FROM \`${tableName}\``);
      tables[tableName] = rows;
    }

    const [triggers] = await conn.query('SHOW TRIGGERS');
    const payload = {
      exported_at: new Date().toISOString(),
      database: process.env.DB_NAME || 'geosafe_db',
      tables,
      triggers,
    };

    fs.writeFileSync(outFile, JSON.stringify(payload, null, 2), 'utf8');
    console.log(`Exported ${Object.keys(tables).length} tables to ${outFile}`);
    for (const [name, rows] of Object.entries(tables)) {
      if (rows.length > 0) {
        console.log(`  ${name}: ${rows.length}`);
      }
    }
  } finally {
    await conn.end();
  }
}

exportBackup().catch((err) => {
  console.error('Export failed:', err.message);
  process.exit(1);
});
