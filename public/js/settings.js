const Settings = {
  cameraPreviewStream: null,
  micTestStream: null,
  currentTab: 'profile',
  open() {
    if (!App.state.user) return;
    const user = App.state.user;
    document.getElementById('settings-name').value = user.name || '';
    document.getElementById('settings-account-name').value = user.name || '';
    document.getElementById('settings-email').value = user.email || '';
    document.getElementById('settings-profile-name').textContent = user.name || 'Seu nome';
    UI.setAvatar('settings-avatar-preview', user, 'settings-avatar');
    const prefs = user.preferences || {};
    document.getElementById('settings-theme').value = prefs.theme || 'obsidian';
    document.getElementById('settings-density').value = prefs.density || 'comfortable';
    document.getElementById('settings-notifications').checked = prefs.notifications !== false;
    UI.openModal('modal-settings');
    this.selectTab(this.currentTab);
    this.loadDevices().catch(err => this.deviceStatus(`Não foi possível listar dispositivos: ${err.message}`));
  },
  close() {
    this.stopCameraPreview();
    this.stopMicTest();
    document.getElementById('modal-settings')?.classList.add('hidden');
  },
  selectTab(tab) {
    this.currentTab = tab;
    document.querySelectorAll('[data-settings-tab]').forEach(button => button.classList.toggle('active', button.dataset.settingsTab === tab));
    document.querySelectorAll('[data-settings-panel]').forEach(panel => panel.classList.toggle('hidden', panel.dataset.settingsPanel !== tab));
    if (tab !== 'devices') this.stopCameraPreview();
  },
  deviceStatus(message) {
    const el = document.getElementById('settings-device-status');
    if (el) el.textContent = message;
  },
  async saveProfile(event) {
    event?.preventDefault();
    const activePanel = document.querySelector('[data-settings-panel]:not(.hidden)')?.dataset.settingsPanel;
    const name = (activePanel === 'profile' ? document.getElementById('settings-name').value : document.getElementById('settings-account-name').value).trim();
    const email = document.getElementById('settings-email').value.trim() || App.state.user.email;
    try {
      const result = await API.patch('/api/profile', { name, email });
      this.applyUser(result.user);
      UI.toast('Dados da conta atualizados.');
    } catch (err) { UI.toast(err.message, 'error'); }
  },
  async uploadAvatar(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) { UI.toast('Escolha uma imagem JPG, PNG, WEBP ou GIF.', 'error'); event.target.value = ''; return; }
    if (file.size > 4 * 1024 * 1024) { UI.toast('A imagem deve ter no máximo 4 MB.', 'error'); event.target.value = ''; return; }
    try {
      const form = new FormData(); form.append('avatar', file);
      const result = await API.post('/api/profile/avatar', form);
      this.applyUser(result.user);
      UI.toast('Foto de perfil atualizada.');
    } catch (err) { UI.toast(err.message, 'error'); }
    finally { event.target.value = ''; }
  },
  async removeAvatar() {
    try {
      const result = await API.request('/api/profile/avatar', { method: 'DELETE' });
      this.applyUser(result.user);
      UI.toast('Foto de perfil removida.');
    } catch (err) { UI.toast(err.message, 'error'); }
  },
  applyUser(user) {
    if (!user) return;
    App.state.user = { ...App.state.user, ...user };
    const profile = App.state.user;
    document.getElementById('user-dock-name').textContent = profile.name;
    UI.setAvatar('user-dock-initials', profile, 'w-8 h-8 rounded-lg');
    UI.setAvatar('rtc-local-initials', profile, 'w-14 h-14 rounded-full');
    UI.setAvatar('settings-avatar-preview', profile, 'settings-avatar');
    document.getElementById('settings-profile-name').textContent = profile.name;
    document.getElementById('settings-name').value = profile.name;
    document.getElementById('settings-account-name').value = profile.name;
    document.getElementById('settings-email').value = profile.email || '';
    App.state.servers.forEach(server => server.members?.forEach(member => {
      if (member.userId === profile.id) { member.name = profile.name; member.avatarUrl = profile.avatarUrl; }
    }));
    if (App.activeServerId) App.selectServer(App.activeServerId);
    if (App.activeChannelId) Chat.render();
    document.querySelectorAll('#video-grid .rtc-local-avatar').forEach(el => {
      el.innerHTML = UI.safeAvatar(user.avatarUrl) ? `<img src="${UI.escapeHTML(user.avatarUrl)}" class="w-full h-full object-cover" alt="">` : UI.escapeHTML((user.name || '?').slice(0, 2).toUpperCase());
    });
  },
  async savePreferences() {
    const preferences = {
      theme: document.getElementById('settings-theme').value,
      density: document.getElementById('settings-density').value,
      notifications: document.getElementById('settings-notifications').checked
    };
    try {
      const result = await API.patch('/api/profile', { preferences });
      this.applyPreferences(result.user.preferences);
      App.state.user = { ...App.state.user, ...result.user };
      UI.toast('Preferências salvas.');
    } catch (err) { UI.toast(err.message, 'error'); }
  },
  applyPreferences(prefs = {}) {
    const theme = ['obsidian', 'midnight', 'light'].includes(prefs.theme) ? prefs.theme : 'obsidian';
    const density = ['comfortable', 'compact'].includes(prefs.density) ? prefs.density : 'comfortable';
    document.body.dataset.theme = theme;
    document.body.dataset.density = density;
    const themeSelect = document.getElementById('settings-theme');
    const densitySelect = document.getElementById('settings-density');
    const notifications = document.getElementById('settings-notifications');
    if (themeSelect) themeSelect.value = theme;
    if (densitySelect) densitySelect.value = density;
    if (notifications) notifications.checked = prefs.notifications !== false;
  },
  async loadDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) throw new Error('Este navegador não oferece acesso aos dispositivos de mídia.');
    let devices = await navigator.mediaDevices.enumerateDevices();
    if (devices.some(device => !device.label)) {
      try {
        const permission = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        permission.getTracks().forEach(track => track.stop());
        devices = await navigator.mediaDevices.enumerateDevices();
      } catch { /* Permissão pode ser concedida ao iniciar a prévia. */ }
    }
    const fill = (id, kind, fallback) => {
      const select = document.getElementById(id);
      const list = devices.filter(device => device.kind === kind);
      const saved = localStorage.getItem(`hippo_${id}`);
      select.innerHTML = list.map((device, index) => `<option value="${UI.escapeHTML(device.deviceId)}">${UI.escapeHTML(device.label || `${fallback} ${index + 1}`)}</option>`).join('') || `<option value="">Nenhum dispositivo encontrado</option>`;
      if (saved && list.some(device => device.deviceId === saved)) select.value = saved;
      select.onchange = () => { localStorage.setItem(`hippo_${id}`, select.value); this.applyDeviceSelection(id, select.value).catch(err => this.deviceStatus(err.message)); };
    };
    fill('settings-mic', 'audioinput', 'Microfone');
    fill('settings-camera', 'videoinput', 'Câmera');
    fill('settings-output', 'audiooutput', 'Saída de áudio');
    this.deviceStatus(`${devices.length} dispositivo(s) detectado(s).`);
  },
  async applyDeviceSelection(id, deviceId) {
    if (!deviceId) return;
    if (id === 'settings-mic' && WebRTCManager.currentRoomId) await WebRTCManager.switchMicrophone(deviceId);
    if (id === 'settings-camera' && WebRTCManager.currentRoomId) await WebRTCManager.switchCamera(deviceId);
    if (id === 'settings-output') {
      const sinkCapable = typeof HTMLMediaElement.prototype.setSinkId === 'function';
      if (!sinkCapable) return this.deviceStatus('Este navegador não permite selecionar a saída de áudio.');
      document.querySelectorAll('#video-grid audio, #video-grid video').forEach(media => media.setSinkId(deviceId).catch(console.warn));
      this.deviceStatus('Saída de áudio selecionada para os elementos de mídia disponíveis.');
    }
  },
  async startCameraPreview() {
    try {
      this.stopCameraPreview();
      const deviceId = document.getElementById('settings-camera').value;
      this.cameraPreviewStream = await navigator.mediaDevices.getUserMedia({ video: deviceId ? { deviceId: { exact: deviceId } } : true, audio: false });
      const video = document.getElementById('settings-camera-preview');
      video.srcObject = this.cameraPreviewStream;
      await video.play();
      this.deviceStatus('Pré-visualização da câmera ativa.');
    } catch (err) { this.deviceStatus(`Não foi possível acessar a câmera: ${err.message}`); }
  },
  stopCameraPreview() {
    this.cameraPreviewStream?.getTracks().forEach(track => track.stop());
    this.cameraPreviewStream = null;
    const video = document.getElementById('settings-camera-preview');
    if (video) video.srcObject = null;
  },
  async testMicrophone() {
    try {
      this.stopMicTest();
      const deviceId = document.getElementById('settings-mic').value;
      this.micTestStream = await navigator.mediaDevices.getUserMedia({ audio: deviceId ? { deviceId: { exact: deviceId } } : true, video: false });
      const context = new (window.AudioContext || window.webkitAudioContext)();
      const source = context.createMediaStreamSource(this.micTestStream);
      const analyser = context.createAnalyser(); analyser.fftSize = 256; source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      this.deviceStatus('Microfone ativo. Fale para verificar o nível de áudio (teste de 5 segundos).');
      const started = Date.now();
      const poll = () => {
        analyser.getByteFrequencyData(data);
        const level = Math.round(data.reduce((sum, value) => sum + value, 0) / data.length);
        this.deviceStatus(`Microfone ativo • nível de áudio: ${level}/255`);
        if (Date.now() - started < 5000 && this.micTestStream) this.micTestFrame = requestAnimationFrame(poll);
        else { source.disconnect(); context.close().catch(() => {}); this.stopMicTest(); this.deviceStatus('Teste de microfone concluído.'); }
      };
      poll();
    } catch (err) { this.deviceStatus(`Não foi possível acessar o microfone: ${err.message}`); }
  },
  stopMicTest() {
    if (this.micTestFrame) cancelAnimationFrame(this.micTestFrame);
    this.micTestFrame = null;
    this.micTestStream?.getTracks().forEach(track => track.stop());
    this.micTestStream = null;
  },
  async requestNotifications() {
    await Notifications.requestPermission();
  },
  async changePassword(event) {
    event.preventDefault();
    const currentPassword = document.getElementById('settings-current-password').value;
    const newPassword = document.getElementById('settings-new-password').value;
    const confirm = document.getElementById('settings-confirm-password').value;
    if (newPassword !== confirm) return UI.toast('A confirmação da nova senha não confere.', 'error');
    try {
      const result = await API.post('/api/account/password', { currentPassword, newPassword });
      event.target.reset(); UI.toast(result.message || 'Senha alterada.');
    } catch (err) { UI.toast(err.message, 'error'); }
  }
};
