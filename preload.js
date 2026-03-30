const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  auth: () => ipcRenderer.invoke("auth"),
  addTab: () => ipcRenderer.invoke("addTab"),
  startTab: (payload) => ipcRenderer.invoke("startTab", payload),
  startAllTabs: (payload) => ipcRenderer.invoke("startAllTabs", payload),
  stopTab: (payload) => ipcRenderer.invoke("stopTab", payload),
  stop: () => ipcRenderer.invoke("stop"),
  onStatus: (cb) => {
    const handler = (_, data) => cb(data);
    ipcRenderer.on("status", handler);
    return () => ipcRenderer.removeListener("status", handler);
  },
  onTabStatus: (cb) => {
    const handler = (_, data) => cb(data);
    ipcRenderer.on("tab-status", handler);
    return () => ipcRenderer.removeListener("tab-status", handler);
  },
});
