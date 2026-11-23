const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PRIVATE_BUCKET = process.env.SUPABASE_BUCKET_RESIDENT_IDENTITY || 'resident-identity-docs';
const LOCAL_PRIVATE_DIR = path.resolve(__dirname, '../private_uploads', PRIVATE_BUCKET);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
const MIN_IMAGE_BYTES = 2048; // 2 KB minimum to reject empty/blank images

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

function getSupabaseStorageConfig() {
  const url = String(process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) return null;
  return { url, key };
}

let bucketVerified = false;
async function ensurePrivateSupabaseBucket(cfg) {
  if (bucketVerified) return;
  const res = await fetch(`${cfg.url}/storage/v1/bucket/${encodeURIComponent(PRIVATE_BUCKET)}`, {
    headers: {
      Authorization: `Bearer ${cfg.key}`,
      apikey: cfg.key,
    },
  });
  if (res.ok) {
    bucketVerified = true;
    return;
  }
  if (res.status === 404 || res.status === 400) {
    const createRes = await fetch(`${cfg.url}/storage/v1/bucket`, {
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
    });
    if (!createRes.ok) {
      const txt = await createRes.text().catch(() => '');
      throw new Error(`Unable to ensure private Supabase Storage bucket: ${createRes.status} ${txt}`);
    }
    bucketVerified = true;
    return;
  }
  throw new Error(`Unable to check Supabase Storage bucket: HTTP ${res.status}`);
}

async function savePrivateIdentityPhoto({ dataUrl, label, prefix = 'doc' }) {
  const parsed = parseAndValidateImageDataUrl(dataUrl, label);
  const filename = `${prefix}-${Date.now()}-${crypto.randomBytes(8).toString('hex')}.${parsed.ext}`;
  const sb = getSupabaseStorageConfig();

  if (sb) {
    await ensurePrivateSupabaseBucket(sb);
    const objectPath = `pending/${filename}`;
    const uploadRes = await fetch(
      `${sb.url}/storage/v1/object/${encodeURIComponent(PRIVATE_BUCKET)}/${objectPath}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sb.key}`,
          apikey: sb.key,
          'Content-Type': parsed.mime,
          'x-upsert': 'false',
        },
        body: parsed.buffer,
      }
    );
    if (!uploadRes.ok) {
      const errText = await uploadRes.text().catch(() => '');
      throw new Error(`Private storage upload failed: ${uploadRes.status} ${errText}`);
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
    const res = await fetch(
      `${sb.url}/storage/v1/object/authenticated/${encodeURIComponent(bucket)}/${objectPath}`,
      {
        headers: {
          Authorization: `Bearer ${sb.key}`,
          apikey: sb.key,
        },
      }
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
      if (!sb) return;
      const rest = ref.slice('supabase:'.length);
      const slashIdx = rest.indexOf('/');
      if (slashIdx <= 0) return;
      const bucket = rest.slice(0, slashIdx);
      const objectPath = rest.slice(slashIdx + 1);
      await fetch(`${sb.url}/storage/v1/object/${encodeURIComponent(bucket)}/${objectPath}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${sb.key}`,
          apikey: sb.key,
        },
      });
    } else if (ref.startsWith('local:')) {
      const safeName = path.basename(ref.slice('local:'.length));
      const filePath = path.resolve(LOCAL_PRIVATE_DIR, safeName);
      if (filePath.startsWith(LOCAL_PRIVATE_DIR + path.sep) && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
  } catch (_) { }
}

module.exports = {
  parseAndValidateImageDataUrl,
  savePrivateIdentityPhoto,
  readPrivateIdentityPhoto,
  deletePrivateIdentityPhoto,
};
