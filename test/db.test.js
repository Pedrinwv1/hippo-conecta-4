const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
test('db lê estrutura padrão e serializa atualizações', async () => {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(),'hippo-db-'));
 process.env.DB_PATH = path.join(dir,'data.json');
 const dbPath = require.resolve('../server/db'); delete require.cache[dbPath];
 const { readDB, updateDB } = require('../server/db');
 assert.deepEqual(readDB().users, []);
 await Promise.all([updateDB(db => db.users.push({id:'a'})), updateDB(db => db.users.push({id:'b'}))]);
 assert.equal(readDB().users.length,2);
 fs.rmSync(dir,{recursive:true,force:true}); delete process.env.DB_PATH;
});

test('mutação que falha não altera o estado persistido', async () => {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(),'hippo-db-rollback-'));
 process.env.DB_PATH = path.join(dir,'data.json');
 const dbPath = require.resolve('../server/db'); delete require.cache[dbPath];
 const { readDB, updateDB } = require('../server/db');
 await assert.rejects(updateDB(db => { db.users.push({ id: 'nao-salvar' }); throw new Error('falha simulada'); }), /falha simulada/);
 assert.equal(readDB().users.some(user => user.id === 'nao-salvar'), false);
 fs.rmSync(dir,{recursive:true,force:true}); delete process.env.DB_PATH;
});
