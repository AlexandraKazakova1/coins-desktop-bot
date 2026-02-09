const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  auth: () => ipcRenderer.invoke("auth"),
  arm: (payload) => ipcRenderer.invoke("arm", payload),
  stop: () => ipcRenderer.invoke("stop"),
  onStatus: (cb) => ipcRenderer.on("status", (_, data) => cb(data)),
});
