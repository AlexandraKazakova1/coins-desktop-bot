const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  auth: () => ipcRenderer.invoke("auth_v2"),
  addTab: (payload) => ipcRenderer.invoke("addTab_v2", payload),
  startTab: (payload) => ipcRenderer.invoke("startTab_v2", payload),
  startAllTabs: (payload) => ipcRenderer.invoke("startAllTabs_v2", payload),
  stopTab: (payload) => ipcRenderer.invoke("stopTab", payload),
  removeTab: (payload) => ipcRenderer.invoke("removeTab", payload),
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
