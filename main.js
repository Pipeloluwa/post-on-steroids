//electron configuration
const { app, BrowserWindow, protocol } = require('electron');
const path = require('path');
const url = require('url');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'OnSteroids',
    // icon: path.join(__dirname, 'dist/post-on-steroids/browser/icons/onsteroids-icon.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false, // Bypasses CORS!
    },
  });

  // Removing the default top menu bar for a cleaner app feel
  mainWindow.setMenuBarVisibility(false);

  // Load the compiled Angular client-side shell (index.csr.html)
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

// electron configuration
app.on('ready', () => {
  // Intercept file protocol to handle Angular pushState routing
  protocol.interceptFileProtocol('file', (request, callback) => {
    let urlPath = request.url.substr(8); // remove file:///
    // Decode URI to handle spaces in paths
    urlPath = decodeURI(urlPath);
    const normalizedPath = urlPath.replace(/\\/g, '/');

    // If the URL has no file extension (like .js, .css, .html), it is an Angular route (e.g., /steroid).
    // Reroute it to the physical index.csr.html file so Angular can take over.
    const filename = normalizedPath.split('/').pop();
    if (filename && !filename.includes('.')) {
      return callback({
        path: path.join(__dirname, 'dist/post-on-steroids/browser/index.csr.html'),
      });
    }

    callback({ path: urlPath });
  });

  createWindow();
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', function () {
  if (mainWindow === null) createWindow();
});
