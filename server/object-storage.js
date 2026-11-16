const fs = require('node:fs/promises');
const path = require('node:path');

const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '../public/uploads'));
const supabaseUrl = (process.env.SUPABASE_URL || 'https://fnxddxknngfuqvzawlni.supabase.co').replace(/\/+$/, '');
const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabaseBucket = process.env.SUPABASE_STORAGE_BUCKET || 'hippo-media';
const supabaseConfigured = Boolean(supabaseUrl && supabaseKey);
const endpoint = process.env.R2_ENDPOINT || '';
const accessKeyId = process.env.R2_ACCESS_KEY_ID || '';
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || '';
const r2Bucket = process.env.R2_BUCKET || '';
const r2PublicBase = (process.env.R2_PUBLIC_URL || '').replace(/\/+$/, '');
const r2Configured = Boolean(endpoint && accessKeyId && secretAccessKey && r2Bucket && r2PublicBase);
const remoteConfigured = supabaseConfigured || r2Configured;

let client = null;
if (!supabaseConfigured && r2Configured) {
  const { S3Client } = require('@aws-sdk/client-s3');
  client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey }
  });
}

function safeKey(key) {
  const normalized = String(key || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('Chave de arquivo inválida.');
  }
  return normalized;
}

function encodeKey(key) {
  return safeKey(key).split('/').map(encodeURIComponent).join('/');
}

function publicBase() {
  return supabaseConfigured ? supabaseUrl : r2PublicBase;
}

function isPublicUrl(value) {
  if (typeof value !== 'string') return false;
  if (value.startsWith('/uploads/')) return /^\/uploads\/(?:avatars|files)\/[a-f0-9-]+(?:\.[a-z0-9]{1,10})?$/i.test(value);
  if (!supabaseConfigured) return false;
  const prefix = `${supabaseUrl}/storage/v1/object/public/${supabaseBucket}/files/`;
  return value.startsWith(prefix) && /^[a-f0-9-]+(?:\.[a-z0-9]{1,10})?$/i.test(value.slice(prefix.length));
}

async function put(buffer, key, contentType) {
  key = safeKey(key);
  if (supabaseConfigured) {
    const response = await fetch(`${supabaseUrl}/storage/v1/object/${supabaseBucket}/${encodeKey(key)}`, {
      method: 'POST',
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        'Content-Type': contentType,
        'Cache-Control': 'max-age=86400',
        'x-upsert': 'false'
      },
      body: buffer
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Falha no Supabase Storage (${response.status}): ${detail.slice(0, 300)}`);
    }
    return url(key);
  }
  if (r2Configured) {
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    await client.send(new PutObjectCommand({
      Bucket: r2Bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: 'public, max-age=86400'
    }));
    return url(key);
  }
  const target = path.resolve(uploadDir, key);
  if (!target.startsWith(uploadDir + path.sep)) throw new Error('Destino de arquivo inválido.');
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, buffer, { flag: 'wx' });
  return `/uploads/${key.split('/').map(encodeURIComponent).join('/')}`;
}

function url(key) {
  key = safeKey(key);
  if (supabaseConfigured) return `${supabaseUrl}/storage/v1/object/public/${supabaseBucket}/${encodeKey(key)}`;
  if (r2Configured) return `${r2PublicBase}/${encodeKey(key)}`;
  return `/uploads/${encodeKey(key)}`;
}

async function removeByUrl(value) {
  if (!value || typeof value !== 'string') return;
  if (supabaseConfigured && value.startsWith(`${supabaseUrl}/storage/v1/object/public/${supabaseBucket}/`)) {
    const key = decodeURIComponent(value.slice(`${supabaseUrl}/storage/v1/object/public/${supabaseBucket}/`.length));
    const response = await fetch(`${supabaseUrl}/storage/v1/object/${supabaseBucket}`, {
      method: 'DELETE',
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ prefixes: [safeKey(key)] })
    });
    if (!response.ok) throw new Error(`Falha ao remover arquivo do Supabase Storage (${response.status}).`);
    return;
  }
  if (r2Configured && value.startsWith(`${r2PublicBase}/`)) {
    const key = decodeURIComponent(value.slice(r2PublicBase.length + 1));
    const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
    await client.send(new DeleteObjectCommand({ Bucket: r2Bucket, Key: safeKey(key) }));
    return;
  }
  if (value.startsWith('/uploads/')) {
    const key = decodeURIComponent(value.slice('/uploads/'.length));
    const target = path.resolve(uploadDir, safeKey(key));
    if (!target.startsWith(uploadDir + path.sep)) return;
    await fs.unlink(target).catch(err => { if (err.code !== 'ENOENT') throw err; });
  }
}

module.exports = {
  put,
  url,
  removeByUrl,
  isPublicUrl,
  isRemote: remoteConfigured,
  isConfigured: remoteConfigured,
  uploadDir
};
