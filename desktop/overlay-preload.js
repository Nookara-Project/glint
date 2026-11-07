const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('glintOverlay', {
  onToast: cb => ipcRenderer.on('overlay:toast', (_e, t) => cb(t)),
  onSound: cb => ipcRenderer.on('overlay:sound', (_e, s) => cb(s)),
  hidden: () => ipcRenderer.send('overlay:hidden'),
});
