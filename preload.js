const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  setTheme: (theme) => ipcRenderer.send('theme-changed', theme),
  consumePendingWhatsNew: () => ipcRenderer.invoke('consume-pending-whats-new'),
  showContextMenu: (opts) => ipcRenderer.send('show-context-menu', opts),
  executeHttpRequest: (options) => ipcRenderer.invoke('execute-http-request', options),
  cancelHttpRequest: (requestId) => ipcRenderer.send('cancel-http-request', requestId),
  startMockServer: (payload) => ipcRenderer.invoke('start-mock-server', payload),
  stopMockServer: () => ipcRenderer.invoke('stop-mock-server'),
  updateMockRoutes: (routes) => ipcRenderer.invoke('update-mock-routes', routes),
  executeTerminalCommand: (command) => ipcRenderer.invoke('execute-terminal-command', command)
});

// Provide native right-click context menu (Cut, Copy, Paste, Select All) for inputs in Electron
window.addEventListener('contextmenu', (e) => {
  const target = e.target;
  if (!target) return;

  // Let Monaco Editor's built-in rich context menu handle clicks inside Monaco
  if (typeof target.closest === 'function' && target.closest('.monaco-editor')) {
    return;
  }

  // Check if clicked element is an input, textarea, or contenteditable
  const inputEl = (typeof target.matches === 'function' && target.matches('input, textarea'))
    ? target
    : (typeof target.closest === 'function' ? target.closest('input, textarea') : null);

  const isEditable = !!inputEl || !!target.isContentEditable;
  const selection = window.getSelection() ? window.getSelection().toString() : '';
  const hasSelection = selection.trim().length > 0;

  if (isEditable || hasSelection) {
    if (inputEl && typeof inputEl.focus === 'function' && document.activeElement !== inputEl) {
      inputEl.focus();
    }
    ipcRenderer.send('show-context-menu', {
      isEditable,
      hasSelection,
      isReadOnly: inputEl ? (inputEl.readOnly || inputEl.disabled) : false
    });
  }
}, true);
