/**
 * GeoSafe - Simple Zero-Dependency Static Development Server
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  // Proxy API requests to backend Express server if target starts with /api
  if (req.url.startsWith('/api')) {
    const backendHost = process.env.BACKEND_HOST || 'localhost';
    const backendPort = process.env.BACKEND_PORT || 5000;
    
    const proxyOptions = {
      hostname: backendHost,
      port: backendPort,
      path: req.url,
      method: req.method,
      headers: {
        ...req.headers,
        host: `${backendHost}:${backendPort}`
      }
    };

    const proxyReq = http.request(proxyOptions, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Backend API service unavailable',
        message: 'The GeoSafe Express + MySQL backend service is currently unreachable. Please ensure the backend server is running.',
        target: `http://${backendHost}:${backendPort}${req.url}`
      }));
    });

    req.pipe(proxyReq);
    return;
  }

  let safePath = req.url.split('?')[0];
  if (safePath === '/') {
    const cookieHeader = String(req.headers.cookie || '');
    const hasSessionCookie = cookieHeader.includes('geosafe_session=');
    if (!hasSessionCookie) {
      res.writeHead(302, { Location: '/login.html' });
      res.end();
      return;
    }
    safePath = '/index.html';
  }

  const filePath = path.normalize(path.join(__dirname, safePath));

  // Security check: ensure path is within directory
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Access Denied');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=UTF-8' });
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><title>404 - Not Found | GeoSafe</title></head>
        <body style="font-family: sans-serif; text-align: center; padding: 50px;">
          <h2>Page Not Found</h2>
          <p><a href="/index.html">Return to Dashboard</a></p>
        </body>
        </html>
      `);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache'
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`  GeoSafe Resident Portal UI is running!`);
  console.log(`  URL: http://localhost:${PORT}`);
  console.log(`  Barangay Bayanan, Muntinlupa City`);
  console.log(`======================================================\n`);
});

