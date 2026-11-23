const { app, BrowserWindow, ipcMain, dialog, shell, Menu, MenuItem } = require('electron');
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

// Enforce strict SSL certificate verification by default; only bypass in unpackaged local dev mode
app.on('certificate-error', (event, webContents, targetUrl, error, certificate, callback) => {
  if (!app.isPackaged && /^https:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(targetUrl)) {
    event.preventDefault();
    callback(true);
    return;
  }
  callback(false);
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

  ipcMain.on('show-context-menu', (event, { isEditable, isReadOnly, hasSelection } = {}) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;

    const menu = new Menu();

    if (isEditable && !isReadOnly) {
      menu.append(new MenuItem({ label: 'Undo', role: 'undo' }));
      menu.append(new MenuItem({ label: 'Redo', role: 'redo' }));
      menu.append(new MenuItem({ type: 'separator' }));
      menu.append(new MenuItem({ label: 'Cut', role: 'cut' }));
      menu.append(new MenuItem({ label: 'Copy', role: 'copy' }));
      menu.append(new MenuItem({ label: 'Paste', role: 'paste' }));
      menu.append(new MenuItem({ label: 'Paste and Match Style', role: 'pasteAndMatchStyle' }));
      menu.append(new MenuItem({ label: 'Delete', role: 'delete' }));
      menu.append(new MenuItem({ type: 'separator' }));
      menu.append(new MenuItem({ label: 'Select All', role: 'selectAll' }));
    } else if (isEditable && isReadOnly) {
      menu.append(new MenuItem({ label: 'Copy', role: 'copy' }));
      menu.append(new MenuItem({ type: 'separator' }));
      menu.append(new MenuItem({ label: 'Select All', role: 'selectAll' }));
    } else if (hasSelection) {
      menu.append(new MenuItem({ label: 'Copy', role: 'copy' }));
      menu.append(new MenuItem({ type: 'separator' }));
      menu.append(new MenuItem({ label: 'Select All', role: 'selectAll' }));
    }

    if (menu.items.length > 0) {
      menu.popup({ window: win });
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

const activeHttpRequests = new Map();
const electronCookieJar = new Map();

function buildMultipartBuffer(parts) {
  const boundary = '----OnSteroidFormBoundary' + crypto.randomBytes(12).toString('hex');
  const chunks = [];
  for (const part of parts || []) {
    if (!part || !part.name) continue;
    const safeName = String(part.name).replace(/"/g, '\\"');
    if (part.fileName && part.base64Data !== undefined) {
      const safeFile = String(part.fileName).replace(/"/g, '\\"');
      const mime = part.mimeType || 'application/octet-stream';
      const header = `--${boundary}\r\nContent-Disposition: form-data; name="${safeName}"; filename="${safeFile}"\r\nContent-Type: ${mime}\r\n\r\n`;
      chunks.push(Buffer.from(header, 'utf8'));
      chunks.push(Buffer.from(part.base64Data, 'base64'));
      chunks.push(Buffer.from('\r\n', 'utf8'));
    } else {
      const header = `--${boundary}\r\nContent-Disposition: form-data; name="${safeName}"\r\n\r\n`;
      chunks.push(Buffer.from(header, 'utf8'));
      chunks.push(Buffer.from(String(part.value ?? ''), 'utf8'));
      chunks.push(Buffer.from('\r\n', 'utf8'));
    }
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  return {
    boundary,
    buffer: Buffer.concat(chunks)
  };
}

function storeSetCookies(hostname, setCookieHeaders) {
  if (!hostname || !Array.isArray(setCookieHeaders) || setCookieHeaders.length === 0) return;
  let hostMap = electronCookieJar.get(hostname);
  if (!hostMap) {
    hostMap = new Map();
    electronCookieJar.set(hostname, hostMap);
  }
  for (const headerStr of setCookieHeaders) {
    const firstPart = String(headerStr || '').split(';')[0];
    const eqIdx = firstPart.indexOf('=');
    if (eqIdx > 0) {
      const name = firstPart.slice(0, eqIdx).trim();
      const val = firstPart.slice(eqIdx + 1).trim();
      hostMap.set(name, val);
    }
  }
}

function parseSetCookieObjects(hostname, setCookieHeaders) {
  if (!Array.isArray(setCookieHeaders)) return [];
  return setCookieHeaders.map(raw => {
    const parts = String(raw || '').split(';').map(p => p.trim());
    const [pair, ...attrs] = parts;
    const eqIdx = pair.indexOf('=');
    const name = eqIdx > -1 ? pair.slice(0, eqIdx).trim() : pair;
    const value = eqIdx > -1 ? pair.slice(eqIdx + 1).trim() : '';
    let domain = hostname || '';
    let pathVal = '/';
    let expires = 'Session';
    for (const attr of attrs) {
      const lower = attr.toLowerCase();
      if (lower.startsWith('domain=')) domain = attr.slice(7).trim();
      else if (lower.startsWith('path=')) pathVal = attr.slice(5).trim();
      else if (lower.startsWith('expires=')) expires = attr.slice(8).trim();
    }
    return { name, value, domain, path: pathVal, expires };
  }).filter(c => !!c.name);
}

function formatElectronNetworkError(err, targetUrl, timeoutMs) {
  const code = (err && err.code) || '';
  let hostname = targetUrl;
  let origin = targetUrl;
  try {
    const parsed = new URL(targetUrl);
    hostname = parsed.hostname;
    origin = parsed.origin;
  } catch {}

  switch (code) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return { code, message: `DNS lookup failed: could not resolve host "${hostname}". Verify the domain name and your internet connection.` };
    case 'ECONNREFUSED':
      return { code, message: `Connection refused: no server is accepting connections at ${origin}. Verify the server is running and the port is correct.` };
    case 'ETIMEDOUT':
    case 'ESOCKETTIMEDOUT':
      return {
        code,
        message: timeoutMs > 0
          ? `Request timed out after ${timeoutMs} ms while waiting for a response from ${targetUrl}. You can adjust the global Request Timeout in Settings.`
          : `Request timed out while waiting for a response from ${targetUrl}.`
      };
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return { code, message: `Network or host unreachable for ${targetUrl}. Check your network connection, VPN, or firewall.` };
    case 'ECONNRESET':
      return { code, message: `Connection was closed unexpectedly by ${origin}.` };
    case 'CERT_HAS_EXPIRED':
      return { code, message: `SSL certificate verification failed for "${hostname}": the server certificate has expired. Disable "Verify SSL Certificate" in Settings to bypass validation.` };
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'SELF_SIGNED_CERT_IN_CHAIN':
      return { code, message: `SSL certificate verification failed for "${hostname}": self-signed certificate detected. Disable "Verify SSL Certificate" in Settings to allow self-signed certificates.` };
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
    case 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY':
    case 'UNABLE_TO_GET_ISSUER_CERT':
      return { code, message: `SSL certificate verification failed for "${hostname}": unable to verify issuer certificate chain. Disable "Verify SSL Certificate" in Settings to bypass validation.` };
    case 'ERR_TLS_CERT_ALTNAME_INVALID':
      return { code, message: `SSL certificate verification failed for "${hostname}": certificate hostname mismatch. Disable "Verify SSL Certificate" in Settings to bypass validation.` };
    default:
      return {
        code: code || 'NETWORK_ERROR',
        message: (err && err.message) ? `${err.message} (${targetUrl})` : `Unable to reach API at ${targetUrl}.`
      };
  }
}

function executeNodeHttpRequest(options, redirectCount = 0, accumulatedCookies = []) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const requestId = options.requestId;
    let parsedUrl;
    try {
      parsedUrl = new URL(options.url);
    } catch {
      resolve({
        ok: false,
        errorCode: 'ERR_INVALID_URL',
        errorMessage: `Invalid request URL: "${options.url}"`,
        responseTimeMs: 0
      });
      return;
    }

    const isHttps = parsedUrl.protocol === 'https:';
    const transport = isHttps ? https : http;
    const method = (options.method || 'GET').toUpperCase();
    const outHeaders = { ...(options.headers || {}) };

    // Remove existing content-length so we compute an accurate byte length
    for (const k of Object.keys(outHeaders)) {
      if (k.toLowerCase() === 'content-length') {
        delete outHeaders[k];
      }
    }

    let bodyBuffer = null;
    if (method !== 'GET' && method !== 'HEAD') {
      if (Array.isArray(options.multipartParts)) {
        const mp = buildMultipartBuffer(options.multipartParts);
        bodyBuffer = mp.buffer;
        for (const k of Object.keys(outHeaders)) {
          if (k.toLowerCase() === 'content-type') delete outHeaders[k];
        }
        outHeaders['Content-Type'] = `multipart/form-data; boundary=${mp.boundary}`;
      } else if (options.body !== null && options.body !== undefined) {
        bodyBuffer = Buffer.isBuffer(options.body)
          ? options.body
          : Buffer.from(typeof options.body === 'string' ? options.body : JSON.stringify(options.body), 'utf8');
      }
      if (bodyBuffer) {
        outHeaders['Content-Length'] = String(bodyBuffer.length);
      }
    }

    // Attach cookies from Electron cookie jar when enabled and caller did not provide Cookie header
    if (options.enableCookies !== false) {
      const hasExplicitCookie = Object.keys(outHeaders).some(k => k.toLowerCase() === 'cookie');
      const jar = electronCookieJar.get(parsedUrl.hostname);
      if (!hasExplicitCookie && jar && jar.size > 0) {
        outHeaders['Cookie'] = Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
      }
    }

    const resolvedTimeoutMs =
      typeof options.timeoutMs === 'number' && Number.isFinite(options.timeoutMs) && options.timeoutMs >= 0
        ? Math.floor(options.timeoutMs)
        : 120000;

    const reqOpts = {
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: `${parsedUrl.pathname}${parsedUrl.search}`,
      method,
      headers: outHeaders,
      ...(resolvedTimeoutMs > 0 ? { timeout: resolvedTimeoutMs } : {})
    };

    if (isHttps) {
      // Disable TLS session caching so toggling Verify SSL ON <-> OFF takes effect immediately.
      // SSL verification is OFF by default and enforced strictly when options.verifySsl === true.
      const agentOpts = {
        rejectUnauthorized: options.verifySsl === true,
        maxCachedSessions: 0
      };
      if (options.clientCert && typeof options.clientCert === 'object') {
        if (options.clientCert.type === 'pfx' && options.clientCert.pfxBase64) {
          agentOpts.pfx = Buffer.from(options.clientCert.pfxBase64, 'base64');
        } else if (options.clientCert.type === 'pem') {
          if (options.clientCert.certPem) agentOpts.cert = options.clientCert.certPem;
          if (options.clientCert.keyPem) agentOpts.key = options.clientCert.keyPem;
        }
        if (options.clientCert.passphrase) {
          agentOpts.passphrase = options.clientCert.passphrase;
        }
      }
      reqOpts.agent = new https.Agent(agentOpts);
    }

    let settled = false;
    let hardTimeoutTimer = null;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      if (hardTimeoutTimer) {
        clearTimeout(hardTimeoutTimer);
        hardTimeoutTimer = null;
      }
      if (requestId) activeHttpRequests.delete(requestId);
      resolve(payload);
    };

    const req = transport.request(reqOpts, (res) => {
      const statusCode = res.statusCode || 0;
      const setCookies = Array.isArray(res.headers['set-cookie']) ? res.headers['set-cookie'] : [];
      if (options.enableCookies !== false && setCookies.length > 0) {
        storeSetCookies(parsedUrl.hostname, setCookies);
      }
      const parsedCookies = parseSetCookieObjects(parsedUrl.hostname, setCookies);
      const nextCookies = [...accumulatedCookies, ...parsedCookies];

      // Handle redirects
      const location = res.headers['location'];
      const isRedirect = [301, 302, 303, 307, 308].includes(statusCode) && !!location;
      if (isRedirect && options.followRedirects !== false && redirectCount < 10) {
        res.resume();
        let nextUrl;
        try {
          nextUrl = new URL(location, parsedUrl).toString();
        } catch {
          nextUrl = location;
        }
        const switchToGet = [301, 302, 303].includes(statusCode) && method !== 'GET' && method !== 'HEAD';
        const nextMethod = switchToGet ? 'GET' : method;
        const nextHeaders = { ...(options.headers || {}) };
        if (switchToGet) {
          for (const k of Object.keys(nextHeaders)) {
            if (k.toLowerCase() === 'content-type' || k.toLowerCase() === 'content-length') {
              delete nextHeaders[k];
            }
          }
        }
        executeNodeHttpRequest(
          {
            ...options,
            url: nextUrl,
            method: nextMethod,
            headers: nextHeaders,
            body: switchToGet ? null : options.body,
            multipartParts: switchToGet ? null : options.multipartParts
          },
          redirectCount + 1,
          nextCookies
        ).then(finish);
        return;
      }

      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const resBody = Buffer.concat(chunks).toString('utf8');
        const flatHeaders = {};
        for (const [k, v] of Object.entries(res.headers || {})) {
          if (v !== undefined) {
            flatHeaders[k] = Array.isArray(v) ? v.join('; ') : String(v);
          }
        }
        finish({
          ok: true,
          statusCode,
          statusText: res.statusMessage || '',
          headers: flatHeaders,
          cookies: nextCookies,
          body: resBody,
          responseTimeMs: Date.now() - startTime
        });
      });
    });

    if (requestId) {
      activeHttpRequests.set(requestId, req);
    }

    if (resolvedTimeoutMs > 0) {
      hardTimeoutTimer = setTimeout(() => {
        req.destroy(Object.assign(new Error('Request timed out'), { code: 'ETIMEDOUT' }));
      }, resolvedTimeoutMs);
    }

    req.on('timeout', () => {
      req.destroy(Object.assign(new Error('Request timed out'), { code: 'ETIMEDOUT' }));
    });

    req.on('error', (err) => {
      if (err && err.message === 'ABORTED_BY_USER') {
        finish({
          ok: false,
          cancelled: true,
          errorCode: 'CANCELLED',
          errorMessage: 'Request cancelled',
          responseTimeMs: Date.now() - startTime
        });
        return;
      }
      const formatted = formatElectronNetworkError(err, options.url, resolvedTimeoutMs);
      finish({
        ok: false,
        errorCode: formatted.code,
        errorMessage: formatted.message,
        responseTimeMs: Date.now() - startTime
      });
    });

    if (bodyBuffer) {
      req.write(bodyBuffer);
    }
    req.end();
  });
}

let activeMockServer = null;
let activeMockRoutes = [];

app.on('ready', () => {
  evaluatePostUpdateWhatsNew();

  ipcMain.handle('execute-http-request', async (_event, options) => {
    return executeNodeHttpRequest(options || {});
  });

  ipcMain.handle('start-mock-server', async (_event, payload) => {
    try {
      if (activeMockServer) {
        await new Promise((resolve) => activeMockServer.close(() => resolve()));
        activeMockServer = null;
      }
      const port = Number(payload?.port) || 4050;
      activeMockRoutes = Array.isArray(payload?.routes) ? payload.routes : [];

      activeMockServer = http.createServer((req, res) => {
        const reqMethod = (req.method || 'GET').toUpperCase();
        const reqPath = (req.url || '/').split('?')[0];
        const match = activeMockRoutes.find(
          (r) => String(r.method || 'GET').toUpperCase() === reqMethod && String(r.path || '/') === reqPath
        );
        if (!match) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Mock route not found', method: reqMethod, path: reqPath }));
          return;
        }
        const status = Number(match.statusCode) || 200;
        const headers = { 'Content-Type': 'application/json', ...(match.headers || {}) };
        res.writeHead(status, headers);
        res.end(match.body || '');
      });

      await new Promise((resolve, reject) => {
        activeMockServer.once('error', reject);
        activeMockServer.listen(port, '127.0.0.1', resolve);
      });
      return { ok: true, port };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle('stop-mock-server', async () => {
    if (activeMockServer) {
      await new Promise((resolve) => activeMockServer.close(() => resolve()));
      activeMockServer = null;
    }
    return { ok: true };
  });

  ipcMain.handle('update-mock-routes', (_event, routes) => {
    activeMockRoutes = Array.isArray(routes) ? routes : [];
    return { ok: true, count: activeMockRoutes.length };
  });

  ipcMain.on('cancel-http-request', (_event, requestId) => {
    const req = requestId ? activeHttpRequests.get(requestId) : null;
    if (req) {
      req.destroy(new Error('ABORTED_BY_USER'));
      activeHttpRequests.delete(requestId);
    }
  });

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
