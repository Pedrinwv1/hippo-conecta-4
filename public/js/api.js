const API = {
  baseUrl: (window.HIPPO_API_BASE || window.location.origin).replace(/\/$/, ''),
  endpoint(url) { return /^https?:\/\//i.test(url) ? url : `${this.baseUrl}${url.startsWith('/') ? '' : '/'}${url}`; },
  token: localStorage.getItem('hipo_token') || null,
  socket: null,
  setToken(token) {
    this.token = token;
    if (token) localStorage.setItem('hipo_token', token);
    else localStorage.removeItem('hipo_token');
  },
  async request(url, options = {}) {
    const headers = new Headers(options.headers || {});
    if (this.token) headers.set('Authorization', `Bearer ${this.token}`);
    if (options.body && !(options.body instanceof FormData)) headers.set('Content-Type', 'application/json');
    const response = await fetch(this.endpoint(url), { ...options, headers });
    const type = response.headers.get('content-type') || '';
    const data = type.includes('application/json') ? await response.json() : await response.text();
    if (!response.ok) throw new Error(data.error || 'Erro na requisição.');
    return data;
  },
  get(url) { return this.request(url); },
  post(url, body) { return this.request(url, { method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body) }); },
  patch(url, body) { return this.request(url, { method: 'PATCH', body: JSON.stringify(body) }); },
  connectSocket() {
    if (this.socket) this.socket.disconnect();
    this.socket = io(this.baseUrl, { auth: { token: this.token }, reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 800, reconnectionDelayMax: 8000 });
    this.socket.on('connect', () => {
      const el = document.getElementById('conn-status');
      if (el) { el.textContent = 'Conectado'; el.className = 'text-[10px] text-emerald-400 truncate'; }
      if (WebRTCManager.currentRoomId) this.socket.emit('rtc:join-room', { roomId: WebRTCManager.currentRoomId });
    });
    this.socket.on('disconnect', reason => {
      WebRTCManager.resetPeersForReconnect();
      const el = document.getElementById('conn-status');
      if (el) { el.textContent = 'Reconectando…'; el.className = 'text-[10px] text-amber-400 truncate'; }
      if (reason !== 'io client disconnect') UI.toast('Conexão perdida. Tentando reconectar…', 'error');
    });
    this.socket.on('connect_error', err => console.warn('[socket] connect_error:', err.message));
    this.socket.on('chat:message', ({ channelId, message }) => App.onIncomingMessage(channelId, message));
    this.socket.on('chat:updated', ({ channelId, message }) => App.onUpdatedMessage(channelId, message));
    this.socket.on('chat:deleted', ({ channelId, messageId }) => App.onDeletedMessage(channelId, messageId));
    this.socket.on('server:created', srv => {
      if (!App.state.servers.some(s => s.id === srv.id)) { App.state.servers.push(srv); App.renderServerRail(); }
    });
    this.socket.on('rtc:existing-peers', peers => peers.forEach(p => WebRTCManager.createPeerConnection(p.socketId, p.name, p.avatarUrl, p.userId)));
    this.socket.on('rtc:peer-joined', p => UI.toast(`${p.name} entrou na chamada`));
    this.socket.on('rtc:signal', data => WebRTCManager.handleSignal(data).catch(err => console.error('[webrtc] signal:', err)));
    this.socket.on('rtc:peer-left', ({ socketId }) => { WebRTCManager.removeRemoteTile(socketId); UI.toast('Um participante saiu da chamada'); });
    this.socket.on('server:member-joined', data => console.info('[server] novo membro', data.user?.name));
    this.socket.on('profile:updated', user => {
      if (App.state.user?.id === user.id) Settings.applyUser(user);
      WebRTCManager.updatePeerProfile?.(user);
      App.state.servers.forEach(server => server.members?.forEach(member => { if (member.userId === user.id) { member.name = user.name; member.avatarUrl = user.avatarUrl; } }));
      Object.values(App.state.messages || {}).forEach(list => list.forEach(message => { if (message.authorId === user.id) { message.authorName = user.name; message.authorAvatarUrl = user.avatarUrl; } }));
      if (App.activeServerId) App.selectServer(App.activeServerId);
      if (App.activeChannelId) Chat.render();
    });
  }
};
