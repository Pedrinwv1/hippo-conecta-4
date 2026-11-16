const Auth = {
  async init() {
    if (!API.token) { this.showAuth(); return; }
    try {
      const data = await API.get('/api/bootstrap');
      this.enterApp(data);
    } catch {
      API.setToken(null);
      this.showAuth();
    }
  },

  showAuth() {
    document.getElementById('auth-screen').classList.remove('hidden');
    document.getElementById('app-shell').classList.add('hidden');
  },

  switchMode(mode) {
    document.getElementById('form-login').classList.toggle('hidden', mode !== 'login');
    document.getElementById('form-register').classList.toggle('hidden', mode !== 'register');
    document.getElementById('tab-login').className = mode === 'login' ? 'py-2 text-xs font-semibold rounded-lg bg-purple-600 text-white shadow' : 'py-2 text-xs font-semibold rounded-lg text-slate-400';
    document.getElementById('tab-register').className = mode === 'register' ? 'py-2 text-xs font-semibold rounded-lg bg-purple-600 text-white shadow' : 'py-2 text-xs font-semibold rounded-lg text-slate-400';
  },

  async handleLogin(e) {
    e.preventDefault();
    try {
      const res = await API.post('/api/auth/login', { email: document.getElementById('login-email').value, password: document.getElementById('login-password').value });
      API.setToken(res.token);
      this.enterApp(await API.get('/api/bootstrap'));
    } catch (err) {
      const el = document.getElementById('auth-error');
      el.textContent = err.message; el.classList.remove('hidden');
    }
  },

  async handleRegister(e) {
    e.preventDefault();
    try {
      const res = await API.post('/api/auth/register', { name: document.getElementById('reg-name').value, email: document.getElementById('reg-email').value, password: document.getElementById('reg-password').value });
      API.setToken(res.token);
      this.enterApp(await API.get('/api/bootstrap'));
    } catch (err) {
      const el = document.getElementById('reg-error');
      el.textContent = err.message; el.classList.remove('hidden');
    }
  },



  enterApp(data) {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('app-shell').classList.remove('hidden');
    App.state.user = data.user;
    document.getElementById('user-dock-name').textContent = data.user.name;
    UI.setAvatar('user-dock-initials', data.user, 'w-8 h-8 rounded-lg');
    document.getElementById('rtc-local-name').textContent = data.user.name;
    UI.setAvatar('rtc-local-initials', data.user, 'w-14 h-14 rounded-full');
    API.connectSocket();
    App.init(data);
    Settings?.applyPreferences(data.user.preferences || {});
  },

  logout() {
    WebRTCManager.leaveRoom(true);
    API.setToken(null);
    if (API.socket) API.socket.disconnect();
    this.showAuth();
  }
};