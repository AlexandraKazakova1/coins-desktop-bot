const fs = require("fs");
const path = require("path");
const { app, BrowserWindow, ipcMain, Menu } = require("electron");

const { BotController } = require("./bot");

let win;
let authBot = null;
let nextTabId = 1;
const tabs = new Map();

function parseTabs(rawTabs) {
  const tabsCount = Number(rawTabs);
  if (!Number.isFinite(tabsCount)) return 1;
  return Math.max(1, Math.min(10, Math.floor(tabsCount)));
}

function getAuthProfileDir() {
  return path.join(app.getPath("userData"), "chrome-profiles", "authorized");
}

function getWorkerProfileDir(tabId) {
  return path.join(app.getPath("userData"), "chrome-profiles", `tab-${tabId}`);
}

function recreateDirectory(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function cloneAuthProfile(workerProfileDir) {
  const authProfile = getAuthProfileDir();
  if (!fs.existsSync(authProfile)) {
    throw new Error("Спочатку натисни «Авторизація» і увійди в акаунт.");
  }

  recreateDirectory(workerProfileDir);
  fs.cpSync(authProfile, workerProfileDir, { recursive: true, force: true });
}

function sendStatus(status, detail = "", eventCode = "") {
  if (!win || win.isDestroyed() || !win.webContents || win.webContents.isDestroyed()) {
    return;
  }

  win.webContents.send("status", {
    status,
    detail,
    eventCode,
    ts: Date.now(),
  });
}

function sendTabStatus(tabId, status, detail = "", eventCode = "") {
  if (!win || win.isDestroyed() || !win.webContents || win.webContents.isDestroyed()) {
    return;
  }

  win.webContents.send("tab-status", {
    tabId,
    status,
    detail,
    eventCode,
    ts: Date.now(),
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 760,
    height: 700,
    resizable: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, "renderer", "ui.html"));

  win.webContents.on("context-menu", (_event, params) => {
    const template = [
      { role: "cut", enabled: params.editFlags.canCut },
      { role: "copy", enabled: params.editFlags.canCopy },
      { role: "paste", enabled: params.editFlags.canPaste },
      { type: "separator" },
      { role: "selectAll" },
    ];

    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: win });
  });
}

function ensureAuthBot() {
  if (!authBot) {
    authBot = new BotController({
      profileDir: getAuthProfileDir(),
      onStatus: (s, d, e) => sendStatus(`[Авторизація] ${s}`, d, e),
    });
  }

  return authBot;
}

async function stopAllTabs() {
  for (const tab of tabs.values()) {
    await tab.bot.stop();
  }
  tabs.clear();
}

function createTabWorker(tabId) {
  const profileDir = getWorkerProfileDir(tabId);
  cloneAuthProfile(profileDir);

  const bot = new BotController({
    profileDir,
    onStatus: (s, d, e) => sendTabStatus(tabId, s, d, e),
  });

  tabs.set(tabId, { id: tabId, bot, profileDir });
  return tabs.get(tabId);
}

app.whenReady().then(() => {
  createWindow();
  ensureAuthBot();

  ipcMain.handle("auth", async () => {
    try {
      const bot = ensureAuthBot();
      await bot.openAuth();
      return { ok: true };
    } catch (e) {
      sendStatus("Помилка", e.message, "error");
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("addTab", async () => {
    try {
      const tabId = nextTabId;
      nextTabId += 1;
      createTabWorker(tabId);
      return { ok: true, tabId };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("startTab", async (_event, payload) => {
    try {
      const tabId = Number(payload?.tabId);
      const url = String(payload?.url || "").trim();
      if (!url) throw new Error("Вкажи URL товару для вкладки.");

      const tab = tabs.get(tabId);
      if (!tab) throw new Error("Вкладку не знайдено. Додай вкладку заново.");

      tab.bot
        .arm({
          url,
          startAtLocal: payload?.startAtLocal || null,
        })
        .catch((e) => sendTabStatus(tabId, "Помилка", e.message, "error"));

      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("startAllTabs", async (_event, payload) => {
    try {
      const tabIds = Array.isArray(payload?.tabIds)
        ? payload.tabIds.map((id) => Number(id)).filter((id) => Number.isFinite(id))
        : [];

      for (const tabId of tabIds.slice(0, parseTabs(tabIds.length))) {
        const tab = tabs.get(tabId);
        if (!tab) continue;

        const url = String(payload?.urlsByTab?.[String(tabId)] || "").trim();
        if (!url) {
          sendTabStatus(tabId, "Помилка", "Вкажи URL для цієї вкладки", "error");
          continue;
        }

        tab.bot
          .arm({
            url,
            startAtLocal: payload?.startAtLocal || null,
          })
          .catch((e) => sendTabStatus(tabId, "Помилка", e.message, "error"));
      }

      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("stopTab", async (_event, payload) => {
    try {
      const tabId = Number(payload?.tabId);
      const tab = tabs.get(tabId);
      if (!tab) return { ok: true };

      await tab.bot.stop();
      sendTabStatus(tabId, "Готово", "Вкладку зупинено", "ready");
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("stop", async () => {
    try {
      await stopAllTabs();
      await authBot?.softStop();
      return { ok: true };
    } catch (e) {
      sendStatus("Помилка", e.message, "error");
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("getStatus", async () => {
    return {
      ok: true,
      state: {
        auth: authBot?.getState(),
        tabs: [...tabs.values()].map((t) => ({ id: t.id, ...t.bot.getState() })),
      },
    };
  });
});

app.on("window-all-closed", async () => {
  try {
    await stopAllTabs();
    await authBot?.stop();
  } catch {}
  if (process.platform !== "darwin") app.quit();
});
