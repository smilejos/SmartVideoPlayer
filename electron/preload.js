const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    openFile: () => ipcRenderer.invoke('open-file'),
    openFolder: () => ipcRenderer.invoke('open-folder'),
    getVideoMetadata: (path) => ipcRenderer.invoke('get-video-metadata', path),
    getServerPort: () => ipcRenderer.invoke('get-server-port')
});
