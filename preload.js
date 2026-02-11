const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  auth: () => ipcRenderer.invoke("auth"),
  arm: (payload) => ipcRenderer.invoke("arm", payload),
  stop: () => ipcRenderer.invoke("stop"),
  onStatus: (cb) => {
    const handler = (_, data) => cb(data);
    ipcRenderer.on("status", handler);
    return () => ipcRenderer.removeListener("status", handler);
  },
});
