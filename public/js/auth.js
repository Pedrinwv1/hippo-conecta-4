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
    const error = document.getElementById('reg-error');
    error.classList.add('hidden');
    try {
      const res = await API.post('/api/auth/register', {
        name: document.getElementById('reg-name').value,
        email: document.getElementById('reg-email').value,
        password: document.getElementById('reg-password').value
      });
      document.getElementById('reg-identity-fields').classList.add('hidden');
      document.getElementById('reg-verification').classList.remove('hidden');
      document.getElementById('reg-verification-email').textContent = res.email;
      document.getElementById('reg-code').focus();
      document.getElementById('reg-submit').classList.add('hidden');
      document.getElementById('reg-verify-submit').classList.remove('hidden');
      error.textContent = res.message || 'Código enviado. Confira sua caixa de entrada e o spam.';
      error.classList.remove('hidden');
      error.classList.remove('text-rose-400'); error.classList.add('text-emerald-400');
    } catch (err) {
      error.textContent = err.message; error.classList.remove('hidden');
      error.classList.remove('text-emerald-400'); error.classList.add('text-rose-400');
    }
  },

  async verifyRegistration(e) {
    e.preventDefault();
    const error = document.getElementById('reg-error');
    error.classList.add('hidden');
    try {
      const res = await API.post('/api/auth/verify-email', {
        email: document.getElementById('reg-email').value,
        code: document.getElementById('reg-code').value
      });
      API.setToken(res.token);
      this.enterApp(await API.get('/api/bootstrap'));
    } catch (err) {
      error.textContent = err.message; error.classList.remove('hidden');
      error.classList.remove('text-emerald-400'); error.classList.add('text-rose-400');
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