const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('powerWards', {
  platform: 'electron',
  storage: {
    listProfiles: () => ipcRenderer.invoke('storage:listProfiles'),
    loadProfile: (id) => ipcRenderer.invoke('storage:loadProfile', id),
    saveProfile: (profile) => ipcRenderer.invoke('storage:saveProfile', profile),
    deleteProfile: (id) => ipcRenderer.invoke('storage:deleteProfile', id),
    putScreenshot: (profileId, wardId, screenshotId, data, type) =>
      ipcRenderer.invoke('storage:putScreenshot', profileId, wardId, screenshotId, data, type),
    getScreenshot: (profileId, screenshotId) => ipcRenderer.invoke('storage:getScreenshot', profileId, screenshotId),
    deleteScreenshot: (profileId, screenshotId) => ipcRenderer.invoke('storage:deleteScreenshot', profileId, screenshotId),
    listScreenshots: (profileId) => ipcRenderer.invoke('storage:listScreenshots', profileId),
    copyScreenshots: (fromId, toId, ids) => ipcRenderer.invoke('storage:copyScreenshots', fromId, toId, ids),
  },
  onCloseRequest: (handler) => {
    ipcRenderer.on('app:close-request', () => handler());
  },
  confirmClose: () => ipcRenderer.send('app:confirm-close'),
  exportFile: (fileName, content) => ipcRenderer.invoke('dialog:exportFile', fileName, content),
  importFile: () => ipcRenderer.invoke('dialog:importFile'),
});
