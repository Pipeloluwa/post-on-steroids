const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const url = require('url');

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

app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  event.preventDefault();
  callback(true);
});

let mainWindow;
let isUpdateDownloaded = false;
let isCheckingOrDownloadingUpdate = false;
let promptedArchiveKey = null;
let updateCheckInterval = null;
let lastUpdateCheckTime = 0;
let pendingWhatsNewForRenderer = null;

/**
 * Reads and persists installed update & launch metadata in userData so that once a specific
 * package (version + buildTime/sha512/releaseDate) is installed, the update modal never loops
 * and What's New automatically opens once after an upgrade completes.
 */
function getUserDataMetaPath(fileName) {
  try {
    return path.join(app.getPath('userData'), fileName);
  } catch {
    return path.join(__dirname, fileName);
  }
}

function readJsonMeta(fileName) {
  try {
    const metaPath = getUserDataMetaPath(fileName);
    if (fs.existsSync(metaPath)) {
      return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    }
  } catch {
    // Ignore read errors
  }
  return null;
}

function writeJsonMeta(fileName, meta) {
  try {
    const metaPath = getUserDataMetaPath(fileName);
    const dir = path.dirname(metaPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf8');
  } catch {
    // Ignore write errors
  }
}

function readInstalledUpdateMeta() {
  return readJsonMeta('installed-update-meta.json');
}

function writeInstalledUpdateMeta(meta) {
  writeJsonMeta('installed-update-meta.json', meta);
}

function readLastLaunchedMeta() {
  return readJsonMeta('last-launched-meta.json');
}

function writeLastLaunchedMeta(meta) {
  writeJsonMeta('last-launched-meta.json', meta);
}

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

function normalizeVersion(ver) {
  return String(ver || '')
    .trim()
    .replace(/^v/i, '')
    .replace(/-.*$/, '');
}

function isNewerVersion(remoteVer, currentVer) {
  const r = normalizeVersion(remoteVer)
    .split(/[.-]/)
    .map((part) => Number(part) || 0);
  const c = normalizeVersion(currentVer)
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

/**
 * Detects whether a newer version or build just replaced a previous installation
 * (via App Updater or Web Page installer) so What's New opens once on startup.
 */
function evaluatePostUpdateWhatsNew() {
  const currentVersion = normalizeVersion(app.getVersion());
  const localBuildTime =
    LOCAL_VERSION_META && typeof LOCAL_VERSION_META.buildTime === 'number'
      ? LOCAL_VERSION_META.buildTime
      : 0;

  const installedMeta = readInstalledUpdateMeta();
  const lastLaunched = readLastLaunchedMeta();
  let triggeredPayload = null;

  if (installedMeta && installedMeta.pendingWhatsNew) {
    const p = installedMeta.pendingWhatsNew;
    const versionChanged = p.fromVersion && currentVersion !== normalizeVersion(p.fromVersion);
    const buildChanged = localBuildTime && p.fromBuildTime && Number(localBuildTime) !== Number(p.fromBuildTime);
    if (versionChanged || buildChanged || isNewerVersion(currentVersion, p.fromVersion || '')) {
      triggeredPayload = {
        version: currentVersion,
        buildTime: localBuildTime,
        source: 'updater'
      };
      const cleaned = { ...installedMeta };
      delete cleaned.pendingWhatsNew;
      cleaned.version = currentVersion;
      if (localBuildTime) cleaned.buildTime = localBuildTime;
      writeInstalledUpdateMeta(cleaned);
    }
  }

  if (!triggeredPayload && lastLaunched && lastLaunched.version) {
    const prevVer = normalizeVersion(lastLaunched.version);
    const prevBuild = Number(lastLaunched.buildTime || 0);
    if (
      isNewerVersion(currentVersion, prevVer) ||
      (currentVersion === prevVer && localBuildTime > 0 && prevBuild > 0 && localBuildTime > prevBuild)
    ) {
      triggeredPayload = {
        version: currentVersion,
        buildTime: localBuildTime,
        source: 'installer'
      };
    }
  }

  // Whenever an installer from the web page upgraded localBuildTime, ensure stale old sha/releaseDate
  // doesn't trigger a false prompt against itself, and keep last-launched state current.
  writeLastLaunchedMeta({
    version: currentVersion,
    buildTime: localBuildTime,
    updatedAt: Date.now()
  });

  pendingWhatsNewForRenderer = triggeredPayload;
}

/**
 * Determines whether the remote manifest represents a genuinely newer build than the running app.
 * Prevents false-positive update loops after installing from either the app updater or web page.
 */
function isUpdateRequired(remoteVersion, remoteReleaseDateStr, remoteSha, remoteBuildTime = 0) {
  if (!remoteVersion) {
    return false;
  }

  const currentVersion = app.getVersion();
  const normRemote = normalizeVersion(remoteVersion);
  const normCurrent = normalizeVersion(currentVersion);
  const installedMeta = readInstalledUpdateMeta();
  const localBuildTime =
    LOCAL_VERSION_META && typeof LOCAL_VERSION_META.buildTime === 'number'
      ? LOCAL_VERSION_META.buildTime
      : 0;

  // 1. If remote semver is strictly newer than current app version, update is required
  if (isNewerVersion(normRemote, normCurrent)) {
    return true;
  }

  // 2. If remote semver is older than current app version, no update is required
  if (normRemote !== normCurrent) {
    return false;
  }

  // 3. Exact buildTime comparison (covers both Web Page setup installs and App Updater installs)
  const parsedRemoteBuildTime = Number(remoteBuildTime || 0);
  if (parsedRemoteBuildTime > 0 && localBuildTime > 0) {
    if (parsedRemoteBuildTime <= localBuildTime) {
      if (remoteSha || remoteReleaseDateStr) {
        const cleaned = installedMeta ? { ...installedMeta } : {};
        delete cleaned.pendingWhatsNew;
        writeInstalledUpdateMeta({
          ...cleaned,
          version: normCurrent,
          sha512: remoteSha || cleaned.sha512 || '',
          releaseDate: String(remoteReleaseDateStr || cleaned.releaseDate || ''),
          buildTime: localBuildTime,
          installedAt: cleaned.installedAt || Date.now()
        });
      }
      return false;
    }
  }

  // 4. Same semver version: if we already installed/recorded this exact SHA-512, releaseDate, or buildTime, never re-prompt!
  if (installedMeta && normalizeVersion(installedMeta.version) === normCurrent) {
    if (remoteSha && installedMeta.sha512 && installedMeta.sha512.trim() === remoteSha.trim()) {
      return false;
    }
    if (
      remoteReleaseDateStr &&
      installedMeta.releaseDate &&
      String(installedMeta.releaseDate).trim() === String(remoteReleaseDateStr).trim()
    ) {
      return false;
    }
    if (parsedRemoteBuildTime > 0 && installedMeta.buildTime && parsedRemoteBuildTime <= Number(installedMeta.buildTime)) {
      return false;
    }
  }

  if (!remoteReleaseDateStr || !localBuildTime) {
    return false;
  }

  const remoteTime =
    typeof remoteReleaseDateStr === 'number'
      ? remoteReleaseDateStr
      : Date.parse(remoteReleaseDateStr);

  if (Number.isNaN(remoteTime)) {
    return false;
  }

  // Allow a generous build window buffer between prebuild (generate-version.mjs) and electron-builder completion
  // so that installing the latest build from the web page never triggers a self-update prompt on itself.
  const BUILD_WINDOW_TOLERANCE_MS = 15 * 60 * 1000;
  if (remoteTime <= localBuildTime + BUILD_WINDOW_TOLERANCE_MS) {
    if (remoteSha || remoteReleaseDateStr) {
      const cleaned = installedMeta ? { ...installedMeta } : {};
      delete cleaned.pendingWhatsNew;
      writeInstalledUpdateMeta({
        ...cleaned,
        version: normCurrent,
        sha512: remoteSha || '',
        releaseDate: String(remoteReleaseDateStr || ''),
        buildTime: localBuildTime,
        installedAt: Date.now()
      });
    }
    return false;
  }

  return true;
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

/**
 * Verifies if an already-downloaded file on disk matches the expected SHA-512 hash.
 */
function verifyFileSha512(filePath, expectedSha512) {
  return new Promise((resolve) => {
    if (!fs.existsSync(filePath)) {
      resolve(false);
      return;
    }
    if (!expectedSha512) {
      resolve(true);
      return;
    }
    const hash = crypto.createHash('sha512');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => {
      const computed = hash.digest('base64');
      resolve(computed.trim() === expectedSha512.trim());
    });
    stream.on('error', () => resolve(false));
  });
}

/**
 * Downloads the installer binary under the hood into the OS temp folder,
 * updates the window taskbar progress bar, and verifies SHA-512 integrity.
 */
function downloadFileUnderTheHood(targetUrl, destPath, expectedSha512, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error('Too many redirects while downloading update'));
      return;
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(targetUrl);
    } catch (err) {
      reject(err);
      return;
    }

    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const partPath = `${destPath}.part`;
    try {
      if (fs.existsSync(partPath)) {
        fs.unlinkSync(partPath);
      }
    } catch {
      // Ignore cleanup error
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
        timeout: 60000
      },
      (res) => {
        if (
          res.statusCode &&
          [301, 302, 303, 307, 308].includes(res.statusCode) &&
          res.headers.location
        ) {
          const nextUrl = new URL(res.headers.location, parsedUrl).toString();
          res.resume();
          downloadFileUnderTheHood(nextUrl, destPath, expectedSha512, redirectCount + 1)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode} when downloading update`));
          return;
        }

        const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
        let receivedBytes = 0;
        const hash = crypto.createHash('sha512');
        const fileStream = fs.createWriteStream(partPath);

        res.on('data', (chunk) => {
          receivedBytes += chunk.length;
          hash.update(chunk);
          if (totalBytes > 0 && mainWindow && !mainWindow.isDestroyed()) {
            const progress = Math.min(0.99, Math.max(0.02, receivedBytes / totalBytes));
            mainWindow.setProgressBar(progress);
          }
        });

        res.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close(() => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.setProgressBar(-1);
            }

            if (expectedSha512) {
              const computedSha = hash.digest('base64');
              if (computedSha.trim() !== expectedSha512.trim()) {
                try {
                  fs.unlinkSync(partPath);
                } catch {}
                reject(new Error('Downloaded update SHA-512 mismatch'));
                return;
              }
            }

            try {
              if (fs.existsSync(destPath)) {
                fs.unlinkSync(destPath);
              }
              fs.renameSync(partPath, destPath);
              resolve(destPath);
            } catch (err) {
              reject(err);
            }
          });
        });

        fileStream.on('error', (err) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.setProgressBar(-1);
          }
          try {
            fs.unlinkSync(partPath);
          } catch {}
          reject(err);
        });
      }
    );

    req.on('timeout', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setProgressBar(-1);
      }
      req.destroy(new Error('Update download timed out'));
    });

    req.on('error', (err) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setProgressBar(-1);
      }
      try {
        if (fs.existsSync(partPath)) {
          fs.unlinkSync(partPath);
        }
      } catch {}
      reject(err);
    });
  });
}

/**
 * Launches the downloaded installer directly to overwrite the existing app without opening any browser.
 */
function launchDownloadedInstaller(filePath, remoteVersion, remoteReleaseDate, remoteSha, remoteBuildTime = 0) {
  const localBuildTime =
    LOCAL_VERSION_META && typeof LOCAL_VERSION_META.buildTime === 'number'
      ? LOCAL_VERSION_META.buildTime
      : 0;
  const currentVersion = normalizeVersion(app.getVersion());

  writeInstalledUpdateMeta({
    version: normalizeVersion(remoteVersion),
    sha512: remoteSha || '',
    releaseDate: String(remoteReleaseDate || ''),
    buildTime: Number(remoteBuildTime || 0) || 0,
    previousBuildTime: localBuildTime,
    installedAt: Date.now(),
    pendingWhatsNew: {
      fromVersion: currentVersion,
      fromBuildTime: localBuildTime,
      targetVersion: normalizeVersion(remoteVersion),
      targetBuildTime: Number(remoteBuildTime || 0) || 0,
      requestedAt: Date.now()
    }
  });

  if (updateCheckInterval) {
    clearInterval(updateCheckInterval);
    updateCheckInterval = null;
  }

  if (process.platform === 'win32' && /\.exe$/i.test(filePath)) {
    try {
      const child = spawn(filePath, [], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false
      });
      child.unref();
      setTimeout(() => {
        app.quit();
      }, 300);
      return;
    } catch {
      // Fallback to shell.openPath below if spawn fails
    }
  }

  shell.openPath(filePath).then(() => {
    setTimeout(() => {
      app.quit();
    }, 500);
  });
}

/**
 * Downloads the update package silently under the hood, then prompts the user
 * to launch the installer modal and overwrite the existing app.
 */
async function handleManifestUpdate(remoteVersion, packageFile, remoteReleaseDate, remoteSha, remoteBuildTime = 0) {
  if (!remoteVersion || !packageFile) {
    return;
  }

  if (!isUpdateRequired(remoteVersion, remoteReleaseDate, remoteSha, remoteBuildTime)) {
    return;
  }

  const archiveKey = `${remoteVersion}:${remoteSha || remoteReleaseDate || remoteBuildTime || ''}`;
  if (promptedArchiveKey === archiveKey) {
    return;
  }

  const baseDownloadUrl = /^https?:\/\//i.test(packageFile)
    ? packageFile
    : `${UPDATE_BASE_URL}/${packageFile.replace(/^\/+/, '')}`;

  // Append cache-busting query parameters so CDNs/proxies never return a stale installer binary
  const separator = baseDownloadUrl.includes('?') ? '&' : '?';
  const downloadUrl = `${baseDownloadUrl}${separator}_v=${encodeURIComponent(remoteVersion)}&_t=${Date.now()}`;

  const ext = path.extname(packageFile) || (process.platform === 'win32' ? '.exe' : '');
  const baseName = path.basename(packageFile, ext).replace(/[^a-zA-Z0-9._-]/g, '_');
  const shortTag = (remoteSha || String(remoteReleaseDate || '') || 'latest')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 10);
  const targetFileName = `${baseName}-v${normalizeVersion(remoteVersion)}-${shortTag}${ext}`;
  const updatesDir = path.join(app.getPath('temp'), 'onsteroid-updates');
  const destPath = path.join(updatesDir, targetFileName);

  // Check if we already downloaded and verified this exact installer file in temp
  const alreadyValid = await verifyFileSha512(destPath, remoteSha);
  const finalPath = alreadyValid
    ? destPath
    : await downloadFileUnderTheHood(downloadUrl, destPath, remoteSha);

  isUpdateDownloaded = true;
  promptedArchiveKey = archiveKey;

  if (updateCheckInterval) {
    clearInterval(updateCheckInterval);
    updateCheckInterval = null;
  }

  const { response } = await showDialogBox({
    type: 'info',
    buttons: ['Install & Update Now', 'Later'],
    defaultId: 0,
    cancelId: 1,
    title: 'Update Ready to Install',
    message: `A new OnSteroid update (v${remoteVersion}) has been downloaded.`,
    detail: 'Click "Install & Update Now" to launch the setup installer and overwrite the existing app.'
  });

  if (response === 0) {
    launchDownloadedInstaller(finalPath, remoteVersion, remoteReleaseDate, remoteSha, remoteBuildTime);
  }
}

function checkLatestJsonFallback() {
  const jsonUrl = `${UPDATE_BASE_URL}/latest.json?_t=${Date.now()}`;
  return fetchUrlText(jsonUrl).then((raw) => {
    const data = JSON.parse(raw);
    if (!data || !data.version) return;
    const platformEntry = data.platforms && data.platforms[process.platform];
    if (!platformEntry || !platformEntry.path) return;

    const platformReleaseDate =
      platformEntry.releaseDate || platformEntry.buildTime || data.buildTime || data.releaseDate;
    const platformBuildTime = Number(platformEntry.buildTime || data.buildTime || 0) || 0;

    return handleManifestUpdate(
      String(data.version).trim(),
      String(platformEntry.path).trim(),
      platformReleaseDate,
      platformEntry.sha512 || '',
      platformBuildTime
    );
  });
}

function parseManifestYaml(raw) {
  const verMatch = raw.match(/^version:\s*['"]?([^\s'"]+)['"]?/m);
  const pathMatch = raw.match(/^path:\s*['"]?([^\r\n'"]+)['"]?/m);
  const dateMatch = raw.match(/^releaseDate:\s*['"]?([^\r\n'"]+)['"]?/m);
  const shaMatch = raw.match(/^sha512:\s*['"]?([^\s'"]+)['"]?/m);
  const buildTimeMatch = raw.match(/^buildTime:\s*['"]?(\d+)['"]?/m);

  const remoteVersion = verMatch ? verMatch[1].trim() : null;
  let packageFile = pathMatch ? pathMatch[1].trim() : null;
  const remoteReleaseDate = dateMatch ? dateMatch[1].trim() : null;
  let remoteSha = shaMatch ? shaMatch[1].trim() : '';
  const remoteBuildTime = buildTimeMatch ? Number(buildTimeMatch[1]) : 0;

  // On Windows, always prefer the NSIS .exe setup installer over .zip if listed in files:
  if (process.platform === 'win32' && packageFile && /\.zip$/i.test(packageFile)) {
    const exeBlockMatch = raw.match(
      /-\s*url:\s*['"]?([^\r\n'"]+\.exe)['"]?\s+sha512:\s*['"]?([^\s'"]+)['"]?/i
    );
    if (exeBlockMatch) {
      packageFile = exeBlockMatch[1].trim();
      remoteSha = exeBlockMatch[2].trim();
    }
  }

  return { remoteVersion, packageFile, remoteReleaseDate, remoteSha, remoteBuildTime };
}

function checkForElectronUpdates() {
  if (isUpdateDownloaded || isCheckingOrDownloadingUpdate) {
    return;
  }

  isCheckingOrDownloadingUpdate = true;
  lastUpdateCheckTime = Date.now();

  const manifestFile =
    process.platform === 'linux'
      ? 'latest-linux.yml'
      : process.platform === 'darwin'
        ? 'latest-mac.yml'
        : 'latest.yml';

  const manifestUrl = `${UPDATE_BASE_URL}/${manifestFile}?_t=${Date.now()}`;

  fetchUrlText(manifestUrl)
    .then((raw) => {
      const { remoteVersion, packageFile, remoteReleaseDate, remoteSha, remoteBuildTime } = parseManifestYaml(raw);
      return handleManifestUpdate(remoteVersion, packageFile, remoteReleaseDate, remoteSha, remoteBuildTime);
    })
    .catch(() => {
      // If latest.yml returned 404 (e.g., blocked by IIS MIME rules) or download failed, fall back to latest.json
      return checkLatestJsonFallback().catch(() => {});
    })
    .finally(() => {
      isCheckingOrDownloadingUpdate = false;
    });
}

app.on('ready', () => {
  evaluatePostUpdateWhatsNew();

  ipcMain.handle('consume-pending-whats-new', () => {
    const payload = pendingWhatsNewForRenderer;
    pendingWhatsNewForRenderer = null;
    const installedMeta = readInstalledUpdateMeta();
    if (installedMeta && installedMeta.pendingWhatsNew) {
      const cleaned = { ...installedMeta };
      delete cleaned.pendingWhatsNew;
      writeInstalledUpdateMeta(cleaned);
    }
    return payload;
  });

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
