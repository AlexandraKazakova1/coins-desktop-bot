const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  auth: () => ipcRenderer.invoke("auth"),
  startTracking: (payload) => ipcRenderer.invoke("startTracking", payload),
  stop: () => ipcRenderer.invoke("stop"),
  chooseChrome: () => ipcRenderer.invoke("chooseChrome"),
  getStatus: () => ipcRenderer.invoke("getStatus"),
  onStatus: (cb) => ipcRenderer.on("status", (_, data) => cb(data)),
});
