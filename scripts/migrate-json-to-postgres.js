#!/usr/bin/env node
// One-way, repeatable import. Existing JSON is read-only and never deleted.
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const source = path.resolve(process.env.DB_PATH || path.join(__dirname, '../server/data.json'));
if (!process.env.DATABASE_URL) throw new Error('Defina DATABASE_URL antes da migração.');
if (!fs.existsSync(source)) throw new Error(`Arquivo JSON não encontrado: ${source}`);
const db = JSON.parse(fs.readFileSync(source, 'utf8'));
(async () => {
 const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: true } : undefined });
 await client.connect();
 try {
  await client.query('BEGIN');
  for (const u of db.users || []) await client.query(`INSERT INTO hc_users(id,email,password_hash,name,payload) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(id) DO UPDATE SET email=EXCLUDED.email,password_hash=EXCLUDED.password_hash,name=EXCLUDED.name,payload=EXCLUDED.payload`, [u.id,u.email,u.passwordHash,u.name,JSON.stringify(u)]);
  for (const s of db.servers || []) {
   await client.query(`INSERT INTO hc_servers(id,name,payload) VALUES($1,$2,$3::jsonb) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,payload=EXCLUDED.payload`, [s.id,s.name,JSON.stringify(s)]);
   for (const c of s.channels || []) await client.query(`INSERT INTO hc_channels(id,server_id,name,channel_type,payload) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(id) DO UPDATE SET server_id=EXCLUDED.server_id,name=EXCLUDED.name,channel_type=EXCLUDED.channel_type,payload=EXCLUDED.payload`, [c.id,s.id,c.name,c.type || 'text',JSON.stringify(c)]);
   for (const m of s.members || []) await client.query(`INSERT INTO hc_server_members(server_id,user_id,role,payload) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(server_id,user_id) DO UPDATE SET role=EXCLUDED.role,payload=EXCLUDED.payload`, [s.id,m.userId,m.role || null,JSON.stringify(m)]);
  }
  for (const [channelId, messages] of Object.entries(db.messages || {})) for (const m of messages || []) await client.query(`INSERT INTO hc_messages(id,channel_id,author_id,created_at,payload) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(id) DO UPDATE SET channel_id=EXCLUDED.channel_id,author_id=EXCLUDED.author_id,created_at=EXCLUDED.created_at,payload=EXCLUDED.payload`, [m.id,channelId,m.authorId || '',m.timestamp || null,JSON.stringify(m)]);
  await client.query(`CREATE TABLE IF NOT EXISTS hc_state (id SMALLINT PRIMARY KEY CHECK (id = 1), payload JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await client.query('INSERT INTO hc_state(id,payload) VALUES(1,$1::jsonb) ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload, updated_at=now()', [JSON.stringify({ users: db.users || [], servers: db.servers || [], messages: db.messages || {} })]);
  await client.query('COMMIT');
  console.log(`Importação concluída: ${(db.users||[]).length} usuários, ${(db.servers||[]).length} servidores e ${Object.values(db.messages||{}).reduce((n,a)=>n+(a||[]).length,0)} mensagens.`);
 } catch (e) { await client.query('ROLLBACK'); throw e; }
 finally { await client.end(); }
})().catch(e => { console.error('Falha na migração:',e.message); process.exitCode=1; });
