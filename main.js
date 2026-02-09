const path = require("path");
const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const { BotController } = require("./bot");

let win;
let bot;

function createWindow() {
  win = new BrowserWindow({
    width: 520,
    height: 420,
    resizable: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, "renderer", "ui.html"));
}

function sendStatus(status, detail = "") {
  if (!win) return;
  win.webContents.send("status", { status, detail, ts: Date.now() });
}

app.whenReady().then(() => {
  createWindow();

  bot = new BotController({
    profileDir: path.join(app.getPath("userData"), "chrome-profile"),
    onStatus: (s, d) => sendStatus(s, d),
  });

  // --- IPC API ---

  ipcMain.handle("auth", async () => {
    try {
      await bot.openAuth();
      return { ok: true };
    } catch (e) {
      sendStatus("Помилка", e.message);
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("stop", async () => {
    try {
      await bot.stop();
      return { ok: true };
    } catch (e) {
      sendStatus("Помилка", e.message);
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("chooseChrome", async () => {
    const res = await dialog.showOpenDialog(win, {
      title: "Вибери chrome.exe",
      properties: ["openFile"],
      filters: [{ name: "Chrome", extensions: ["exe"] }],
    });
    if (res.canceled || !res.filePaths?.[0]) return { ok: false };
    bot.setChromePath(res.filePaths[0]);
    sendStatus("Готово", "Шлях до Chrome задано.");
    return { ok: true, path: res.filePaths[0] };
  });

  ipcMain.handle("getStatus", async () => {
    return { ok: true, state: bot.getState() };
  });

  ipcMain.handle("arm", async (_, payload) => {
    try {
      // запуск у фоні, не блокуємо UI
      bot.arm(payload).catch((e) => sendStatus("Помилка", e.message));
      return { ok: true };
    } catch (e) {
      sendStatus("Помилка", e.message);
      return { ok: false, error: e.message };
    }
  });
});

app.on("window-all-closed", async () => {
  try {
    await bot?.stop();
  } catch {}
  if (process.platform !== "darwin") app.quit();
});
