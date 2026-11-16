const { app, BrowserWindow, shell, session } = require('electron');

const APP_URL = 'https://hippo-conecta.onrender.com';
const APP_ORIGIN = new URL(APP_URL).origin;
let win;

function configureMediaPermissions() {
  const allowedPermissions = new Set(['media', 'display-capture', 'notifications']);
  const isTrustedApp = (origin) => {
    try { return new URL(origin).origin === APP_ORIGIN; } catch { return false; }
  };

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    let requestOrigin = '';
    try { requestOrigin = new URL(webContents.getURL()).origin; } catch {}
    callback(isTrustedApp(requestOrigin) && allowedPermissions.has(permission));
  });

  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    return isTrustedApp(requestingOrigin || webContents?.getURL()) && allowedPermissions.has(permission);
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 620,
    show: false,
    title: 'HIPPO CONECTA',
    backgroundColor: '#080808',
    icon: __dirname + '/../public/icons/favicon.ico',
    autoHideMenuBar: true,
    webPreferences: {
      preload: __dirname + '/preload.js',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url);
      if (target.protocol === 'https:' && target.origin !== APP_ORIGIN) shell.openExternal(target.href);
    } catch {}
    return { action: 'deny' };
  });

  win.once('ready-to-show', () => win.show());
  win.loadURL(APP_URL);
  win.on('closed', () => { win = null; });
}

app.whenReady().then(() => {
  app.setAppUserModelId('br.com.hippoconecta.desktop');
  configureMediaPermissions();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
