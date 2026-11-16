const Chat = {
  replyingTo: null,
  bindEvents() {
    const container = document.getElementById('messages-container');
    if (container && !container.dataset.bound) {
      container.dataset.bound = '1';
      container.addEventListener('click', event => {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        const { action, messageId, emoji } = button.dataset;
        if (action === 'reply') this.reply(messageId);
        if (action === 'delete') this.deleteMsg(messageId);
        if (action === 'react') this.react(messageId, emoji);
      });
    }
  },
  escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },
  render() {
    const container = document.getElementById('messages-container');
    if (!container) return;
    this.bindEvents();
    const msgs = App.state.messages[App.activeChannelId] || [];
    if (!msgs.length) {
      container.innerHTML = '<div class="h-full flex items-center justify-center text-xs text-slate-500">Nenhuma mensagem neste canal.</div>';
      return;
    }
    container.innerHTML = msgs.map(m => {
      const mine = m.authorId === App.state.user.id;
      const authorAvatar = m.authorAvatarUrl || (mine ? App.state.user.avatarUrl : null);
      const time = new Date(m.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      const reply = m.replyTo ? msgs.find(item => item.id === m.replyTo) : null;
      const safeAttachmentUrl = m.attachment && (/^\/uploads\/(?:avatars|files)\/[a-f0-9-]+(?:\.[a-z0-9]{1,10})?$/i.test(m.attachment.url || '') || /^https:\/\/fnxddxknngfuqvzawlni\.supabase\.co\/storage\/v1\/object\/public\/hippo-media\/files\/[a-f0-9-]+(?:\.[a-z0-9]{1,10})?$/i.test(m.attachment.url || '')) ? m.attachment.url : null;
      const attachment = m.attachment && safeAttachmentUrl ? `<a href="${this.escapeHTML(safeAttachmentUrl)}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-2 mt-2 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-purple-300 hover:bg-purple-500/10">📎 ${this.escapeHTML(m.attachment.name)} <span class="text-slate-500">(${Math.ceil((m.attachment.size || 0) / 1024)} KB)</span></a>` : '';
      const reactions = Object.entries(m.reactions || {}).map(([emoji, users]) => `<button data-action="react" data-message-id="${this.escapeHTML(m.id)}" data-emoji="${this.escapeHTML(emoji)}" class="px-2 py-1 rounded-lg border ${users.includes(App.state.user.id) ? 'border-purple-400 bg-purple-500/20' : 'border-white/10 bg-white/5'} text-xs">${this.escapeHTML(emoji)} ${users.length}</button>`).join('');
      return `<article class="group flex items-start gap-3 p-2 rounded-xl hover:bg-white/[0.025]" data-message-id="${this.escapeHTML(m.id)}">
        <div class="w-9 h-9 rounded-xl overflow-hidden bg-purple-600/30 text-purple-300 font-bold text-xs flex items-center justify-center shrink-0">${UI.safeAvatar(authorAvatar) ? `<img src="${this.escapeHTML(UI.safeAvatar(authorAvatar))}" alt="" class="w-full h-full object-cover">` : this.escapeHTML((m.authorName || '?').slice(0, 2).toUpperCase())}</div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2"><span class="text-sm font-semibold text-white">${this.escapeHTML(m.authorName)}</span><time class="text-[11px] text-slate-500">${time}</time></div>
          ${reply ? `<div class="mt-1 pl-2 border-l-2 border-purple-500/50 text-[11px] text-slate-400">Respondendo a ${this.escapeHTML(reply.authorName)}: ${this.escapeHTML(reply.text || '[anexo]').slice(0, 120)}</div>` : ''}
          ${m.text ? `<p class="text-sm text-slate-200 mt-0.5 whitespace-pre-wrap break-words">${this.escapeHTML(m.text)}</p>` : ''}${attachment}
          <div class="flex flex-wrap items-center gap-1 mt-2">${reactions}<button data-action="react" data-message-id="${this.escapeHTML(m.id)}" data-emoji="👍" class="opacity-0 group-hover:opacity-100 px-2 py-1 rounded-lg bg-white/5 text-xs text-slate-400 hover:text-white" title="Reagir">＋👍</button>
            <button data-action="reply" data-message-id="${this.escapeHTML(m.id)}" class="opacity-0 group-hover:opacity-100 text-[11px] text-slate-400 hover:text-purple-300">Responder</button>
            ${mine ? `<button data-action="delete" data-message-id="${this.escapeHTML(m.id)}" class="opacity-0 group-hover:opacity-100 text-[11px] text-rose-400">Excluir</button>` : ''}
          </div>
        </div>
      </article>`;
    }).join('');
    container.scrollTop = container.scrollHeight;
  },
  send(e) {
    e.preventDefault();
    const input = document.getElementById('message-input');
    const text = input.value.trim();
    if (!text || !API.socket?.connected) return;
    API.socket.emit('chat:send', { channelId: App.activeChannelId, text, replyTo: this.replyingTo }, result => {
      if (!result?.ok) UI.toast(result?.error || 'Não foi possível enviar.', 'error');
    });
    input.value = '';
    this.cancelReply();
  },
  async uploadFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { UI.toast('O limite por arquivo é 10 MB.', 'error'); e.target.value = ''; return; }
    try {
      const form = new FormData(); form.append('file', file); form.append('channelId', App.activeChannelId);
      const result = await API.post('/api/uploads', form);
      API.socket.emit('chat:send', { channelId: App.activeChannelId, attachment: result.attachment, replyTo: this.replyingTo }, ack => {
        if (!ack?.ok) UI.toast(ack?.error || 'Não foi possível enviar o anexo.', 'error');
      });
      this.cancelReply();
    } catch (err) { UI.toast(err.message, 'error'); }
    finally { e.target.value = ''; }
  },
  reply(messageId) {
    const messages = App.state.messages[App.activeChannelId] || [];
    const target = messages.find(m => m.id === messageId);
    if (!target) return;
    this.replyingTo = messageId;
    document.getElementById('reply-target-user').textContent = target.authorName;
    document.getElementById('reply-banner').classList.remove('hidden');
    document.getElementById('message-input').focus();
  },
  react(messageId, emoji) {
    API.socket.emit('chat:react', { channelId: App.activeChannelId, messageId, emoji }, result => {
      if (!result?.ok) UI.toast(result?.error || 'Não foi possível reagir.', 'error');
    });
  },
  deleteMsg(messageId) {
    API.socket.emit('chat:delete', { channelId: App.activeChannelId, messageId }, result => {
      if (!result?.ok) UI.toast(result?.error || 'Não foi possível excluir.', 'error');
    });
  },
  cancelReply() {
    this.replyingTo = null;
    document.getElementById('reply-banner')?.classList.add('hidden');
  }
};
