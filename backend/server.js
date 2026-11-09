const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const http = require('http');
const express = require('express');
const cors = require('cors');
const pool = require('./config/db');
const { initSocket } = require('./services/socketService');
const { ROLE_IDS } = require('./config/roles');
const { verifyRequestSession } = require('./middleware/auth');
const { portalForRoleId } = require('./controllers/authController');

const authRoutes = require('./routes/authRoutes');
const reportRoutes = require('./routes/reportRoutes');
const alertRoutes = require('./routes/alertRoutes');
const userRoutes = require('./routes/userRoutes');
const familyRoutes = require('./routes/familyRoutes');
const adminRoutes = require('./routes/adminRoutes');
const evacRoutes = require('./routes/evacRoutes');
const hospitalRoutes = require('./routes/hospitalRoutes');
const portalRoutes = require('./routes/portalRoutes');

const app = express();
const server = http.createServer(app);
initSocket(server);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ limit: '25mb', extended: true }));

app.get(['/api/health', '/api/v1/health'], (_req, res) => res.json({ status: 'ok' }));

// Mount specific REST API routers under both /api/v1 and /api before catch-all portalRoutes
for (const prefix of ['/api/v1', '/api']) {
  app.use(prefix, authRoutes);
  app.use(`${prefix}/reports`, reportRoutes);
  app.use(`${prefix}/alerts`, alertRoutes);
  app.use(`${prefix}/users`, userRoutes);
  app.use(`${prefix}/family`, familyRoutes);
  app.use(`${prefix}/admin`, adminRoutes);
  app.use(`${prefix}/evacuation-centers`, evacRoutes);
  app.use(`${prefix}/hospitals`, hospitalRoutes);
}
for (const prefix of ['/api/v1', '/api']) {
  app.use(prefix, portalRoutes);
}

// Any unmatched /api/* route returns 404 JSON (never falls through to static HTML)
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API endpoint not found' });
});

// ============================================================================
// SERVER-SIDE HTML PORTAL AUTHENTICATION & ROLE AUTHORIZATION GUARD
// ============================================================================
const RESIDENT_HTML_PAGES = new Set([
  '/',
  '/index.html',
  '/family.html',
  '/family-safety.html',
  '/evacuation-routes.html',
  '/evacuation-centers.html',
  '/report-incident.html',
  '/report-rescue.html',
  '/rescue-requests.html',
  '/my-reports.html',
  '/hazard-alerts.html',
  '/notifications.html',
  '/profile.html',
  '/settings.html',
  '/home.html',
  '/report.html',
  '/route.html',
]);

const RESPONDER_HTML_PAGES = new Set([
  '/responder-dashboard.html',
  '/responder-assignments.html',
  '/responder-map.html',
  '/responder-profile.html',
  '/responder.html',
]);

const ADMIN_HTML_PAGES = new Set([
  '/admin.html',
]);

function requiredRoleForHtmlPath(pathname) {
  const normalized = pathname.toLowerCase();
  if (RESIDENT_HTML_PAGES.has(normalized)) return ROLE_IDS.RESIDENT;
  if (RESPONDER_HTML_PAGES.has(normalized)) return ROLE_IDS.RESPONDER;
  if (ADMIN_HTML_PAGES.has(normalized)) return ROLE_IDS.ADMINISTRATOR;
  return null;
}

app.use(async (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return next();
  }

  const pathname = (req.path || '/').toLowerCase();
  const isHtmlRequest = pathname === '/' || pathname.endsWith('.html');
  if (!isHtmlRequest) {
    return next();
  }

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  // Public login / registration page
  if (pathname === '/login.html') {
    const session = await verifyRequestSession(req);
    if (session.ok) {
      return res.redirect(302, portalForRoleId(session.user.role_id));
    }
    return next();
  }

  const requiredRoleId = requiredRoleForHtmlPath(pathname);

  // Verify server-side session for all HTML pages
  const session = await verifyRequestSession(req);
  if (!session.ok) {
    return res.redirect(302, '/login.html');
  }

  if (requiredRoleId !== null && session.user.role_id !== requiredRoleId) {
    try {
      await pool.query(
        `INSERT INTO auth_security_logs (user_id, attempted_email, event_type, attempted_role, ip_address, user_agent, details)
         VALUES (?, ?, 'unauthorized_role_attempt', ?, ?, ?, ?)`,
        [
          session.user.id,
          session.user.email,
          String(requiredRoleId),
          String(req.ip || '0.0.0.0').slice(0, 45),
          req.headers['user-agent'] ? String(req.headers['user-agent']).slice(0, 255) : null,
          `Blocked ${session.user.role_name} from accessing ${pathname}`,
        ]
      );
    } catch (_) {}

    const targetPortal = portalForRoleId(session.user.role_id);
    return res.status(403).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>403 Access Restricted - GeoSafe</title>
  <link rel="stylesheet" href="/assets/css/style.css">
</head>
<body class="bg-[#FFF9E8] text-[#202020] min-h-screen flex items-center justify-center p-4 font-sans">
  <div class="bg-white rounded-3xl max-w-md w-full p-8 border border-[#FFC2C2] shadow-card text-center space-y-4">
    <div class="w-14 h-14 rounded-2xl bg-[#FFF1F1] border border-[#FFC2C2] text-[#D93636] flex items-center justify-center mx-auto">
      <svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
    </div>
    <span class="inline-block px-3 py-1 rounded-full text-[11px] font-bold bg-[#FFF1F1] text-[#D93636] border border-[#FFC2C2] uppercase">HTTP 403 Forbidden</span>
    <h1 class="text-lg font-black text-[#202020]">Unauthorized Portal Access</h1>
    <p class="text-xs text-[#777777] leading-relaxed">
      Your account is authenticated as <strong>${session.user.role_name}</strong> and is not authorized to access <code>${pathname}</code>.
    </p>
    <div class="pt-2">
      <a href="${targetPortal}" class="inline-block px-5 py-2.5 rounded-2xl bg-[#F5B900] hover:bg-[#E5AC00] text-[#202020] font-black text-xs shadow-subtle">
        Return to ${session.user.role_name} Portal
      </a>
    </div>
  </div>
</body>
</html>`);
  }

  return next();
});

// Serve the GeoSafe frontend static files from ../frontend
const frontendPath = path.join(__dirname, '../frontend');
app.use(express.static(frontendPath));

app.get('*', (_req, res) => {
  res.redirect(302, '/login.html');
});

const PORT = process.env.PORT || 3000;

async function verifySchemaReady() {
  try {
    const [roles] = await pool.query('SELECT id, name FROM roles ORDER BY id');
    const valid =
      roles.length === 3 &&
      roles[0].id === ROLE_IDS.ADMINISTRATOR && roles[0].name === 'Administrator' &&
      roles[1].id === ROLE_IDS.RESPONDER && roles[1].name === 'Responder' &&
      roles[2].id === ROLE_IDS.RESIDENT && roles[2].name === 'Resident';

    if (!valid) {
      console.error(
        '[Startup] Database roles table does not match expected schema (1=Administrator, 2=Responder, 3=Resident).'
      );
    } else {
      console.log('[Startup] Connected to geosafe_db. Verified 3 canonical RBAC roles.');
    }
  } catch (err) {
    console.error('[Startup] Could not verify roles table:', err.message);
  }
}

if (require.main === module) {
  server.listen(PORT, async () => {
    console.log(`GeoSafe server listening on http://localhost:${PORT}`);
    await verifySchemaReady();
  });
}

module.exports = app;
module.exports.server = server;
