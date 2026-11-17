const FriendManager = {
  state: { friends: [], incoming: [], outgoing: [] },
  timer: null,
  async open() { document.getElementById('friends-modal')?.classList.remove('hidden'); await this.refresh(); },
  close() { document.getElementById('friends-modal')?.classList.add('hidden'); },
  async refresh() {
    try { this.state = await API.get('/api/friends'); this.render(); }
    catch (e) { UI.toast(e.message, 'error'); }
  },
  async search(value) {
    clearTimeout(this.timer);
    const q = String(value || '').trim();
    const box = document.getElementById('friend-search-results');
    if (q.length < 2) { box.innerHTML = ''; return; }
    this.timer = setTimeout(async () => {
      try {
        const data = await API.get('/api/users/search?q=' + encodeURIComponent(q));
        box.innerHTML = data.users.length ? data.users.map(u => `
          <div class="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[.03] p-3">
            <div class="min-w-0"><strong class="block truncate text-sm text-white">${UI.escapeHTML(u.name)}</strong><small class="text-slate-400">${UI.escapeHTML(u.email)}</small></div>
            <button onclick="FriendManager.send('${UI.escapeHTML(u.id)}')" class="rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold text-white">Adicionar</button>
          </div>`).join('') : '<p class="text-xs text-slate-500">Nenhuma pessoa encontrada.</p>';
      } catch (e) { UI.toast(e.message, 'error'); }
    }, 250);
  },
  async send(userId) {
    try { const result = await API.post('/api/friends/request', { userId }); UI.toast(result.accepted ? 'Amizade aceita!' : 'Solicitação enviada.'); document.getElementById('friend-search-results').innerHTML = ''; await this.refresh(); }
    catch (e) { UI.toast(e.message, 'error'); }
  },
  async accept(requestId) {
    try { await API.post('/api/friends/accept', { requestId }); UI.toast('Amizade adicionada.'); await this.refresh(); }
    catch (e) { UI.toast(e.message, 'error'); }
  },
  async decline(requestId) {
    try { await API.request('/api/friends/request/' + encodeURIComponent(requestId), { method: 'DELETE' }); await this.refresh(); }
    catch (e) { UI.toast(e.message, 'error'); }
  },
  async remove(userId) {
    if (!confirm('Remover esta pessoa dos amigos?')) return;
    try { await API.request('/api/friends/' + encodeURIComponent(userId), { method: 'DELETE' }); await this.refresh(); }
    catch (e) { UI.toast(e.message, 'error'); }
  },
  render() {
    const req = document.getElementById('friend-requests'), list = document.getElementById('friend-list');
    const badge = document.getElementById('friends-badge');
    if (badge) badge.textContent = this.state.incoming.length ? '(' + this.state.incoming.length + ')' : '';
    req.innerHTML = this.state.incoming.length ? this.state.incoming.map(r => `
      <div class="flex items-center justify-between gap-2 rounded-xl border border-white/10 p-3"><strong class="text-white">${UI.escapeHTML(r.user.name)}</strong><div class="flex gap-2"><button onclick="FriendManager.accept('${UI.escapeHTML(r.id)}')" class="rounded-lg bg-violet-600 px-3 py-1.5 text-xs text-white">Aceitar</button><button onclick="FriendManager.decline('${UI.escapeHTML(r.id)}')" class="rounded-lg bg-white/10 px-3 py-1.5 text-xs text-slate-200">Recusar</button></div></div>`).join('') : '<p>Nenhuma solicitação recebida.</p>';
    list.innerHTML = this.state.friends.length ? this.state.friends.map(f => `
      <div class="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[.03] p-3">
        <div class="min-w-0"><div class="flex items-center gap-2"><i class="h-2 w-2 rounded-full ${f.online ? 'bg-emerald-400' : 'bg-slate-600'}"></i><strong class="truncate text-sm text-white">${UI.escapeHTML(f.name)}</strong></div>
        <small class="${f.inCall ? 'text-violet-300' : 'text-slate-400'}">${f.inCall ? 'Em chamada' + (f.callChannel ? ' • ' + UI.escapeHTML(f.callChannel) : '') + (f.callServer ? ' — ' + UI.escapeHTML(f.callServer) : '') : f.online ? 'Online' : 'Offline'}</small></div>
        <button onclick="FriendManager.remove('${UI.escapeHTML(f.id)}')" class="text-xs text-slate-500 hover:text-rose-300">Remover</button>
      </div>`).join('') : '<p>Você ainda não adicionou amigos.</p>';
  },
  presence(data) {
    const friend = this.state.friends.find(f => f.id === data.userId);
    if (friend) Object.assign(friend, data);
    this.render();
  }
};
window.addEventListener('DOMContentLoaded', () => {
  API.socket?.on('friends:changed', () => FriendManager.refresh());
  API.socket?.on('friends:presence', data => FriendManager.presence(data));
});
