const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const url = require('url');
const { autoUpdater } = require('electron-updater');

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

app.on('ready', () => {
  createWindow();
  
  // Check for updates shortly after app starts
  setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify().catch(err => {
      console.error('Failed to check for updates:', err);
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
