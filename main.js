import { environment } from './src/environments/environment'
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const https = require('https');
const path = require('path');
const url = require('url');
const { autoUpdater } = require('electron-updater');

const UPDATE_BASE_URL = environment.updateBaseUrl;

// Auto Updater Configuration
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'OnSteroid',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      height: 48,
      color: '#2d2d2d',
      symbolColor: '#ffffff'
    },
    icon: path.join(__dirname, 'dist/post-on-steroids/browser/icons/onsteroids-icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      preload: path.join(__dirname, 'preload.js')
    },
  });

  ipcMain.on('theme-changed', (event, theme) => {
    if (mainWindow) {
      mainWindow.setTitleBarOverlay({
        color: theme === 'light' ? '#f5f5f5' : '#2d2d2d',
        symbolColor: theme === 'light' ? '#000000' : '#ffffff'
      });
    }
  });

  mainWindow.setMenuBarVisibility(false);

  mainWindow.loadURL(
    url.format({
      pathname: path.join(__dirname, 'dist/post-on-steroids/browser/index.csr.html'),
      protocol: 'file:',
      slashes: true,
    }),
  );

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

function isNewerVersion(remoteVer, currentVer) {
  const r = String(remoteVer || '').trim().split('.').map(Number);
  const c = String(currentVer || '').trim().split('.').map(Number);
  for (let i = 0; i < Math.max(r.length, c.length); i++) {
    const rv = r[i] || 0;
    const cv = c[i] || 0;
    if (rv > cv) return true;
    if (rv < cv) return false;
  }
  return false;
}

function checkArchiveManifestUpdate() {
  const manifestFile =
    process.platform === 'linux'
      ? 'latest-linux.yml'
      : process.platform === 'darwin'
        ? 'latest-mac.yml'
        : 'latest.yml';

  https
    .get(`${UPDATE_BASE_URL}/${manifestFile}`, (res) => {
      if (res.statusCode !== 200) return;
      let raw = '';
      res.on('data', (chunk) => (raw += chunk));
      res.on('end', () => {
        const verMatch = raw.match(/^version:\s*['"]?([^\s'"]+)['"]?/m);
        const pathMatch = raw.match(/^path:\s*['"]?([^\r\n'"]+)['"]?/m);
        const remoteVersion = verMatch ? verMatch[1] : null;
        const packageFile = pathMatch ? pathMatch[1].trim() : null;

        if (remoteVersion && isNewerVersion(remoteVersion, app.getVersion()) && packageFile) {
          dialog
            .showMessageBox({
              type: 'info',
              buttons: ['Download Update', 'Later'],
              title: 'Update Available',
              message: `OnSteroid v${remoteVersion} is available.`,
              detail: 'Download the latest package for your platform from onsteroid.com.'
            })
            .then(({ response }) => {
              if (response === 0) {
                shell.openExternal(`${UPDATE_BASE_URL}/${packageFile}`);
              }
            });
        }
      });
    })
    .on('error', () => {});
}

app.on('ready', () => {
  createWindow();

  // Check for updates shortly after app starts
  setTimeout(() => {
    // Linux tar.gz/zip builds do not run inside an AppImage container, so use manifest check directly
    if (process.platform === 'linux' && !process.env.APPIMAGE) {
      checkArchiveManifestUpdate();
      return;
    }

    autoUpdater.checkForUpdatesAndNotify().catch(() => {
      // Fallback for portable/archive builds across Windows, macOS, and Linux
      checkArchiveManifestUpdate();
    });
  }, 3000);
});

// AutoUpdater events for prompting the user
autoUpdater.on('update-downloaded', (info) => {
  const dialogOpts = {
    type: 'info',
    buttons: ['Restart Now', 'Later'],
    title: 'Update Ready',
    message: 'The update has been successfully downloaded.',
    detail: 'Restart the application to apply the update.'
  };

  dialog.showMessageBox(dialogOpts).then((returnValue) => {
    if (returnValue.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', function () {
  if (mainWindow === null) createWindow();
});
