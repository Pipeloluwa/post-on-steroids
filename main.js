const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const url = require('url');
const { autoUpdater } = require('electron-updater');

/**
 * Reads local version metadata (buildTime, updateBaseUrl) generated during build.
 */
function readLocalVersionMeta() {
  const versionJsonCandidates = [
    path.join(__dirname, 'dist', 'post-on-steroids', 'browser', 'version.json'),
    path.join(__dirname, 'public', 'version.json')
  ];

  for (const candidate of versionJsonCandidates) {
    try {
      if (fs.existsSync(candidate)) {
        return JSON.parse(fs.readFileSync(candidate, 'utf8'));
      }
    } catch {
      // Ignore and try next candidate
    }
  }
  return null;
}

const LOCAL_VERSION_META = readLocalVersionMeta();

/**
 * Resolves updateBaseUrl from environment files (in source/dev) or packaged version.json (in app.asar).
 */
function resolveUpdateBaseUrl() {
  const isPackaged = app ? app.isPackaged : true;
  const envFileName = isPackaged ? 'environment.prod.ts' : 'environment.ts';
  const envFilePath = path.join(__dirname, 'src', 'environments', envFileName);

  try {
    if (fs.existsSync(envFilePath)) {
      const content = fs.readFileSync(envFilePath, 'utf8');
      const match = content.match(/updateBaseUrl\s*:\s*['"]([^'"]+)['"]/);
      if (match && match[1]) {
        return match[1].trim().replace(/\/+$/, '');
      }
    }
  } catch {
    // Ignore and try version.json fallback
  }

  if (LOCAL_VERSION_META) {
    const resolved = isPackaged
      ? LOCAL_VERSION_META.updateBaseUrl
      : (LOCAL_VERSION_META.devUpdateBaseUrl || LOCAL_VERSION_META.updateBaseUrl);
    if (resolved && typeof resolved === 'string') {
      return resolved.trim().replace(/\/+$/, '');
    }
  }

  return isPackaged ? 'https://onsteroid.com/download' : 'http://localhost:5000/download';
}

const UPDATE_BASE_URL = resolveUpdateBaseUrl();

// Allow self-signed / internal SSL certificates on test and staging environments
if (app && app.commandLine) {
  app.commandLine.appendSwitch('ignore-certificate-errors');
}

// Auto Updater Configuration
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.disableDifferentialDownload = true;
autoUpdater.verifyUpdateCodeSignature = () => Promise.resolve(null);

try {
  autoUpdater.setFeedURL({
    provider: 'generic',
    url: UPDATE_BASE_URL
  });
} catch {
  // Ignore if feed URL initialization is deferred until packaged check
}

let mainWindow;
let isUpdateDownloaded = false;
let isCheckingArchiveManifest = false;
let promptedArchiveKey = null;
let updateCheckInterval = null;
let lastUpdateCheckTime = 0;

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
    if (mainWindow && !mainWindow.isDestroyed()) {
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

  // Check for updates when user focuses the window (throttled to every 5 minutes)
  mainWindow.on('focus', () => {
    if (Date.now() - lastUpdateCheckTime > 5 * 60 * 1000) {
      checkForElectronUpdates();
    }
  });

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

function showDialogBox(options) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return dialog.showMessageBox(mainWindow, options);
  }
  return dialog.showMessageBox(options);
}

function isNewerVersion(remoteVer, currentVer) {
  const r = String(remoteVer || '')
    .trim()
    .replace(/^v/i, '')
    .split(/[.-]/)
    .map((part) => Number(part) || 0);
  const c = String(currentVer || '')
    .trim()
    .replace(/^v/i, '')
    .split(/[.-]/)
    .map((part) => Number(part) || 0);

  for (let i = 0; i < Math.max(r.length, c.length); i++) {
    const rv = r[i] || 0;
    const cv = c[i] || 0;
    if (rv > cv) return true;
    if (rv < cv) return false;
  }
  return false;
}

function isNewerReleaseDate(remoteReleaseDateStr) {
  if (!remoteReleaseDateStr || !LOCAL_VERSION_META || typeof LOCAL_VERSION_META.buildTime !== 'number') {
    return false;
  }
  const remoteTime = Date.parse(remoteReleaseDateStr);
  if (Number.isNaN(remoteTime)) {
    return false;
  }
  // Treat as a newer setup build if the manifest releaseDate is at least 60 seconds newer than local buildTime
  return remoteTime > LOCAL_VERSION_META.buildTime + 60 * 1000;
}

function fetchUrlText(targetUrl, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error('Too many redirects'));
      return;
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(targetUrl);
    } catch (err) {
      reject(err);
      return;
    }

    const client = parsedUrl.protocol === 'http:' ? http : https;
    const req = client.get(
      parsedUrl,
      {
        rejectUnauthorized: false,
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache'
        },
        timeout: 15000
      },
      (res) => {
        if (
          res.statusCode &&
          [301, 302, 303, 307, 308].includes(res.statusCode) &&
          res.headers.location
        ) {
          const nextUrl = new URL(res.headers.location, parsedUrl).toString();
          res.resume();
          fetchUrlText(nextUrl, redirectCount + 1).then(resolve).catch(reject);
          return;
        }

        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => resolve(raw));
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error('Request timed out'));
    });
    req.on('error', reject);
  });
}

function fetchUrlHead(targetUrl, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error('Too many redirects'));
      return;
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(targetUrl);
    } catch (err) {
      reject(err);
      return;
    }

    const client = parsedUrl.protocol === 'http:' ? http : https;
    const req = client.request(
      parsedUrl,
      {
        method: 'HEAD',
        rejectUnauthorized: false,
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache'
        },
        timeout: 15000
      },
      (res) => {
        res.resume();
        if (
          res.statusCode &&
          [301, 302, 303, 307, 308].includes(res.statusCode) &&
          res.headers.location
        ) {
          const nextUrl = new URL(res.headers.location, parsedUrl).toString();
          fetchUrlHead(nextUrl, redirectCount + 1).then(resolve).catch(reject);
          return;
        }

        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        resolve(res.headers || {});
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error('Request timed out'));
    });
    req.on('error', reject);
    req.end();
  });
}

function checkInstallerHeadFallback() {
  const defaultInstaller =
    process.platform === 'linux'
      ? 'OnSteroid-linux-x64.tar.gz'
      : process.platform === 'darwin'
        ? 'OnSteroid.dmg'
        : 'OnSteroid-Setup.exe';

  const installerUrl = `${UPDATE_BASE_URL}/${defaultInstaller}`;

  return fetchUrlHead(`${installerUrl}?_t=${Date.now()}`).then((headers) => {
    const lastModified = headers['last-modified'];
    const etag = headers['etag'] || '';
    const contentType = headers['content-type'] || '';

    // Ignore HTML fallback responses (e.g., SPA index.html rewrites)
    if (/text\/html/i.test(contentType)) {
      return;
    }

    if (lastModified && isNewerReleaseDate(lastModified)) {
      const archiveKey = `head:${etag || lastModified}`;
      if (promptedArchiveKey !== archiveKey) {
        promptedArchiveKey = archiveKey;
        showDialogBox({
          type: 'info',
          buttons: ['Download Update', 'Later'],
          defaultId: 0,
          cancelId: 1,
          title: 'Update Available',
          message: 'A new OnSteroid desktop build is available.',
          detail: 'Download the latest setup package for your platform to update.'
        }).then(({ response }) => {
          if (response === 0) {
            shell.openExternal(installerUrl);
          }
        });
      }
    }
  });
}

function checkArchiveManifestUpdate() {
  if (isUpdateDownloaded || isCheckingArchiveManifest) {
    return;
  }

  isCheckingArchiveManifest = true;

  const manifestFile =
    process.platform === 'linux'
      ? 'latest-linux.yml'
      : process.platform === 'darwin'
        ? 'latest-mac.yml'
        : 'latest.yml';

  const manifestUrl = `${UPDATE_BASE_URL}/${manifestFile}?_t=${Date.now()}`;

  fetchUrlText(manifestUrl)
    .then((raw) => {
      const verMatch = raw.match(/^version:\s*['"]?([^\s'"]+)['"]?/m);
      const pathMatch = raw.match(/^path:\s*['"]?([^\r\n'"]+)['"]?/m);
      const dateMatch = raw.match(/^releaseDate:\s*['"]?([^\r\n'"]+)['"]?/m);
      const shaMatch = raw.match(/^sha512:\s*['"]?([^\s'"]+)['"]?/m);

      const remoteVersion = verMatch ? verMatch[1].trim() : null;
      const packageFile = pathMatch ? pathMatch[1].trim() : null;
      const remoteReleaseDate = dateMatch ? dateMatch[1].trim() : null;
      const remoteSha = shaMatch ? shaMatch[1].trim() : '';

      const currentVersion = app.getVersion();
      const hasNewerSemver = remoteVersion && isNewerVersion(remoteVersion, currentVersion);
      const hasNewerBuildTimestamp =
        remoteVersion === currentVersion && isNewerReleaseDate(remoteReleaseDate);

      const archiveKey = `${remoteVersion || ''}:${remoteSha || remoteReleaseDate || ''}`;

      if (
        remoteVersion &&
        packageFile &&
        promptedArchiveKey !== archiveKey &&
        (hasNewerSemver || hasNewerBuildTimestamp)
      ) {
        promptedArchiveKey = archiveKey;
        showDialogBox({
          type: 'info',
          buttons: ['Download Update', 'Later'],
          defaultId: 0,
          cancelId: 1,
          title: 'Update Available',
          message: `A new OnSteroid update (v${remoteVersion}) is available.`,
          detail: 'Download the latest setup package for your platform to update.'
        }).then(({ response }) => {
          if (response === 0) {
            const downloadUrl = /^https?:\/\//i.test(packageFile)
              ? packageFile
              : `${UPDATE_BASE_URL}/${packageFile.replace(/^\/+/, '')}`;
            shell.openExternal(downloadUrl);
          }
        });
      }
    })
    .catch(() => {
      // If latest.yml returned 404 (e.g., not uploaded or blocked by IIS MIME rules), check installer Last-Modified header
      return checkInstallerHeadFallback().catch(() => {});
    })
    .finally(() => {
      isCheckingArchiveManifest = false;
    });
}

function checkForElectronUpdates() {
  if (isUpdateDownloaded) {
    return;
  }

  lastUpdateCheckTime = Date.now();

  // Unpacked builds or Linux tar.gz/zip builds (non-AppImage) cannot use Squirrel/NSIS differential updater directly
  if (!app.isPackaged || (process.platform === 'linux' && !process.env.APPIMAGE)) {
    checkArchiveManifestUpdate();
    return;
  }

  autoUpdater
    .checkForUpdates()
    .then((result) => {
      // If electron-updater did not start a download (e.g., portable build or same version string with newer build timestamp), check manifest
      if (!result || !result.downloadPromise) {
        checkArchiveManifestUpdate();
        return;
      }
      result.downloadPromise.catch(() => {
        checkArchiveManifestUpdate();
      });
    })
    .catch(() => {
      // Fallback for portable/archive builds across Windows, macOS, and Linux
      checkArchiveManifestUpdate();
    });
}

app.on('ready', () => {
  createWindow();

  // Check for updates shortly after app starts
  setTimeout(() => {
    checkForElectronUpdates();
  }, 3000);

  // Periodically check for updates every 30 minutes while app remains open
  updateCheckInterval = setInterval(() => {
    checkForElectronUpdates();
  }, 30 * 60 * 1000);
});

// AutoUpdater events for prompting the user and handling errors
autoUpdater.on('error', () => {
  checkArchiveManifestUpdate();
});

autoUpdater.on('update-downloaded', (info) => {
  isUpdateDownloaded = true;
  if (updateCheckInterval) {
    clearInterval(updateCheckInterval);
    updateCheckInterval = null;
  }

  const versionLabel = info && info.version ? ` (v${info.version})` : '';
  const dialogOpts = {
    type: 'info',
    buttons: ['Restart Now', 'Later'],
    defaultId: 0,
    cancelId: 1,
    title: 'Update Ready',
    message: `The latest update${versionLabel} has been downloaded.`,
    detail: 'Restart the application to apply the update.'
  };

  showDialogBox(dialogOpts).then((returnValue) => {
    if (returnValue.response === 0) {
      autoUpdater.quitAndInstall(false, true);
    }
  });
});

app.on('window-all-closed', function () {
  if (updateCheckInterval) {
    clearInterval(updateCheckInterval);
    updateCheckInterval = null;
  }
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', function () {
  if (mainWindow === null) createWindow();
});
