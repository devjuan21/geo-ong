const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns').promises;

const PRIVATE_BUCKET = process.env.SUPABASE_BUCKET_RESIDENT_IDENTITY || 'resident-identity-docs';
const LOCAL_PRIVATE_DIR = path.resolve(__dirname, '../private_uploads', PRIVATE_BUCKET);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
const MIN_IMAGE_BYTES = 2048; // 2 KB minimum to reject empty/blank images
const STORAGE_FETCH_TIMEOUT_MS = 15000;

const ALLOWED_MIMES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/jpg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);

function hasValidImageMagicBytes(buf, mime) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return false;
  if (mime === 'image/jpeg' || mime === 'image/jpg') {
    return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  }
  if (mime === 'image/png') {
    return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  }
  if (mime === 'image/webp') {
    return (
      buf.slice(0, 4).toString('ascii') === 'RIFF' &&
      buf.slice(8, 12).toString('ascii') === 'WEBP'
    );
  }
  return false;
}

function parseAndValidateImageDataUrl(dataUrl, label = 'Photo') {
  const raw = String(dataUrl || '').trim();
  const match = raw.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) {
    const err = new Error(`${label} must be a valid JPEG, PNG, or WebP camera image.`);
    err.statusCode = 400;
    throw err;
  }

  const rawMime = match[1].toLowerCase();
  const mime = rawMime === 'image/jpg' ? 'image/jpeg' : rawMime;
  const ext = ALLOWED_MIMES.get(mime);
  const buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');

  if (buffer.length < MIN_IMAGE_BYTES) {
    const err = new Error(`${label} is too small or blank. Please capture a clear photo.`);
    err.statusCode = 400;
    throw err;
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    const err = new Error(`${label} exceeds the maximum allowed size of 5 MB.`);
    err.statusCode = 400;
    throw err;
  }
  if (!hasValidImageMagicBytes(buffer, mime)) {
    const err = new Error(`${label} content does not match a valid image format.`);
    err.statusCode = 400;
    throw err;
  }

  return { buffer, mime, ext, size: buffer.length };
}

function stripSurroundingQuotes(val) {
  return String(val || '').trim().replace(/^['"]+|['"]+$/g, '').trim();
}

function getSupabaseStorageConfig() {
  let rawUrl = stripSurroundingQuotes(process.env.SUPABASE_URL);
  const key = stripSurroundingQuotes(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!rawUrl || !key) return null;

  if (!/^https?:\/\//i.test(rawUrl)) {
    rawUrl = `https://${rawUrl}`;
  }
  rawUrl = rawUrl.replace(/\/+$/, '');

  try {
    const parsed = new URL(rawUrl);
    return { url: rawUrl, hostname: parsed.hostname, key, invalidUrl: false };
  } catch (urlErr) {
    return { url: rawUrl, hostname: null, key, invalidUrl: true, urlError: urlErr.message };
  }
}

function extractNestedCause(err) {
  const cause = err && err.cause ? err.cause : null;
  const causeCode = (cause && cause.code) || (err && err.code) || null;
  const causeName = (cause && cause.name) || null;
  const causeMessage = (cause && cause.message) || null;
  const causeHostname = (cause && cause.hostname) || null;
  return { causeCode, causeName, causeMessage, causeHostname };
}

async function safeStorageFetch(url, options = {}, meta = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const operation = meta.operation || 'supabase_storage_request';
  const correlationId = meta.correlationId || null;
  let hostname = 'unknown';
  try {
    hostname = new URL(url).hostname;
  } catch (_) {
    const err = new Error(`Invalid Supabase Storage URL for ${operation}`);
    err.code = 'STORAGE_ERR_INVALID_URL';
    err.causeCode = 'ERR_INVALID_URL';
    err.isStorageError = true;
    err.operation = operation;
    console.error('[PrivateStorage] Invalid outbound URL:', { correlationId, operation, method });
    throw err;
  }

  try {
    return await fetch(url, {
      ...options,
      signal: options.signal || AbortSignal.timeout(STORAGE_FETCH_TIMEOUT_MS),
    });
  } catch (fetchErr) {
    const { causeCode, causeName, causeMessage, causeHostname } = extractNestedCause(fetchErr);
    const resolvedCode = causeCode ? `STORAGE_${causeCode}` : 'STORAGE_FETCH_FAILED';

    console.error('[PrivateStorage] Outbound fetch failed:', {
      correlationId,
      operation,
      hostname: causeHostname || hostname,
      method,
      errorName: fetchErr.name || 'Error',
      errorMessage: fetchErr.message || 'fetch failed',
      causeName,
      causeCode,
      causeMessage,
    });

    const wrapped = new Error(`Supabase Storage network error during ${operation}: ${causeCode || fetchErr.message}`);
    wrapped.code = resolvedCode;
    wrapped.causeCode = causeCode;
    wrapped.isStorageError = true;
    wrapped.operation = operation;
    wrapped.hostname = causeHostname || hostname;
    throw wrapped;
  }
}

let bucketVerified = false;
async function ensurePrivateSupabaseBucket(cfg, correlationId = null) {
  if (bucketVerified) return;
  if (cfg.invalidUrl) {
    const err = new Error(`Configured SUPABASE_URL is invalid (${cfg.urlError || 'malformed URL'}).`);
    err.code = 'STORAGE_ERR_INVALID_URL';
    err.causeCode = 'ERR_INVALID_URL';
    err.isStorageError = true;
    throw err;
  }

  const res = await safeStorageFetch(
    `${cfg.url}/storage/v1/bucket/${encodeURIComponent(PRIVATE_BUCKET)}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${cfg.key}`,
        apikey: cfg.key,
      },
    },
    { operation: 'check_private_bucket', correlationId }
  );

  if (res.ok) {
    bucketVerified = true;
    return;
  }
  if (res.status === 404 || res.status === 400) {
    const createRes = await safeStorageFetch(
      `${cfg.url}/storage/v1/bucket`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cfg.key}`,
          apikey: cfg.key,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: PRIVATE_BUCKET,
          name: PRIVATE_BUCKET,
          public: false,
          file_size_limit: MAX_IMAGE_BYTES,
          allowed_mime_types: ['image/jpeg', 'image/png', 'image/webp'],
        }),
      },
      { operation: 'create_private_bucket', correlationId }
    );
    if (!createRes.ok) {
      const txt = await createRes.text().catch(() => '');
      const err = new Error(`Unable to ensure private Supabase Storage bucket: HTTP ${createRes.status} ${txt}`);
      err.code = `STORAGE_HTTP_${createRes.status}`;
      err.isStorageError = true;
      throw err;
    }
    bucketVerified = true;
    return;
  }

  const err = new Error(`Unable to check Supabase Storage bucket: HTTP ${res.status}`);
  err.code = `STORAGE_HTTP_${res.status}`;
  err.isStorageError = true;
  throw err;
}

async function savePrivateIdentityPhoto({ dataUrl, label, prefix = 'doc', correlationId = null }) {
  const parsed = parseAndValidateImageDataUrl(dataUrl, label);
  const filename = `${prefix}-${Date.now()}-${crypto.randomBytes(8).toString('hex')}.${parsed.ext}`;
  const sb = getSupabaseStorageConfig();

  if (sb) {
    await ensurePrivateSupabaseBucket(sb, correlationId);
    const objectPath = `pending/${filename}`;
    const uploadRes = await safeStorageFetch(
      `${sb.url}/storage/v1/object/${encodeURIComponent(PRIVATE_BUCKET)}/${objectPath}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sb.key}`,
          apikey: sb.key,
          'Content-Type': parsed.mime,
          'x-upsert': 'false',
        },
        body: new Uint8Array(parsed.buffer),
      },
      { operation: `upload_${label.toLowerCase().replace(/\s+/g, '_')}`, correlationId }
    );
    if (!uploadRes.ok) {
      const errText = await uploadRes.text().catch(() => '');
      const err = new Error(`Private storage upload failed: HTTP ${uploadRes.status} ${errText}`);
      err.code = `STORAGE_HTTP_${uploadRes.status}`;
      err.isStorageError = true;
      throw err;
    }
    return {
      storageRef: `supabase:${PRIVATE_BUCKET}/${objectPath}`,
      mimeType: parsed.mime,
      byteLength: parsed.size,
    };
  }

  fs.mkdirSync(LOCAL_PRIVATE_DIR, { recursive: true });
  const targetPath = path.join(LOCAL_PRIVATE_DIR, filename);
  if (!targetPath.startsWith(LOCAL_PRIVATE_DIR + path.sep)) {
    throw new Error('Invalid storage target path.');
  }
  fs.writeFileSync(targetPath, parsed.buffer);
  return {
    storageRef: `local:${filename}`,
    mimeType: parsed.mime,
    byteLength: parsed.size,
  };
}

async function readPrivateIdentityPhoto(storageRef) {
  const ref = String(storageRef || '').trim();
  if (!ref) {
    throw new Error('Missing identity photo reference.');
  }

  if (ref.startsWith('supabase:')) {
    const sb = getSupabaseStorageConfig();
    if (!sb) {
      throw new Error('Supabase Storage credentials are not configured.');
    }
    const rest = ref.slice('supabase:'.length);
    const slashIdx = rest.indexOf('/');
    if (slashIdx <= 0) throw new Error('Invalid Supabase storage reference.');
    const bucket = rest.slice(0, slashIdx);
    const objectPath = rest.slice(slashIdx + 1);
    const res = await safeStorageFetch(
      `${sb.url}/storage/v1/object/authenticated/${encodeURIComponent(bucket)}/${objectPath}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${sb.key}`,
          apikey: sb.key,
        },
      },
      { operation: 'read_private_identity_photo' }
    );
    if (!res.ok) {
      throw new Error(`Unable to retrieve private identity photo (HTTP ${res.status}).`);
    }
    const arrayBuf = await res.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuf),
      mimeType: res.headers.get('content-type') || 'image/jpeg',
    };
  }

  if (ref.startsWith('local:')) {
    const safeName = path.basename(ref.slice('local:'.length));
    const filePath = path.resolve(LOCAL_PRIVATE_DIR, safeName);
    if (!filePath.startsWith(LOCAL_PRIVATE_DIR + path.sep) || !fs.existsSync(filePath)) {
      throw new Error('Identity photo file not found.');
    }
    return {
      buffer: fs.readFileSync(filePath),
      mimeType: safeName.endsWith('.png') ? 'image/png' : safeName.endsWith('.webp') ? 'image/webp' : 'image/jpeg',
    };
  }

  throw new Error('Unsupported storage reference format.');
}

async function deletePrivateIdentityPhoto(storageRef) {
  const ref = String(storageRef || '').trim();
  if (!ref) return;
  try {
    if (ref.startsWith('supabase:')) {
      const sb = getSupabaseStorageConfig();
      if (!sb || sb.invalidUrl) return;
      const rest = ref.slice('supabase:'.length);
      const slashIdx = rest.indexOf('/');
      if (slashIdx <= 0) return;
      const bucket = rest.slice(0, slashIdx);
      const objectPath = rest.slice(slashIdx + 1);
      await safeStorageFetch(
        `${sb.url}/storage/v1/object/${encodeURIComponent(bucket)}/${objectPath}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${sb.key}`,
            apikey: sb.key,
          },
        },
        { operation: 'delete_private_identity_photo' }
      );
    } else if (ref.startsWith('local:')) {
      const safeName = path.basename(ref.slice('local:'.length));
      const filePath = path.resolve(LOCAL_PRIVATE_DIR, safeName);
      if (filePath.startsWith(LOCAL_PRIVATE_DIR + path.sep) && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
  } catch (err) {
    console.warn('[PrivateStorage] cleanup warning:', err.message);
  }
}

/**
 * Safe Admin-only diagnostic for Supabase Storage connectivity.
 * Never exposes API keys, service role tokens, or full credentials.
 */
async function diagnoseStorageConnectivity() {
  const sb = getSupabaseStorageConfig();
  if (!sb) {
    return {
      configured: false,
      mode: 'local_fallback',
      bucket: PRIVATE_BUCKET,
      category: 'NOT_CONFIGURED',
      message: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set; using local disk fallback.',
    };
  }
  if (sb.invalidUrl) {
    return {
      configured: true,
      mode: 'supabase',
      bucket: PRIVATE_BUCKET,
      hostname: null,
      category: 'INVALID_URL',
      causeCode: 'ERR_INVALID_URL',
      message: sb.urlError || 'Malformed SUPABASE_URL',
    };
  }

  let dnsResolved = false;
  let addressesCount = 0;
  try {
    const addrs = await dns.lookup(sb.hostname, { all: true });
    dnsResolved = Array.isArray(addrs) && addrs.length > 0;
    addressesCount = addrs ? addrs.length : 0;
  } catch (dnsErr) {
    return {
      configured: true,
      mode: 'supabase',
      bucket: PRIVATE_BUCKET,
      hostname: sb.hostname,
      dnsResolved: false,
      addressesCount: 0,
      category: 'DNS_ENOTFOUND',
      causeCode: dnsErr.code || 'ENOTFOUND',
      message: dnsErr.message,
    };
  }

  try {
    const res = await safeStorageFetch(
      `${sb.url}/storage/v1/bucket/${encodeURIComponent(PRIVATE_BUCKET)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${sb.key}`,
          apikey: sb.key,
        },
      },
      { operation: 'diagnose_storage_connectivity' }
    );
    return {
      configured: true,
      mode: 'supabase',
      bucket: PRIVATE_BUCKET,
      hostname: sb.hostname,
      dnsResolved,
      addressesCount,
      httpStatus: res.status,
      category: res.ok ? 'OK' : `HTTP_${res.status}`,
    };
  } catch (err) {
    const cc = String(err.causeCode || '');
    let category = 'FETCH_FAILED';
    if (cc.includes('ENOTFOUND')) category = 'DNS_ENOTFOUND';
    else if (cc.includes('ECONNREFUSED')) category = 'CONNECTION_REFUSED';
    else if (cc.includes('TIMEOUT') || cc === 'ABORT_ERR') category = 'TIMEOUT';
    else if (cc.includes('CERT') || cc.includes('TLS') || cc.includes('SSL')) category = 'TLS_ERROR';

    return {
      configured: true,
      mode: 'supabase',
      bucket: PRIVATE_BUCKET,
      hostname: sb.hostname,
      dnsResolved,
      addressesCount,
      category,
      causeCode: err.causeCode || err.code,
      message: err.message,
    };
  }
}

module.exports = {
  parseAndValidateImageDataUrl,
  savePrivateIdentityPhoto,
  readPrivateIdentityPhoto,
  deletePrivateIdentityPhoto,
  diagnoseStorageConnectivity,
};
