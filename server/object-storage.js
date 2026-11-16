const fs = require('node:fs/promises');
const path = require('node:path');

const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '../public/uploads'));
const endpoint = process.env.R2_ENDPOINT || '';
const accessKeyId = process.env.R2_ACCESS_KEY_ID || '';
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || '';
const bucket = process.env.R2_BUCKET || '';
const publicBase = (process.env.R2_PUBLIC_URL || '').replace(/\/+$/, '');
const remoteConfigured = Boolean(endpoint && accessKeyId && secretAccessKey && bucket && publicBase);

let client = null;
if (remoteConfigured) {
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

async function put(buffer, key, contentType) {
  key = safeKey(key);
  if (remoteConfigured) {
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    await client.send(new PutObjectCommand({
      Bucket: bucket,
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
  return `${publicBase}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

async function removeByUrl(value) {
  if (!value || typeof value !== 'string') return;
  if (remoteConfigured && value.startsWith(`${publicBase}/`)) {
    const key = decodeURIComponent(value.slice(publicBase.length + 1));
    const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: safeKey(key) }));
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
  isRemote: remoteConfigured,
  isConfigured: remoteConfigured,
  uploadDir
};
