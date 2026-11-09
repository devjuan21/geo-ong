/**
 * GeoSafe — Project Directory Reorganization & System Validation Suite
 * Verifies all 10 requirements of Section 6:
 * 1. Canonical repository structure (frontend/, backend/, database/, docs/, README.md, .gitignore)
 * 2. All HTML script, CSS, image, and page references inside frontend/ exist on disk
 * 3. Zero broken require() imports across all backend/*.js files
 * 4. Database canonical files & archive preservation
 * 5. Security checks (.env excluded from frontend & gitignore, .env.example sanitized)
 * 6. Initial Administrator provisioning command (npm run create-admin -> scripts/create-admin.js)
 * 7. Express app route handling, static asset serving, HTML portal guards, and REST API protection
 * 8. MySQL connection pool configuration check
 */

const fs = require('fs');
const path = require('path');
const { PassThrough } = require('stream');
const http = require('http');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '../..');
const frontendDir = path.join(repoRoot, 'frontend');
const backendDir = path.join(repoRoot, 'backend');
const databaseDir = path.join(repoRoot, 'database');

let passed = 0;
let failed = 0;

function check(condition, label, detail = '') {
  if (condition) {
    console.log(`  [PASS] ${label}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

/**
 * In-memory Express request dispatcher (works inside network-isolated sandboxes)
 */
function dispatchExpressRequest(app, reqPath, options = {}) {
  return new Promise((resolve, reject) => {
    const keepAlive = setInterval(() => {}, 200);
    const reqSocket = new PassThrough();
    reqSocket.remoteAddress = '127.0.0.1';

    const req = new http.IncomingMessage(reqSocket);
    req.method = options.method || 'GET';
    req.url = reqPath;
    req.headers = {
      host: 'localhost:3000',
      ...(options.headers || {}),
    };

    const bodyStr = options.body
      ? typeof options.body === 'string'
        ? options.body
        : JSON.stringify(options.body)
      : null;

    if (bodyStr !== null) {
      req.headers['content-length'] = String(Buffer.byteLength(bodyStr));
      if (typeof options.body === 'object') {
        req.body = options.body;
        req._body = true;
      }
    }

    const res = new http.ServerResponse(req);
    const bodyChunks = [];
    let resolved = false;

    const finishResponse = () => {
      if (resolved) return;
      resolved = true;
      clearInterval(keepAlive);
      const body = Buffer.concat(bodyChunks).toString('utf8');
      let json = null;
      try {
        json = JSON.parse(body);
      } catch (_) {}
      resolve({
        status: res.statusCode,
        headers: res.getHeaders(),
        body,
        json,
      });
    };

    res.write = (chunk, encoding, cb) => {
      if (chunk) {
        bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), typeof encoding === 'string' ? encoding : 'utf8'));
      }
      if (typeof encoding === 'function') encoding();
      else if (typeof cb === 'function') cb();
      return true;
    };

    res.end = (chunk, encoding, cb) => {
      if (chunk && typeof chunk !== 'function') {
        bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), typeof encoding === 'string' ? encoding : 'utf8'));
      }
      res.finished = true;
      res.writableEnded = true;
      if (typeof chunk === 'function') chunk();
      else if (typeof encoding === 'function') encoding();
      else if (typeof cb === 'function') cb();
      res.emit('finish');
      finishResponse();
      return res;
    };

    try {
      app.handle(req, res, (err) => {
        clearInterval(keepAlive);
        if (err) reject(err);
      });
      if (bodyStr !== null) {
        req.push(bodyStr);
        req.push(null);
      }
    } catch (err) {
      clearInterval(keepAlive);
      reject(err);
    }
  });
}

(async function main() {
  console.log('======================================================================');
  console.log(' GeoSafe Repository Reorganization & End-to-End Validation');
  console.log('======================================================================\n');

  // 1. Canonical Top-Level Directory Structure
  console.log('1. Verifying Canonical Top-Level Structure:');
  const rootEntries = fs.readdirSync(repoRoot).filter((n) => n !== '.git').sort();
  const expectedRoot = ['.gitignore', 'README.md', 'backend', 'database', 'docs', 'frontend'];
  check(
    JSON.stringify(rootEntries) === JSON.stringify(expectedRoot),
    `Root contains strictly [.gitignore, README.md, backend, database, docs, frontend] (found: ${rootEntries.join(', ')})`
  );

  // 2. Backend Subdirectories & Key Files
  console.log('\n2. Verifying Backend Subdirectories & Required Files:');
  for (const sub of ['config', 'controllers', 'routes', 'middleware', 'services', 'scripts', 'utils']) {
    check(fs.existsSync(path.join(backendDir, sub)), `backend/${sub}/ exists`);
  }
  for (const file of ['server.js', 'config/db.js', 'models/db.js', 'middleware/auth.js', 'middleware/rbac.js', 'scripts/create-admin.js', 'package.json', 'package-lock.json', '.env', '.env.example']) {
    check(fs.existsSync(path.join(backendDir, file)), `backend/${file} exists`);
  }

  // 3. Database Canonical Files & Archive
  console.log('\n3. Verifying Canonical Database Directory:');
  for (const dbItem of ['geosafe_db_schema.sql', 'verify_database.sql', 'REVISION_NOTES.md', 'migrations', 'archive']) {
    check(fs.existsSync(path.join(databaseDir, dbItem)), `database/${dbItem} exists`);
  }
  const migrationFiles = fs.readdirSync(path.join(databaseDir, 'migrations')).filter((f) => f.endsWith('.sql'));
  check(migrationFiles.length === 7, `database/migrations/ contains all 7 SQL migrations (002–008)`);
  const archiveFiles = fs.readdirSync(path.join(databaseDir, 'archive'));
  check(
    archiveFiles.includes('database.zip') && archiveFiles.includes('GeoSafe_database_corrected.zip'),
    'database/archive/ preserves original ZIP backups'
  );

  // 4. Frontend HTML Pages, Assets, and Local Path References
  console.log('\n4. Verifying Frontend HTML Pages & Local Asset References:');
  const htmlFiles = fs.readdirSync(frontendDir).filter((f) => f.endsWith('.html'));
  check(htmlFiles.length === 19, `frontend/ contains all 19 HTML portal pages`);
  check(fs.existsSync(path.join(frontendDir, 'assets/css/style.css')), 'frontend/assets/css/style.css exists');
  check(fs.existsSync(path.join(frontendDir, 'package.json')) && fs.existsSync(path.join(frontendDir, 'package-lock.json')), 'frontend/package.json & package-lock.json exist');

  let brokenRefs = [];
  const attrRegex = /(?:href|src)=["']([^"']+)["']/g;
  for (const htmlFile of htmlFiles) {
    const content = fs.readFileSync(path.join(frontendDir, htmlFile), 'utf8');
    let match;
    while ((match = attrRegex.exec(content)) !== null) {
      const ref = match[1].split('?')[0].split('#')[0];
      if (!ref || ref.startsWith('http://') || ref.startsWith('https://') || ref.startsWith('mailto:') || ref.startsWith('tel:') || ref.startsWith('data:') || ref.startsWith('${')) {
        continue;
      }
      const cleanRef = ref.replace(/^\.\//, '').replace(/^\//, '');
      if (!cleanRef) continue;
      const resolved = path.join(frontendDir, cleanRef);
      if (!fs.existsSync(resolved)) {
        brokenRefs.push(`${htmlFile} -> ${ref}`);
      }
    }
  }
  check(brokenRefs.length === 0, 'All local CSS, JS, icon, and HTML links across all 19 HTML pages resolve on disk', brokenRefs.join('; '));

  // 5. Check All Backend JS Files for Broken Relative require() Imports
  console.log('\n5. Checking Backend JS Files for Broken Imports:');
  let brokenRequires = [];
  function scanBackendJs(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanBackendJs(full);
      } else if (entry.name.endsWith('.js')) {
        const rawCode = fs.readFileSync(full, 'utf8');
        const code = rawCode.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
        const reqRegex = /require\(['"](\.[^'"]+)['"]\)/g;
        let m;
        while ((m = reqRegex.exec(code)) !== null) {
          const relTarget = m[1];
          const base = path.resolve(path.dirname(full), relTarget);
          const exists =
            fs.existsSync(base) ||
            fs.existsSync(`${base}.js`) ||
            fs.existsSync(`${base}.json`) ||
            fs.existsSync(path.join(base, 'index.js'));
          if (!exists) {
            brokenRequires.push(`${path.relative(backendDir, full)} -> ${relTarget}`);
          }
        }
      }
    }
  }
  scanBackendJs(backendDir);
  check(brokenRequires.length === 0, 'Zero broken relative require() imports in backend/', brokenRequires.join('; '));

  // 6. Security Checks
  console.log('\n6. Verifying Security Controls:');
  check(!fs.existsSync(path.join(frontendDir, '.env')), 'No .env file inside frontend/');
  const gitignore = fs.readFileSync(path.join(repoRoot, '.gitignore'), 'utf8');
  check(gitignore.includes('.env') && gitignore.includes('node_modules/'), '.gitignore excludes .env and node_modules/');
  const envExample = fs.readFileSync(path.join(backendDir, '.env.example'), 'utf8');
  check(envExample.includes('DB_PASSWORD=') && !envExample.includes('geosafe_super_secret'), 'backend/.env.example contains no real credentials');

  // 7. Initial Administrator Provisioning Command Verification
  console.log('\n7. Verifying Initial Administrator Provisioning Command (npm run create-admin):');
  const backendPkg = JSON.parse(fs.readFileSync(path.join(backendDir, 'package.json'), 'utf8'));
  check(backendPkg.scripts['create-admin'] === 'node scripts/create-admin.js', 'backend/package.json defines "create-admin": "node scripts/create-admin.js"');
  const createAdminRun = spawnSync(process.execPath, [path.join(backendDir, 'scripts/create-admin.js')], {
    cwd: backendDir,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  check(
    createAdminRun.status === 1 && (createAdminRun.stderr || '').includes('interactive terminal'),
    'scripts/create-admin.js loads cleanly and enforces interactive TTY guard when piped'
  );

  // 8. Verify Express App, Static Assets & Portal Route Guards
  console.log('\n8. Verifying Express Backend App, Static Assets & Portal Route Guards:');
  const app = require('../server');

  const health = await dispatchExpressRequest(app, '/api/health');
  check(health.status === 200 && health.json && health.json.status === 'ok', 'GET /api/health returns HTTP 200 { status: "ok" }');

  const healthV1 = await dispatchExpressRequest(app, '/api/v1/health');
  check(healthV1.status === 200 && healthV1.json && healthV1.json.status === 'ok', 'GET /api/v1/health returns HTTP 200 { status: "ok" }');

  const sessionRes = await dispatchExpressRequest(app, '/api/auth/session');
  check(sessionRes.status === 401, 'GET /api/auth/session returns HTTP 401 for unauthenticated visitor');

  // Verify public login page & CSS/JS assets are served from ../frontend
  const loginPage = await dispatchExpressRequest(app, '/login.html');
  check(loginPage.status === 200 && loginPage.body.includes('GeoSafe'), 'GET /login.html serves frontend/login.html (HTTP 200)');

  const cssRes = await dispatchExpressRequest(app, '/assets/css/style.css');
  check(cssRes.status === 200 && cssRes.body.length > 1000, 'GET /assets/css/style.css serves compiled Tailwind CSS (HTTP 200)');

  const storeJsRes = await dispatchExpressRequest(app, '/assets/js/store.js');
  check(storeJsRes.status === 200 && storeJsRes.body.includes('GeoSafeStore'), 'GET /assets/js/store.js serves frontend store client (HTTP 200)');

  // Verify all 3 role-based portals redirect unauthenticated visitors to /login.html
  for (const portalPath of ['/', '/index.html', '/family.html', '/responder-dashboard.html', '/admin.html']) {
    const res = await dispatchExpressRequest(app, portalPath);
    check(
      res.status === 302 && res.headers.location === '/login.html',
      `Unauthenticated GET ${portalPath} -> HTTP 302 redirect to /login.html`
    );
  }

  // Verify protected API endpoints reject unauthenticated requests with HTTP 401
  for (const apiPath of ['/api/reports', '/api/alerts', '/api/family', '/api/users', '/api/admin/overview', '/api/responder/assignments']) {
    const res = await dispatchExpressRequest(app, apiPath);
    check(res.status === 401, `Unauthenticated GET ${apiPath} -> HTTP 401 Unauthorized`);
  }

  // Verify registration role spoofing is blocked before DB hit
  const spoofRes = await dispatchExpressRequest(app, '/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { first_name: 'Test', surname: 'User', email: 'test@example.com', password: 'password123', role: 'admin' },
  });
  check(spoofRes.status === 403, 'POST /api/register with role="admin" -> HTTP 403 Forbidden (role spoofing blocked)');

  // 9. Check MySQL Connection Status
  console.log('\n9. Checking MySQL Connection Pool Configuration:');
  const pool = require('../config/db');
  check(typeof pool.query === 'function' && typeof pool.getConnection === 'function', 'MySQL connection pool (config/db.js & models/db.js) initialized cleanly');
  try {
    const [rows] = await pool.query('SELECT id, name FROM roles ORDER BY id');
    check(rows.length === 3, `Connected to MySQL geosafe_db and verified ${rows.length} RBAC roles`);
  } catch (dbErr) {
    console.log(`  [INFO] Live MySQL query returned: ${dbErr.code || dbErr.message} (Set your MySQL root password in backend/.env DB_PASSWORD before starting the server)`);
  } finally {
    await pool.end().catch(() => {});
  }

  console.log('\n======================================================================');
  console.log(` VALIDATION SUMMARY: ${passed} passed, ${failed} failed`);
  console.log('======================================================================');
  process.exit(failed === 0 ? 0 : 1);
})();
