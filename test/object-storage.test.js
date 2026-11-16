const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

test('armazenamento local grava, publica URL e remove arquivo', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hippo-storage-'));
  process.env.UPLOAD_DIR = dir;
  for (const key of ['R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_URL']) delete process.env[key];
  const modulePath = require.resolve('../server/object-storage');
  delete require.cache[modulePath];
  const storage = require('../server/object-storage');
  assert.equal(storage.isRemote, false);
  const url = await storage.put(Buffer.from('arquivo teste'), 'files/teste.txt', 'text/plain');
  assert.equal(url, '/uploads/files/teste.txt');
  assert.equal(await fs.readFile(path.join(dir, 'files', 'teste.txt'), 'utf8'), 'arquivo teste');
  await storage.removeByUrl(url);
  await assert.rejects(fs.access(path.join(dir, 'files', 'teste.txt')));
  await assert.rejects(storage.put(Buffer.from('x'), '../fora.txt', 'text/plain'), /inválida/);
  await fs.rm(dir, { recursive: true, force: true });
  delete process.env.UPLOAD_DIR;
  delete require.cache[modulePath];
});
