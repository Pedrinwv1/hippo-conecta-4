const { app, BrowserWindow, shell, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

let server;
let win;
const port = 0;

function configureMediaPermissions() {
  const allowedPermissions = new Set(['media', 'display-capture', 'notifications']);
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    let requestOrigin = '';
    try { requestOrigin = new URL(webContents.getURL()).origin; } catch {}
    const isLocalApp = /^http:\/\/127\.0\.0\.1:\d+$/.test(requestOrigin);
    callback(isLocalApp && allowedPermissions.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    return /^http:\/\/127\.0\.0\.1:\d+$/.test(requestingOrigin || '') && allowedPermissions.has(permission);
  });

}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 620,
    backgroundColor: '#06070a',
    icon: path.join(__dirname, '../public/icons/favicon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.loadURL(`http://127.0.0.1:${server.address().port}`);
  win.on('closed', () => { win = null; });
}

app.whenReady().then(() => {
  const dataDir = app.getPath('userData');
  fs.mkdirSync(dataDir, { recursive: true });
  process.env.DB_PATH ||= path.join(dataDir, 'data.json');
  process.env.UPLOAD_DIR ||= path.join(dataDir, 'uploads');
  process.env.JWT_SECRET ||= crypto.randomBytes(48).toString('hex');
  process.env.NODE_ENV = app.isPackaged ? 'production' : 'development';
  process.env.HIPPO_DESKTOP = '1';
  configureMediaPermissions();
  ({ server } = require('../server'));
  server.listen(port, '127.0.0.1', createWindow);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => {
  if (server?.listening) server.close();
});
