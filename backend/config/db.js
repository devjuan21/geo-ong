const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mysql = require('mysql2/promise');
const { Pool: PgPool } = require('pg');

const dbPort = parseInt(process.env.DB_PORT || '3306', 10);
const dbClient = String(process.env.DB_CLIENT || '').toLowerCase();
const isPostgres =
  dbClient === 'pg' ||
  dbClient === 'postgres' ||
  dbClient === 'postgresql' ||
  dbPort === 5432;

/**
 * Translates MySQL-dialect SQL queries and ? placeholders to PostgreSQL ($1, $2, ...)
 * so all controllers and routes work identically on PostgreSQL (5432) and MySQL (3306).
 */
function translateSqlForPostgres(rawSql, params = []) {
  let sql = String(rawSql || '').trim();

  // Convert backticks to double quotes
  sql = sql.replace(/`([^`]+)`/g, '"$1"');

  // Convert IFNULL to COALESCE
  sql = sql.replace(/\bIFNULL\s*\(/gi, 'COALESCE(');

  // Convert MySQL INTERVAL N UNIT to PostgreSQL INTERVAL 'N UNIT'
  sql = sql.replace(
    /\bINTERVAL\s+(\d+)\s+(SECOND|MINUTE|HOUR|DAY|WEEK|MONTH|YEAR)S?\b/gi,
    "INTERVAL '$1 $2'"
  );

  // Convert MySQL tinyint flag comparisons/assignments (flag = 1 / flag = 0) to
  // PostgreSQL BOOLEAN literals for the canonical boolean columns.
  sql = sql.replace(
    /\b((?:[a-zA-Z_][a-zA-Z0-9_]*\.)?(?:is_read|is_active|is_public|is_available|is_protected|is_official_approved|is_internal_only|is_internal_note))\s*(=|<>|!=)\s*([01])\b/g,
    (m, col, op, v) => `${col} ${op} ${v === '1' ? 'TRUE' : 'FALSE'}`
  );

  // Handle INSERT IGNORE INTO -> INSERT INTO ... ON CONFLICT DO NOTHING
  const isInsertIgnore = /^\s*INSERT\s+IGNORE\s+INTO\b/i.test(sql);
  if (isInsertIgnore) {
    sql = sql.replace(/^\s*INSERT\s+IGNORE\s+INTO\b/i, 'INSERT INTO');
  }

  // Handle ON DUPLICATE KEY UPDATE -> ON CONFLICT (<conflict_target>) DO UPDATE SET
  if (/\bON\s+DUPLICATE\s+KEY\s+UPDATE\b/i.test(sql)) {
    const tableMatch = sql.match(/^\s*INSERT\s+INTO\s+"?([a-zA-Z0-9_]+)"?/i);
    const tableName = tableMatch ? tableMatch[1].toLowerCase() : '';
    const conflictMap = {
      user_profiles: 'user_id',
      responder_profiles: 'user_id',
      role_sequences: 'role_id',
      system_settings: 'setting_key',
      users: 'email',
      roles: 'id',
    };
    const conflictTarget = conflictMap[tableName] || 'id';
    sql = sql.replace(
      /\bON\s+DUPLICATE\s+KEY\s+UPDATE\b/i,
      `ON CONFLICT (${conflictTarget}) DO UPDATE SET`
    );
    sql = sql.replace(/\bVALUES\s*\(\s*"?([a-zA-Z0-9_]+)"?\s*\)/gi, 'EXCLUDED.$1');
  } else if (isInsertIgnore && !/\bON\s+CONFLICT\b/i.test(sql)) {
    sql = `${sql.replace(/;\s*$/, '')} ON CONFLICT DO NOTHING`;
  }

  // Replace ? placeholders outside single-quoted string literals with $1, $2, ...
  let paramIndex = 0;
  let inSingleQuote = false;
  let out = '';
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") {
      if (inSingleQuote && sql[i + 1] === "'") {
        out += "''";
        i++;
        continue;
      }
      inSingleQuote = !inSingleQuote;
      out += ch;
    } else if (ch === '?' && !inSingleQuote) {
      paramIndex += 1;
      out += `$${paramIndex}`;
    } else {
      out += ch;
    }
  }
  sql = out;

  // Append RETURNING * on INSERT statements so result.insertId is populated
  const isInsert = /^\s*INSERT\s+INTO\b/i.test(sql);
  if (isInsert && !/\bRETURNING\b/i.test(sql)) {
    sql = `${sql.replace(/;\s*$/, '')} RETURNING *`;
  }

  return { sql, values: Array.isArray(params) ? params : [params] };
}

function formatPgResult(rawSql, pgResult) {
  const command = String(pgResult.command || '').toUpperCase();
  const isSelect =
    command === 'SELECT' ||
    /^\s*(SELECT|WITH|SHOW)\b/i.test(String(rawSql || ''));

  if (isSelect) {
    return [pgResult.rows || [], pgResult.fields || []];
  }

  const firstRow = pgResult.rows && pgResult.rows[0] ? pgResult.rows[0] : null;
  const insertId =
    firstRow && (firstRow.id !== undefined || firstRow.role_id !== undefined)
      ? Number(firstRow.id !== undefined ? firstRow.id : firstRow.role_id)
      : 0;

  const resultHeader = {
    insertId,
    affectedRows: pgResult.rowCount || 0,
    changedRows: pgResult.rowCount || 0,
    rowCount: pgResult.rowCount || 0,
    rows: pgResult.rows || [],
  };

  return [resultHeader, pgResult.fields || []];
}

function createPostgresAdapter() {
  const pgPool = new PgPool({
    host: process.env.DB_HOST || 'localhost',
    port: dbPort || 5432,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'geosafe_db',
    max: 10,
  });

  async function runQuery(clientOrPool, rawSql, params = []) {
    const { sql, values } = translateSqlForPostgres(rawSql, params);
    const res = await clientOrPool.query(sql, values);
    return formatPgResult(rawSql, res);
  }

  return {
    isPostgres: true,
    rawPool: pgPool,
    query(rawSql, params = []) {
      return runQuery(pgPool, rawSql, params);
    },
    execute(rawSql, params = []) {
      return runQuery(pgPool, rawSql, params);
    },
    async getConnection() {
      const client = await pgPool.connect();
      return {
        query(rawSql, params = []) {
          return runQuery(client, rawSql, params);
        },
        execute(rawSql, params = []) {
          return runQuery(client, rawSql, params);
        },
        async beginTransaction() {
          await client.query('BEGIN');
        },
        async commit() {
          await client.query('COMMIT');
        },
        async rollback() {
          await client.query('ROLLBACK');
        },
        release() {
          client.release();
        },
      };
    },
    end() {
      return pgPool.end();
    },
    translateSqlForPostgres,
  };
}

function createMysqlAdapter() {
  const mysqlPool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: dbPort || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'geosafe_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });

  mysqlPool.isPostgres = false;
  mysqlPool.translateSqlForPostgres = translateSqlForPostgres;
  return mysqlPool;
}

const pool = isPostgres ? createPostgresAdapter() : createMysqlAdapter();

module.exports = pool;
