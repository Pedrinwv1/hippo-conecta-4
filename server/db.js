const fs = require('node:fs');
const path = require('node:path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.json');
const defaultState = {
  users: [],
  servers: [{
    id: 'srv-hq', name: 'Hippo Conecta Oficial', icon: 'HC', inviteCode: 'HIPO-PRO',
    channels: [
      { id: 'ch-geral', name: 'geral', type: 'text', topic: 'Canal principal' },
      { id: 'vc-lobby', name: 'Lounge de Voz', type: 'voice' }
    ], members: []
  }],
  messages: {
    'ch-geral': [{ id: 'm1', authorId: 'sys', authorName: 'Sistema', text: 'Bem-vindo ao Hippo Conecta!', timestamp: new Date().toISOString(), reactions: {} }]
  }
};

let state = null;
let pool = null;
let writeQueue = Promise.resolve();
const clone = value => JSON.parse(JSON.stringify(value));

function normalizeState(parsed = {}) {
  return {
    users: Array.isArray(parsed.users) ? parsed.users : [],
    servers: Array.isArray(parsed.servers) ? parsed.servers : clone(defaultState.servers),
    messages: parsed.messages && typeof parsed.messages === 'object' && !Array.isArray(parsed.messages) ? parsed.messages : {}
  };
}

function ensureFile() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    const tmp = `${DB_PATH}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(defaultState, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, DB_PATH);
  }
}

async function initDB() {
  if (process.env.DATABASE_URL) {
    let Pool;
    try { ({ Pool } = require('pg')); }
    catch { throw new Error('DATABASE_URL foi definido, mas o pacote pg não está instalado. Execute npm install.'); }
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined,
      max: Number(process.env.PG_POOL_MAX || 10),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    });
    await pool.query(`CREATE TABLE IF NOT EXISTS hc_state (
      id SMALLINT PRIMARY KEY CHECK (id = 1),
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
    const result = await pool.query('SELECT payload FROM hc_state WHERE id = 1');
    if (result.rowCount) state = normalizeState(result.rows[0].payload);
    else {
      state = normalizeState(defaultState);
      await pool.query('INSERT INTO hc_state(id,payload) VALUES(1,$1::jsonb) ON CONFLICT(id) DO NOTHING', [JSON.stringify(state)]);
    }
    console.info('[db] PostgreSQL conectado; estado carregado.');
    return { driver: 'postgres' };
  }
  ensureFile();
  state = normalizeState(JSON.parse(fs.readFileSync(DB_PATH, 'utf8')));
  console.info('[db] armazenamento JSON local ativo.');
  return { driver: 'json' };
}

function readDB() {
  if (!state) {
    if (process.env.DATABASE_URL) throw new Error('Banco PostgreSQL ainda não inicializado. Aguarde initDB().');
    ensureFile();
    state = normalizeState(JSON.parse(fs.readFileSync(DB_PATH, 'utf8')));
  }
  return state;
}

function updateDB(mutator) {
  const operation = writeQueue.then(async () => {
    if (!state) await initDB();
    const next = clone(state);
    const result = await mutator(next);
    if (pool) {
      await pool.query('UPDATE hc_state SET payload=$1::jsonb, updated_at=now() WHERE id=1', [JSON.stringify(next)]);
    } else {
      const tmp = `${DB_PATH}.${process.pid}.${Date.now()}.tmp`;
      await fs.promises.writeFile(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
      await fs.promises.rename(tmp, DB_PATH);
    }
    state = next;
    return result;
  });
  writeQueue = operation.catch(() => {});
  return operation;
}

async function closeDB() {
  if (pool) { await pool.end(); pool = null; }
}

module.exports = { readDB, updateDB, initDB, closeDB, DB_PATH };
