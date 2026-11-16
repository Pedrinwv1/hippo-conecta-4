const UI = {
  escapeHTML(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); },
  openModal(id) { document.getElementById(id)?.classList.remove('hidden'); },
  safeAvatar(url) { return typeof url === 'string' && (/^\/uploads\/(?:avatars\/)?avatar-[a-z0-9-]+\.(jpg|png|gif|webp)$/i.test(url) || /^https:\/\/fnxddxknngfuqvzawlni\.supabase\.co\/storage\/v1\/object\/public\/hippo-media\/avatars\/avatar-[a-z0-9-]+\.(jpg|png|gif|webp)$/i.test(url)) ? url : ''; },
  setAvatar(id, user, classes = '') { const el = document.getElementById(id); if (!el) return; const url = this.safeAvatar(user?.avatarUrl); el.className = `${classes} overflow-hidden flex items-center justify-center bg-purple-600/30 text-purple-200 font-bold text-xs shrink-0`; el.innerHTML = url ? `<img src="${this.escapeHTML(url)}" alt="Foto de ${this.escapeHTML(user?.name || 'usuário')}" class="w-full h-full object-cover">` : this.escapeHTML((user?.name || '?').slice(0, 2).toUpperCase()); },
  closeModals() { if (typeof Settings !== 'undefined') { Settings.stopCameraPreview(); Settings.stopMicTest(); } document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.add('hidden')); },
  toast(msg, type = 'info') {
    const box = document.getElementById('toast-container');
    if (!box) return;
    const el = document.createElement('div');
    el.className = `px-4 py-2.5 rounded-xl text-xs font-medium border backdrop-blur-md shadow-xl ${type === 'error' ? 'bg-rose-950/90 border-rose-500/40 text-rose-200' : 'bg-[#12151f]/95 border-purple-500/40 text-slate-100'}`;
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }
};

const App = {
  state: { user: null, servers: [], messages: {} },
  activeServerId: null,
  activeChannelId: null,

  init(data) {
    this.state = data;
    this.renderServerRail();
    if (data.servers.length > 0) this.selectServer(data.servers[0].id);
  },

  renderServerRail() {
    document.getElementById('server-list').innerHTML = this.state.servers.map(s => `
      <button onclick="App.selectServer('${UI.escapeHTML(s.id)}')" title="${UI.escapeHTML(s.name)}"
        class="w-12 h-12 rounded-2xl ${this.activeServerId === s.id ? 'bg-purple-600 text-white neon-border-active' : 'bg-[#12151f] text-slate-300 hover:bg-purple-600/30'} font-bold text-xs flex items-center justify-center transition">
        ${UI.escapeHTML(s.icon)}
      </button>
    `).join('');
  },

  selectServer(serverId) {
    this.activeServerId = serverId;
    this.renderServerRail();
    const srv = this.state.servers.find(s => s.id === serverId);
    if (!srv) return;

    document.getElementById('sidebar-title').textContent = srv.name;
    document.getElementById('sidebar-subtitle').textContent = `Convite: ${srv.inviteCode}`;

    const textCh = srv.channels.filter(c => c.type === 'text');
    const voiceCh = srv.channels.filter(c => c.type === 'voice');

    document.getElementById('channel-list-container').innerHTML = `
      <div>
        <p class="px-2 text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Canais de Texto</p>
        ${textCh.map(c => `
          <button onclick="App.selectChannel('${UI.escapeHTML(c.id)}')"
            class="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs ${this.activeChannelId === c.id ? 'bg-purple-600/25 text-white border border-purple-500/30' : 'text-slate-400 hover:bg-white/5'}">
            <span class="font-mono text-purple-400">#</span> ${UI.escapeHTML(c.name)}
          </button>
        `).join('')}
      </div>
      <div class="mt-4">
        <p class="px-2 text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">Canais de Voz</p>
        ${voiceCh.map(v => `
          <button onclick="WebRTCManager.joinRoom('${UI.escapeHTML(v.id)}')"
            class="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-slate-300 hover:bg-emerald-500/15 hover:text-emerald-300 transition">
            <svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 10v4h4l5 4V6l-5 4H4Z"/><path d="M16 9a5 5 0 0 1 0 6M18.5 6.5a8.5 8.5 0 0 1 0 11"/></svg> ${UI.escapeHTML(v.name)}
          </button>
        `).join('')}
      </div>
    `;

    document.getElementById('members-list').innerHTML = srv.members.map(m => `
      <div class="flex items-center gap-2 p-1.5 rounded-lg bg-white/[0.02]">
        <div class="w-8 h-8 rounded-full overflow-hidden bg-purple-600/30 text-purple-200 flex items-center justify-center text-[10px] font-bold shrink-0">${UI.safeAvatar(m.avatarUrl) ? `<img src="${UI.escapeHTML(m.avatarUrl)}" class="w-full h-full object-cover" alt="">` : UI.escapeHTML((m.name || '?').slice(0,2).toUpperCase())}</div>
        <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
        <div class="min-w-0"><p class="text-xs font-medium text-white truncate">${UI.escapeHTML(m.name)}</p><p class="text-[10px] text-slate-500">${UI.escapeHTML(m.role)}</p></div>
      </div>
    `).join('');

    if (textCh.length > 0) this.selectChannel(textCh[0].id);
  },

  selectChannel(id) {
    const server = this.state.servers.find(s => s.id === this.activeServerId);
    const channel = server?.channels.find(c => c.id === id);
    if (!channel) return;
    this.activeChannelId = id;
    document.getElementById('active-channel-name').textContent = '#' + channel.name;
    document.getElementById('active-channel-topic').textContent = channel.topic || '';
    Chat.render();
  },

  startVideoCall() {
    const server = this.state.servers.find(s => s.id === this.activeServerId);
    const voice = server?.channels.find(c => c.type === 'voice');
    if (!voice) return UI.toast('Este servidor ainda não possui canal de voz.', 'error');
    WebRTCManager.joinRoom(voice.id, voice.name, true);
  },

  async createServer(e) {
    e.preventDefault();
    const name = document.getElementById('new-server-name').value.trim();
    const icon = document.getElementById('new-server-icon').value;
    try {
      const srv = await API.post('/api/servers', { name, icon });
      if (!this.state.servers.some(item => item.id === srv.id)) this.state.servers.push(srv);
      API.socket?.emit('server:subscribe', { serverId: srv.id });
      UI.closeModals(); this.selectServer(srv.id); UI.toast('Servidor criado com sucesso.');
    } catch (err) { UI.toast(err.message, 'error'); }
  },

  async joinServer(e) {
    e.preventDefault();
    try {
      const code = document.getElementById('invite-code-input').value.trim().toUpperCase();
      const srv = await API.post('/api/servers/join', { code });
      if (!this.state.servers.some(s => s.id === srv.id)) this.state.servers.push(srv);
      API.socket?.emit('server:subscribe', { serverId: srv.id });
      UI.closeModals();
      this.selectServer(srv.id);
    } catch (err) { UI.toast(err.message, 'error'); }
  },

  onIncomingMessage(chId, msg) {
    if (!this.state.messages[chId]) this.state.messages[chId] = [];
    this.state.messages[chId].push(msg);
    if (this.activeChannelId === chId) Chat.render();
  },
  onUpdatedMessage(chId, msg) {
    const list = this.state.messages[chId] || [];
    const idx = list.findIndex(m => m.id === msg.id);
    if (idx !== -1) list[idx] = msg;
    if (this.activeChannelId === chId) Chat.render();
  },
  onDeletedMessage(chId, msgId) {
    this.state.messages[chId] = (this.state.messages[chId] || []).filter(m => m.id !== msgId);
    if (this.activeChannelId === chId) Chat.render();
  }
};

window.addEventListener('DOMContentLoaded', () => {
  Chat.bindEvents();
  Auth.init();
  document.addEventListener('keydown', event => {
    const tag = event.target?.tagName?.toLowerCase();
    if (['input', 'textarea', 'select'].includes(tag) || event.target?.isContentEditable) return;
    if (event.key.toLowerCase() === 'm' && WebRTCManager.currentRoomId) WebRTCManager.toggleMic();
    if (event.key.toLowerCase() === 'f' && WebRTCManager.currentRoomId) {
      const stage = document.getElementById('webrtc-stage');
      if (!document.fullscreenElement) stage.requestFullscreen?.(); else document.exitFullscreen?.();
    }
    if (event.key === 'Escape') UI.closeModals();
  });
});