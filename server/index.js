require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const { readDB, updateDB, initDB, closeDB } = require('./db');
const objectStorage = require('./object-storage');

const app = express();
const server = http.createServer(app);
const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';
const JWT_SECRET = process.env.JWT_SECRET || (!IS_PROD ? 'dev-only-change-this-secret-please-replace-123456789' : '');
if (!JWT_SECRET || JWT_SECRET.length < 32) throw new Error('Defina JWT_SECRET com pelo menos 32 caracteres no ambiente.');

const allowedOrigins = (process.env.CORS_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean);
const sameOriginPublicUrl = (process.env.RENDER_EXTERNAL_URL || process.env.HIPPO_PUBLIC_URL || '').replace(/\/$/, '');
if (IS_PROD && !allowedOrigins.length && !sameOriginPublicUrl && process.env.HIPPO_DESKTOP !== '1') throw new Error('Defina RENDER_EXTERNAL_URL, HIPPO_PUBLIC_URL ou CORS_ORIGINS em produção.');
const originPolicy = IS_PROD
  ? (origin, callback) => {
      if (!origin) return callback(null, true);
      const desktopOrigin = process.env.HIPPO_DESKTOP === '1' && /^http:\/\/127\.0\.0\.1:\d+$/.test(origin);
      const capacitorOrigin = origin === 'https://localhost';
      if (allowedOrigins.includes(origin) || (sameOriginPublicUrl && origin === sameOriginPublicUrl) || desktopOrigin || capacitorOrigin) return callback(null, true);
      return callback(new Error('Origem não permitida pelo CORS.'));
    }
  : (allowedOrigins.length ? allowedOrigins : true);
const io = new Server(server, {
  cors: { origin: originPolicy, credentials: true },
  maxHttpBufferSize: 1e6,
  pingInterval: 25000,
  pingTimeout: 20000
});

app.disable('x-powered-by');
if (process.env.RENDER) app.set('trust proxy', 1);
if (process.env.REQUIRE_REMOTE_STORAGE === 'true' && !objectStorage.isRemote) throw new Error('Configure o armazenamento persistente R2 antes de publicar.');
if (process.env.REQUIRE_POSTGRES === 'true' && !process.env.DATABASE_URL) throw new Error('Configure DATABASE_URL; armazenamento JSON local não é permitido neste ambiente.');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), display-capture=(self)');
  if (IS_PROD) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});
app.use(cors({ origin: originPolicy, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '../public')));

const uploadDir = objectStorage.uploadDir;
fs.mkdirSync(uploadDir, { recursive: true });
app.use('/uploads', express.static(uploadDir, { fallthrough: false, maxAge: IS_PROD ? '7d' : 0 }));

// Pequeno limitador em memória: suficiente para instância única; use Redis em cluster.
const buckets = new Map();
function rateLimit({ windowMs = 60000, max = 30 } = {}) {
  return (req, res, next) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    let item = buckets.get(key);
    if (!item || item.resetAt <= now) item = { count: 0, resetAt: now + windowMs };
    item.count += 1;
    buckets.set(key, item);
    if (buckets.size > 5000) for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    if (item.count > max) return res.status(429).json({ error: 'Muitas tentativas. Aguarde um pouco.' });
    next();
  };
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Token não fornecido.' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { return res.status(401).json({ error: 'Sessão inválida.' }); }
}
function publicUser(user) { return { id: user.id, name: user.name, email: user.email, avatarUrl: user.avatarUrl || null, preferences: user.preferences || { theme: 'obsidian', density: 'comfortable', notifications: true } }; }
function channelAccess(db, userId, channelId) {
  return db.servers.some(s => s.members.some(m => m.userId === userId) && s.channels.some(c => c.id === channelId));
}
function socketAck(ack, payload) { if (typeof ack === 'function') ack(payload); }

app.get('/healthz', (req, res) => res.json({ ok: true, service: 'hippo-conecta', timestamp: new Date().toISOString() }));

app.post('/api/auth/register', rateLimit({ max: 8 }), async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim().slice(0, 40);
    const email = String(req.body.email || '').trim().toLowerCase().slice(0, 254);
    const password = String(req.body.password || '');
    if (name.length < 2 || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8 || password.length > 128) {
      return res.status(400).json({ error: 'Informe nome, e-mail válido e senha de 8 a 128 caracteres.' });
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const user = { id: uuidv4(), name, email, passwordHash, createdAt: new Date().toISOString() };
    await updateDB(db => {
      if (db.users.some(u => u.email === email)) {
        const error = new Error('E-mail já cadastrado.'); error.status = 409; throw error;
      }
      db.users.push(user);
      const official = db.servers[0];
      if (official && !official.members.some(m => m.userId === user.id)) official.members.push({ userId: user.id, name, role: 'Membro' });
    });
    const token = jwt.sign({ id: user.id, email, name }, JWT_SECRET, { expiresIn: '7d', issuer: 'hippo-conecta' });
    res.status(201).json({ token, user: publicUser(user) });
  } catch (err) { next(err); }
});

app.post('/api/auth/login', rateLimit({ max: 12 }), async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const user = readDB().users.find(u => u.email === email);
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ error: 'Credenciais inválidas.' });
    const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '7d', issuer: 'hippo-conecta' });
    res.json({ token, user: publicUser(user) });
  } catch (err) { next(err); }
});


function friendPair(a, b) { return [a, b].sort().join(':'); }
function areFriends(db, a, b) { return (db.friendships || []).some(f => friendPair(f.userA, f.userB) === friendPair(a, b)); }
app.get('/api/friends', authMiddleware, (req, res) => {
  const db = readDB(), uid = req.user.id;
  const friends = (db.friendships || []).filter(f => f.userA === uid || f.userB === uid).map(f => {
    const id = f.userA === uid ? f.userB : f.userA, user = db.users.find(u => u.id === id); if (!user) return null;
    const active = [...io.sockets.sockets.values()].find(s => s.user?.id === id);
    const voice = active?.currentRoom ? db.servers.flatMap(server => server.channels.map(c => ({...c, serverName: server.name}))).find(c => c.id === active.currentRoom) : null;
    return { ...publicUser(user), online: Boolean(active), inCall: Boolean(active?.currentRoom), callChannel: voice?.name || null, callServer: voice?.serverName || null };
  }).filter(Boolean);
  const incoming = (db.friendRequests || []).filter(r => r.toUserId === uid).map(r => ({ id:r.id, createdAt:r.createdAt, user:publicUser(db.users.find(u=>u.id===r.fromUserId)||{}) })).filter(r=>r.user.id);
  const outgoing = (db.friendRequests || []).filter(r => r.fromUserId === uid).map(r => ({ id:r.id, createdAt:r.createdAt, user:publicUser(db.users.find(u=>u.id===r.toUserId)||{}) })).filter(r=>r.user.id);
  res.json({ friends, incoming, outgoing });
});
app.get('/api/users/search', authMiddleware, rateLimit({max:30}), (req,res) => {
  const q=String(req.query.q||'').trim().toLowerCase().slice(0,80); if(q.length<2) return res.json({users:[]});
  const db=readDB(), uid=req.user.id;
  const users=db.users.filter(u=>u.id!==uid&&(u.name.toLowerCase().includes(q)||u.email.toLowerCase()===q)&&!areFriends(db,uid,u.id)&&!(db.friendRequests||[]).some(r=>(r.fromUserId===uid&&r.toUserId===u.id)||(r.fromUserId===u.id&&r.toUserId===uid))).slice(0,12).map(publicUser);
  res.json({users});
});
app.post('/api/friends/request',authMiddleware,rateLimit({max:12}),async(req,res,next)=>{
  try { const targetId=String(req.body.userId||''); let accepted=false;
    await updateDB(db=>{ db.friendships||=[]; db.friendRequests||=[];
      if(!targetId||targetId===req.user.id||!db.users.some(u=>u.id===targetId)){const e=new Error('Usuário não encontrado.');e.status=404;throw e;}
      if(areFriends(db,req.user.id,targetId)){const e=new Error('Vocês já são amigos.');e.status=409;throw e;}
      const reverse=db.friendRequests.find(r=>r.fromUserId===targetId&&r.toUserId===req.user.id);
      if(reverse){db.friendRequests=db.friendRequests.filter(r=>r.id!==reverse.id);db.friendships.push({userA:req.user.id,userB:targetId,createdAt:new Date().toISOString()});accepted=true;return;}
      if(db.friendRequests.some(r=>r.fromUserId===req.user.id&&r.toUserId===targetId)){const e=new Error('Solicitação já enviada.');e.status=409;throw e;}
      db.friendRequests.push({id:uuidv4(),fromUserId:req.user.id,toUserId:targetId,createdAt:new Date().toISOString()});
    });
    io.to(`user:${targetId}`).emit('friends:changed');io.to(`user:${req.user.id}`).emit('friends:changed');res.status(201).json({ok:true,accepted});
  } catch(err){next(err);}
});
app.post('/api/friends/accept',authMiddleware,async(req,res,next)=>{
  try {const requestId=String(req.body.requestId||'');let otherId=null;
    await updateDB(db=>{db.friendships||=[];db.friendRequests||=[];const request=db.friendRequests.find(r=>r.id===requestId&&r.toUserId===req.user.id);if(!request){const e=new Error('Solicitação não encontrada.');e.status=404;throw e;}otherId=request.fromUserId;if(!areFriends(db,req.user.id,otherId))db.friendships.push({userA:req.user.id,userB:otherId,createdAt:new Date().toISOString()});db.friendRequests=db.friendRequests.filter(r=>r.id!==requestId);});
    io.to(`user:${otherId}`).emit('friends:changed');io.to(`user:${req.user.id}`).emit('friends:changed');res.json({ok:true});
  }catch(err){next(err);}
});
app.delete('/api/friends/request/:id',authMiddleware,async(req,res,next)=>{try{await updateDB(db=>{db.friendRequests||=[];db.friendRequests=db.friendRequests.filter(r=>!(r.id===req.params.id&&(r.fromUserId===req.user.id||r.toUserId===req.user.id)));});res.json({ok:true});}catch(err){next(err);}});
app.delete('/api/friends/:userId',authMiddleware,async(req,res,next)=>{try{await updateDB(db=>{db.friendships||=[];db.friendships=db.friendships.filter(f=>friendPair(f.userA,f.userB)!==friendPair(req.user.id,req.params.userId));});io.to(`user:${req.params.userId}`).emit('friends:changed');res.json({ok:true});}catch(err){next(err);}});

app.get('/api/rtc-config', authMiddleware, (req, res) => {
  const iceServers = [{ urls: process.env.STUN_URL || 'stun:stun.l.google.com:19302' }];
  const turnUrls = (process.env.TURN_URLS || '').split(',').map(v => v.trim()).filter(Boolean);
  if (turnUrls.length && process.env.TURN_SHARED_SECRET) {
    const ttl = Math.max(300, Math.min(Number(process.env.TURN_CREDENTIAL_TTL || 3600), 86400));
    const username = `${Math.floor(Date.now() / 1000) + ttl}:${req.user.id}`;
    const credential = crypto.createHmac('sha1', process.env.TURN_SHARED_SECRET).update(username).digest('base64');
    iceServers.push({ urls: turnUrls, username, credential });
  }
  res.json({ iceServers, turnConfigured: iceServers.length > 1, transportPolicy: process.env.ICE_TRANSPORT_POLICY || 'all' });
});

app.get('/api/sfu/config', authMiddleware, async (req, res) => {
  const roomId = String(req.query.roomId || '');
  if (!roomId) return res.status(400).json({ error: 'Informe roomId.' });
  const db = readDB();
  const allowed = db.servers.some(s => s.members.some(m => m.userId === req.user.id) && s.channels.some(c => c.id === roomId && c.type === 'voice'));
  if (!allowed) return res.status(403).json({ error: 'Acesso negado ao canal de voz.' });
  if (!process.env.LIVEKIT_URL || !process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
    return res.status(503).json({ error: 'SFU não configurada. Configure LiveKit no backend.', sfuConfigured: false });
  }
  try {
    const { AccessToken } = require('livekit-server-sdk');
    const token = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, { identity: req.user.id, name: req.user.name, ttl: '1h' });
    token.addGrant({ roomJoin: true, room: roomId, canPublish: true, canSubscribe: true, canPublishData: true });
    res.json({ url: process.env.LIVEKIT_URL, token: await token.toJwt(), sfuConfigured: true, provider: 'livekit' });
  } catch (err) { console.error('[sfu] token error:', err.message); res.status(503).json({ error: 'Não foi possível gerar credencial SFU.' }); }
});

app.get('/api/bootstrap', authMiddleware, (req, res) => {
  const db = readDB();
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(401).json({ error: 'Conta não encontrada.' });
  const usersById = new Map(db.users.map(item => [item.id, item]));
  const servers = db.servers.filter(s => s.members.some(m => m.userId === user.id)).map(server => ({ ...server, members: server.members.map(member => ({ ...member, avatarUrl: usersById.get(member.userId)?.avatarUrl || null })) }));
  const channelIds = new Set(servers.flatMap(s => s.channels.map(c => c.id)));
  const messages = Object.fromEntries(Object.entries(db.messages).filter(([id]) => channelIds.has(id)).map(([id, list]) => [id, list.map(message => ({ ...message, authorAvatarUrl: usersById.get(message.authorId)?.avatarUrl || message.authorAvatarUrl || null }))]));
  res.json({ user: publicUser(user), servers, messages });
});


app.patch('/api/profile', authMiddleware, async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim().slice(0, 40);
    const email = String(req.body.email || '').trim().toLowerCase().slice(0, 254);
    const preferences = req.body.preferences && typeof req.body.preferences === 'object' ? req.body.preferences : null;
    let updated;
    await updateDB(db => {
      const user = db.users.find(item => item.id === req.user.id);
      if (!user) { const error = new Error('Conta não encontrada.'); error.status = 404; throw error; }
      if (name && name.length < 2) { const error = new Error('O nome deve ter pelo menos 2 caracteres.'); error.status = 400; throw error; }
      if (email && !/^\S+@\S+\.\S+$/.test(email)) { const error = new Error('Informe um e-mail válido.'); error.status = 400; throw error; }
      if (email && db.users.some(item => item.id !== user.id && item.email === email)) { const error = new Error('Este e-mail já está em uso.'); error.status = 409; throw error; }
      if (name) user.name = name;
      if (email) user.email = email;
      if (preferences) {
        const theme = ['obsidian', 'midnight', 'light'].includes(preferences.theme) ? preferences.theme : 'obsidian';
        const density = ['comfortable', 'compact'].includes(preferences.density) ? preferences.density : 'comfortable';
        user.preferences = { ...(user.preferences || {}), theme, density, notifications: preferences.notifications !== false };
      }
      db.servers.forEach(server => server.members.forEach(member => { if (member.userId === user.id) member.name = user.name; }));
      updated = publicUser(user);
    });
    for (const socket of io.sockets.sockets.values()) if (socket.user?.id === req.user.id) { socket.user.name = updated.name; socket.user.email = updated.email; socket.user.avatarUrl = updated.avatarUrl; }
    io.emit('profile:updated', { id: updated.id, name: updated.name, avatarUrl: updated.avatarUrl || null });
    res.json({ user: updated });
  } catch (err) { next(err); }
});

const avatarUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024, files: 1 }, fileFilter: (req, file, cb) => {
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype)) return cb(new Error('Use uma imagem JPG, PNG, WEBP ou GIF.'));
  cb(null, true);
} });
app.post('/api/profile/avatar', authMiddleware, (req, res, next) => avatarUpload.single('avatar')(req, res, async err => {
  if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'A imagem deve ter no máximo 4 MB.' : err.message });
  try {
    if (!req.file) return res.status(400).json({ error: 'Selecione uma imagem.' });
    const signatures = { 'image/jpeg': [0xff, 0xd8, 0xff], 'image/png': [0x89, 0x50, 0x4e, 0x47], 'image/gif': [0x47, 0x49, 0x46, 0x38], 'image/webp': [0x52, 0x49, 0x46, 0x46] };
    const signature = signatures[req.file.mimetype];
    if (!signature.every((byte, index) => req.file.buffer[index] === byte)) return res.status(400).json({ error: 'O arquivo não parece ser uma imagem válida.' });
    const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp' }[req.file.mimetype];
    const filename = `avatars/avatar-${crypto.randomUUID()}${ext}`;
    const avatarUrl = await objectStorage.put(req.file.buffer, filename, req.file.mimetype);
    let oldAvatar = null, updated;
    await updateDB(db => {
      const user = db.users.find(item => item.id === req.user.id);
      if (!user) { const error = new Error('Conta não encontrada.'); error.status = 404; throw error; }
      oldAvatar = user.avatarUrl;
      user.avatarUrl = avatarUrl;
      updated = publicUser(user);
    });
    if (oldAvatar) objectStorage.removeByUrl(oldAvatar).catch(err => console.warn('[storage] não foi possível remover avatar antigo:', err.message));
    for (const socket of io.sockets.sockets.values()) if (socket.user?.id === req.user.id) socket.user.avatarUrl = updated.avatarUrl;
    io.emit('profile:updated', { id: updated.id, name: updated.name, avatarUrl: updated.avatarUrl || null });
    res.status(201).json({ user: updated });
  } catch (e) { next(e); }
}));

app.delete('/api/profile/avatar', authMiddleware, async (req, res, next) => {
  try {
    let oldAvatar = null, updated;
    await updateDB(db => {
      const user = db.users.find(item => item.id === req.user.id);
      if (!user) { const error = new Error('Conta não encontrada.'); error.status = 404; throw error; }
      oldAvatar = user.avatarUrl || null; user.avatarUrl = null; updated = publicUser(user);
    });
    if (oldAvatar) objectStorage.removeByUrl(oldAvatar).catch(err => console.warn('[storage] não foi possível remover avatar antigo:', err.message));
    for (const socket of io.sockets.sockets.values()) if (socket.user?.id === req.user.id) socket.user.avatarUrl = null;
    io.emit('profile:updated', { id: updated.id, name: updated.name, avatarUrl: updated.avatarUrl || null });
    res.json({ user: updated });
  } catch (err) { next(err); }
});

app.post('/api/account/password', authMiddleware, rateLimit({ max: 5 }), async (req, res, next) => {
  try {
    const currentPassword = String(req.body.currentPassword || '');
    const newPassword = String(req.body.newPassword || '');
    if (newPassword.length < 8 || newPassword.length > 128) return res.status(400).json({ error: 'A nova senha deve ter entre 8 e 128 caracteres.' });
    const user = readDB().users.find(item => item.id === req.user.id);
    if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) return res.status(400).json({ error: 'A senha atual está incorreta.' });
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await updateDB(db => { const target = db.users.find(item => item.id === req.user.id); if (!target) throw new Error('Conta não encontrada.'); target.passwordHash = passwordHash; });
    res.json({ ok: true, message: 'Senha alterada com sucesso.' });
  } catch (err) { next(err); }
});

app.post('/api/servers', authMiddleware, async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim().slice(0, 48);
    if (name.length < 2) return res.status(400).json({ error: 'O nome do servidor deve ter ao menos 2 caracteres.' });
    const srv = {
      id: 'srv-' + uuidv4(), name,
      icon: String(req.body.icon || name.slice(0, 2)).trim().slice(0, 3).toUpperCase(),
      inviteCode: 'HIPO-' + uuidv4().replace(/-/g, '').slice(0, 8).toUpperCase(),
      channels: [{ id: 'ch-' + uuidv4(), name: 'geral', type: 'text' }, { id: 'vc-' + uuidv4(), name: 'Voz', type: 'voice' }],
      members: [{ userId: req.user.id, name: req.user.name, role: 'Owner' }]
    };
    await updateDB(db => db.servers.push(srv));
    const ownerSocket = [...io.sockets.sockets.values()].find(s => s.user?.id === req.user.id);
    if (ownerSocket) { ownerSocket.join(`server:${srv.id}`); srv.channels.forEach(channel => ownerSocket.join(channel.id)); ownerSocket.emit('server:created', srv); }
    res.status(201).json(srv);
  } catch (err) { next(err); }
});

app.post('/api/servers/join', authMiddleware, async (req, res, next) => {
  try {
    const code = String(req.body.code || '').trim().toUpperCase();
    let result;
    await updateDB(db => {
      const srv = db.servers.find(s => s.inviteCode === code);
      if (!srv) { const e = new Error('Convite inválido.'); e.status = 404; throw e; }
      if (!srv.members.some(m => m.userId === req.user.id)) srv.members.push({ userId: req.user.id, name: req.user.name, role: 'Membro' });
      result = srv;
    });
    const socket = [...io.sockets.sockets.values()].find(s => s.user?.id === req.user.id);
    if (socket) { socket.join(`server:${result.id}`); result.channels.forEach(c => socket.join(c.id)); }
    io.to(`server:${result.id}`).emit('server:member-joined', { serverId: result.id, user: { id: req.user.id, name: req.user.name } });
    res.json(result);
  } catch (err) { next(err); }
});

const allowedMime = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'text/plain', 'application/zip', 'application/x-zip-compressed', 'application/x-zip', 'application/octet-stream']);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 }, fileFilter: (req, file, cb) => {
  const ext = path.extname(file.originalname || '').toLowerCase();
  const mimeAllowed = allowedMime.has(file.mimetype);
  const zipAllowed = ext === '.zip' && ['application/zip', 'application/x-zip-compressed', 'application/x-zip', 'application/octet-stream'].includes(file.mimetype);
  const textAllowed = ext === '.txt' && ['text/plain', 'application/octet-stream'].includes(file.mimetype);
  if (!(mimeAllowed && (file.mimetype !== 'application/octet-stream' || zipAllowed || textAllowed))) return cb(new Error('Tipo de arquivo não permitido.'));
  cb(null, true);
} });
app.post('/api/uploads', authMiddleware, (req, res, next) => upload.single('file')(req, res, async err => {
  if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Arquivo excede 10 MB.' : err.message });
  try {
    if (!req.file) return res.status(400).json({ error: 'Selecione um arquivo.' });
    const channelId = String(req.body.channelId || '');
    if (!channelAccess(readDB(), req.user.id, channelId)) {
      return res.status(403).json({ error: 'Você não tem acesso a este canal.' });
    }
    const ext = path.extname(req.file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10);
    const key = `files/${uuidv4()}${ext}`;
    const contentType = ext === '.zip' ? 'application/zip' : ext === '.txt' ? 'text/plain' : req.file.mimetype;
    const fileUrl = await objectStorage.put(req.file.buffer, key, contentType);
    res.status(201).json({ attachment: { name: path.basename(req.file.originalname).slice(0, 150), url: fileUrl, size: req.file.size, mimeType: contentType } });
  } catch (e) { next(e); }
}));

const voiceRooms = new Map();
io.use((socket, next) => {
  try {
    socket.user = jwt.verify(socket.handshake.auth?.token, JWT_SECRET, { issuer: 'hippo-conecta' });
    const currentUser = readDB().users.find(user => user.id === socket.user.id);
    if (!currentUser) return next(new Error('Conta não encontrada.'));
    socket.user.name = currentUser.name; socket.user.email = currentUser.email; socket.user.avatarUrl = currentUser.avatarUrl || null;
    next();
  } catch { next(new Error('Autenticação necessária.')); }
});

io.on('connection', socket => {
  socket.join(`user:${socket.user.id}`);
  const notifyFriendsPresence = () => { const data=readDB(); const ids=(data.friendships||[]).filter(f=>f.userA===socket.user.id||f.userB===socket.user.id).map(f=>f.userA===socket.user.id?f.userB:f.userA); const room=socket.currentRoom?data.servers.flatMap(server=>server.channels.map(c=>({...c,serverName:server.name}))).find(c=>c.id===socket.currentRoom):null; const presence={userId:socket.user.id,name:socket.user.name,avatarUrl:socket.user.avatarUrl||null,online:[...io.sockets.sockets.values()].some(s=>s.user?.id===socket.user.id),inCall:Boolean(socket.currentRoom),callChannel:room?.name||null,callServer:room?.serverName||null}; ids.forEach(id=>io.to(`user:${id}`).emit('friends:presence',presence)); };
  notifyFriendsPresence();
  const dbAtConnect = readDB();
  const memberServers = dbAtConnect.servers.filter(s => s.members.some(m => m.userId === socket.user.id));
  memberServers.forEach(s => {
    socket.join(`server:${s.id}`);
    s.channels.forEach(c => socket.join(c.id));
  });
  socket.on('server:subscribe', ({ serverId } = {}, ack) => {
    const current = readDB().servers.find(s => s.id === serverId && s.members.some(m => m.userId === socket.user.id));
    if (!current) return socketAck(ack, { ok: false, error: 'Servidor não encontrado ou acesso negado.' });
    socket.join(`server:${current.id}`);
    current.channels.forEach(channel => socket.join(channel.id));
    socketAck(ack, { ok: true });
  });
  console.info(`[socket] conectado user=${socket.user.id} socket=${socket.id}`);

  socket.on('chat:send', async (payload = {}, ack) => {
    try {
      const now = Date.now();
      socket.data.chatRate ||= { startedAt: now, count: 0 };
      if (now - socket.data.chatRate.startedAt > 10000) socket.data.chatRate = { startedAt: now, count: 0 };
      if (++socket.data.chatRate.count > 25) return socketAck(ack, { ok: false, error: 'Você está enviando mensagens rápido demais.' });
      const channelId = String(payload.channelId || '');
      const text = String(payload.text || '').trim().slice(0, 5000);
      const db = readDB();
      if (!channelAccess(db, socket.user.id, channelId)) return socketAck(ack, { ok: false, error: 'Acesso negado ao canal.' });
      const attachment = payload.attachment && typeof payload.attachment === 'object' ? payload.attachment : null;
      if (attachment && (!objectStorage.isPublicUrl(String(attachment.url || '')) || typeof attachment.name !== 'string')) return socketAck(ack, { ok: false, error: 'Anexo inválido.' });
      if (!text && !attachment) return socketAck(ack, { ok: false, error: 'Mensagem vazia.' });
      const message = { id: uuidv4(), authorId: socket.user.id, authorName: socket.user.name, authorAvatarUrl: socket.user.avatarUrl || null, text, attachment, replyTo: payload.replyTo || null, reactions: {}, timestamp: new Date().toISOString() };
      await updateDB(data => {
        if (!data.messages[channelId]) data.messages[channelId] = [];
        data.messages[channelId].push(message);
        if (data.messages[channelId].length > 2000) data.messages[channelId] = data.messages[channelId].slice(-2000);
      });
      io.to(channelId).emit('chat:message', { channelId, message });
      socketAck(ack, { ok: true, message });
    } catch (err) { console.error('[chat:send]', err); socketAck(ack, { ok: false, error: 'Não foi possível enviar a mensagem.' }); }
  });

  socket.on('chat:react', async ({ channelId, messageId, emoji } = {}, ack) => {
    try {
      if (typeof emoji !== 'string' || [...emoji].length > 8) return socketAck(ack, { ok: false, error: 'Reação inválida.' });
      let updated;
      await updateDB(db => {
        if (!channelAccess(db, socket.user.id, channelId)) throw new Error('Acesso negado.');
        const msg = (db.messages[channelId] || []).find(m => m.id === messageId);
        if (!msg) throw new Error('Mensagem não encontrada.');
        msg.reactions ||= {};
        msg.reactions[emoji] ||= [];
        const users = msg.reactions[emoji];
        const i = users.indexOf(socket.user.id);
        if (i >= 0) users.splice(i, 1); else users.push(socket.user.id);
        if (!users.length) delete msg.reactions[emoji];
        updated = msg;
      });
      io.to(channelId).emit('chat:updated', { channelId, message: updated });
      socketAck(ack, { ok: true });
    } catch (err) { socketAck(ack, { ok: false, error: err.message }); }
  });

  socket.on('chat:delete', async ({ channelId, messageId } = {}, ack) => {
    try {
      let deleted = false;
      await updateDB(db => {
        if (!channelAccess(db, socket.user.id, channelId)) throw new Error('Acesso negado.');
        const list = db.messages[channelId] || [];
        const target = list.find(m => m.id === messageId);
        if (!target || target.authorId !== socket.user.id) throw new Error('Você só pode excluir suas próprias mensagens.');
        db.messages[channelId] = list.filter(m => m.id !== messageId); deleted = true;
      });
      if (deleted) io.to(channelId).emit('chat:deleted', { channelId, messageId });
      socketAck(ack, { ok: true });
    } catch (err) { socketAck(ack, { ok: false, error: err.message }); }
  });


  socket.on('rtc:sfu-presence-join', async ({ roomId } = {}, ack) => {
    try {
      const id = String(roomId || '');
      const db = readDB();
      const allowed = db.servers.some(server => server.members.some(member => member.userId === socket.user.id) && server.channels.some(channel => channel.id === id && channel.type === 'voice'));
      if (!allowed) return socketAck(ack, { ok: false, error: 'Canal de voz não encontrado ou sem permissão.' });
      leaveVoiceRoom(socket);
      socket.currentRoom = id;
      await socket.join(id);
      notifyFriendsPresence();
      socketAck(ack, { ok: true });
    } catch (error) { socketAck(ack, { ok: false, error: 'Não foi possível atualizar presença da chamada.' }); }
  });
  socket.on('rtc:sfu-presence-leave', () => leaveVoiceRoom(socket));
  socket.on('rtc:join-room', async ({ roomId } = {}, ack) => {
    try {
      const id = String(roomId || '');
      const db = readDB();
      const canJoin = db.servers.some(s => s.members.some(m => m.userId === socket.user.id) && s.channels.some(c => c.id === id && c.type === 'voice'));
      if (!canJoin) return socketAck(ack, { ok: false, error: 'Canal de voz não encontrado ou sem permissão.' });
      if (socket.currentRoom === id) return socketAck(ack, { ok: true, alreadyJoined: true });
      leaveVoiceRoom(socket);
      const room = voiceRooms.get(id) || new Map();
      const peers = [...room.entries()].map(([socketId, info]) => ({ socketId, ...info }));
      room.set(socket.id, { userId: socket.user.id, name: socket.user.name, avatarUrl: socket.user.avatarUrl || null });
      voiceRooms.set(id, room);
      socket.currentRoom = id;
      await socket.join(id);
      notifyFriendsPresence();
      socket.emit('rtc:existing-peers', peers);
      socket.to(id).emit('rtc:peer-joined', { socketId: socket.id, userId: socket.user.id, name: socket.user.name, avatarUrl: socket.user.avatarUrl || null });
      socketAck(ack, { ok: true, peers });
    } catch (err) { console.error('[rtc:join-room]', err); socketAck(ack, { ok: false, error: 'Não foi possível entrar no canal de voz.' }); }
  });

  socket.on('rtc:signal', ({ to, signal } = {}, ack) => {
    const roomId = socket.currentRoom;
    const target = io.sockets.sockets.get(to);
    socket.data.rtcRate ||= { startedAt: Date.now(), count: 0 };
    if (Date.now() - socket.data.rtcRate.startedAt > 10000) socket.data.rtcRate = { startedAt: Date.now(), count: 0 };
    if (++socket.data.rtcRate.count > 120) return socketAck(ack, { ok: false, error: 'Muitas mensagens de sinalização. Aguarde.' });
    if (!roomId || !target || target.currentRoom !== roomId || !signal || !['offer', 'answer', 'candidate'].includes(signal.type)) return socketAck(ack, { ok: false, error: 'Sinalização inválida ou destino fora da chamada.' });
    if (signal.type === 'candidate') {
      const candidate = signal.candidate;
      if (!candidate || typeof candidate.candidate !== 'string' || candidate.candidate.length > 8192) return socketAck(ack, { ok: false, error: 'Candidato ICE inválido.' });
    } else if (!signal.sdp || typeof signal.sdp.sdp !== 'string' || signal.sdp.sdp.length > 100000) {
      return socketAck(ack, { ok: false, error: 'Descrição SDP inválida.' });
    }
    target.emit('rtc:signal', { from: socket.id, fromUserId: socket.user.id, fromName: socket.user.name, fromAvatarUrl: socket.user.avatarUrl || null, signal });
    socketAck(ack, { ok: true });
  });

  function leaveVoiceRoom(currentSocket) {
    const roomId = currentSocket.currentRoom;
    if (!roomId) return;
    const room = voiceRooms.get(roomId);
    if (room) {
      room.delete(currentSocket.id);
      if (room.size === 0) voiceRooms.delete(roomId);
    }
    currentSocket.to(roomId).emit('rtc:peer-left', { socketId: currentSocket.id });
    currentSocket.leave(roomId);
    currentSocket.currentRoom = null;
    notifyFriendsPresence();
  }
  socket.on('rtc:leave-room', () => leaveVoiceRoom(socket));
  socket.on('disconnect', reason => {
    leaveVoiceRoom(socket);
    setTimeout(notifyFriendsPresence, 0);
    console.info(`[socket] desconectado user=${socket.user.id} socket=${socket.id} reason=${reason}`);
  });
});

app.use((err, req, res, next) => {
  console.error(`[http] ${req.method} ${req.path}`, err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Erro interno do servidor.' });
});

if (require.main === module) {
  initDB().then(() => {
    server.listen(PORT, () => console.log(`Hippo Conecta disponível na porta ${PORT} (${IS_PROD ? 'produção' : 'desenvolvimento'})`));
  }).catch(err => {
    console.error('[db] Falha ao inicializar armazenamento:', err.message);
    process.exit(1);
  });
  const shutdown = () => io.close(async () => {
    try { await closeDB(); } finally { process.exit(0); }
  });
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
module.exports = { app, server, io };
