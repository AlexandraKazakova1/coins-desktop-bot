const path = require("path");
const { app, BrowserWindow, ipcMain, Menu } = require("electron");

const { BotController } = require("./bot");

const MAX_BROWSERS = 3;
const BROWSER_TYPES = ["chrome", "opera", "firefox"];

let win;
let authBot = null;
let nextTabId = 1;
const tabs = new Map();

function parseTabs(rawTabs) {
  const tabsCount = Number(rawTabs);
  if (!Number.isFinite(tabsCount)) return 1;
  return Math.max(1, Math.min(MAX_BROWSERS, Math.floor(tabsCount)));
}

function getAuthProfileDir() {
  return path.join(app.getPath("userData"), "chrome-profiles", "authorized");
}

function getWorkerProfileDir(tabId, browserType) {
  return path.join(app.getPath("userData"), "chrome-profiles", `${browserType}-browser-${tabId}`);
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

  const skipLockedFiles = (src) => {
    const normalized = String(src || "").toLowerCase();
    if (normalized.includes("singletonlock")) return false;
    if (normalized.endsWith(`${path.sep}lock`)) return false;
    if (normalized.includes(`${path.sep}network${path.sep}cookies`)) return false;
    if (normalized.includes(`${path.sep}network${path.sep}cookies-journal`)) return false;
    return true;
  };

  fs.cpSync(authProfile, workerProfileDir, {
    recursive: true,
    force: true,
    filter: skipLockedFiles,
  });
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

function registerIpc(channel, handler) {
  try {
    ipcMain.removeHandler(channel);
  } catch {}
  ipcMain.handle(channel, handler);
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

async function ensureTabBot(tabId) {
  const tab = tabs.get(tabId);
  if (!tab) throw new Error("Вкладку не знайдено. Додай вкладку заново.");
  if (tab.bot) return tab;

  if (authBot?.browser) {
    await authBot.stop();
  }

  cloneAuthProfile(tab.profileDir);

  const bot = new BotController({
    profileDir: tab.profileDir,
    browserType: tab.browserType,
    onStatus: (s, d, e) => sendTabStatus(tabId, s, d, e),
  });

  const updated = { ...tab, bot };
  tabs.set(tabId, updated);
  return updated;
}

async function stopAllTabs() {
  for (const tab of tabs.values()) {
    if (!tab.bot) continue;
    await tab.bot.stop();
  }
  tabs.clear();
}

async function handleAuth() {
  try {
    const bot = ensureAuthBot();
    await bot.openAuth();
    return { ok: true };
  } catch (e) {
    sendStatus("Помилка", e.message, "error");
    return { ok: false, error: e.message };
  }
}

async function handleAddTab() {
  try {
    if (tabs.size >= MAX_BROWSERS) {
      throw new Error(`Максимум ${MAX_BROWSERS} окремі браузери.`);
    }

    const bot = ensureAuthBot();
    await bot.openHelperTab("https://coins.bank.gov.ua/");

    const tabId = nextTabId;
    nextTabId += 1;

    const browserType = BROWSER_TYPES[(tabId - 1) % BROWSER_TYPES.length];

    tabs.set(tabId, {
      id: tabId,
      browserType,
      bot: null,
      profileDir: getWorkerProfileDir(tabId, browserType),
    });

    sendTabStatus(
      tabId,
      "Готово",
      `Скопіюй посилання з нової вкладки. При старті відкриється окремий браузер: ${browserType}.`,
      "ready",
    );

    return { ok: true, tabId };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function handleStartTab(_event, payload) {
  try {
    const tabId = Number(payload?.tabId);
    const url = String(payload?.url || "").trim();
    if (!url) throw new Error("Вкажи URL товару для вкладки.");

    const tab = await ensureTabBot(tabId);

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
}

async function handleStartAllTabs(_event, payload) {
  try {
    const tabIds = Array.isArray(payload?.tabIds)
      ? payload.tabIds.map((id) => Number(id)).filter((id) => Number.isFinite(id))
      : [];

    for (const tabId of tabIds.slice(0, parseTabs(tabIds.length))) {
      const url = String(payload?.urlsByTab?.[String(tabId)] || "").trim();
      if (!url) {
        sendTabStatus(tabId, "Помилка", "Вкажи URL для цієї вкладки", "error");
        continue;
      }

      const tab = await ensureTabBot(tabId);

      activeTab.bot
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
}

app.whenReady().then(() => {
  createWindow();
  ensureAuthBot();

  registerIpc("auth", handleAuth);
  registerIpc("auth_v2", handleAuth);
  registerIpc("addTab", handleAddTab);
  registerIpc("addTab_v2", handleAddTab);
  registerIpc("startTab", handleStartTab);
  registerIpc("startTab_v2", handleStartTab);
  registerIpc("startAllTabs", handleStartAllTabs);
  registerIpc("startAllTabs_v2", handleStartAllTabs);

  registerIpc("stopTab", async (_event, payload) => {
    try {
      const tabId = Number(payload?.tabId);
      const tab = tabs.get(tabId);
      if (!tab?.bot) return { ok: true };

      await tab.bot.stop();
      sendTabStatus(tabId, "Готово", "Вкладку зупинено", "ready");
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  registerIpc("stop", async () => {
    try {
      await stopAllTabs();
      await authBot?.softStop();
      return { ok: true };
    } catch (e) {
      sendStatus("Помилка", e.message, "error");
      return { ok: false, error: e.message };
    }
  });

  registerIpc("getStatus", async () => {
    return {
      ok: true,
      state: {
        auth: authBot?.getState(),
        tabs: [...tabs.values()].map((t) => ({ id: t.id, browserType: t.browserType, ...(t.bot ? t.bot.getState() : {}) })),
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
