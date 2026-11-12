const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  setTheme: (theme) => ipcRenderer.send('theme-changed', theme),
  consumePendingWhatsNew: () => ipcRenderer.invoke('consume-pending-whats-new')
});
