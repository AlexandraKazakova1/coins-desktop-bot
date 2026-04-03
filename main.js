const fs = require("fs");
const path = require("path");
const { app, BrowserWindow, ipcMain, Menu } = require("electron");

const { BotController } = require("./bot");

const MAX_PER_BROWSER = 3;
const BROWSER_TYPES = ["chrome", "opera", "firefox"];

let win;
let nextTabId = 1;
const tabs = new Map();

function parseTabs(rawTabs) {
  const tabsCount = Number(rawTabs);
  if (!Number.isFinite(tabsCount)) return 1;
  return Math.max(
    1,
    Math.min(MAX_PER_BROWSER * BROWSER_TYPES.length, Math.floor(tabsCount)),
  );
}

function getAuthProfileDir(browserType) {
  return path.join(
    app.getPath("userData"),
    "chrome-profiles",
    `authorized-${browserType}`,
  );
}

function getWorkerProfileDir(tabId, browserType) {
  return path.join(
    app.getPath("userData"),
    "chrome-profiles",
    `${browserType}-browser-${tabId}`,
  );
}

function recreateDirectory(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function isIgnorableCopyError(error) {
  const code = String(error?.code || "").toUpperCase();
  return ["EBUSY", "EPERM", "EACCES", "ENOENT"].includes(code);
}

function copyDirectoryLoose(srcDir, dstDir, shouldCopy) {
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const dstPath = path.join(dstDir, entry.name);
    if (!shouldCopy(srcPath)) continue;

    if (entry.isDirectory()) {
      fs.mkdirSync(dstPath, { recursive: true });
      copyDirectoryLoose(srcPath, dstPath, shouldCopy);
      continue;
    }

    if (!entry.isFile()) continue;

    try {
      fs.copyFileSync(srcPath, dstPath);
    } catch (error) {
      if (isIgnorableCopyError(error)) continue;
      throw error;
    }
  }
}

function cloneAuthProfile(workerProfileDir, browserType) {
  const authProfile = getAuthProfileDir(browserType);
  if (!fs.existsSync(authProfile)) {
    throw new Error(
      `Для ${browserType} ще немає авторизації. Натисни кнопку цього браузера та увійди в акаунт.`,
    );
  }

  recreateDirectory(workerProfileDir);

  const skipLockedFiles = (src) => {
    const normalized = String(src || "").toLowerCase();
    if (normalized.includes("singletonlock")) return false;
    if (normalized.endsWith(`${path.sep}lock`)) return false;
    if (normalized.includes(`${path.sep}network${path.sep}cookies`))
      return false;
    if (normalized.includes(`${path.sep}network${path.sep}cookies-journal`))
      return false;
    if (normalized.includes(`${path.sep}network${path.sep}cookies`))
      return false;
    if (normalized.includes(`${path.sep}network${path.sep}cookies-journal`))
      return false;
    if (normalized.includes("safe browsing")) return false;
    if (normalized.includes("safebrowsing")) return false;
    if (normalized.includes(`${path.sep}sessions${path.sep}`)) return false;
    if (normalized.endsWith(`${path.sep}sessions`)) return false;
    if (normalized.includes(`${path.sep}cache${path.sep}`)) return false;
    if (normalized.includes(`${path.sep}code cache${path.sep}`)) return false;
    if (normalized.includes("shadercache")) return false;
    return true;
  };

  copyDirectoryLoose(authProfile, workerProfileDir, skipLockedFiles);
}

function sendStatus(status, detail = "", eventCode = "") {
  if (
    !win ||
    win.isDestroyed() ||
    !win.webContents ||
    win.webContents.isDestroyed()
  ) {
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
  if (
    !win ||
    win.isDestroyed() ||
    !win.webContents ||
    win.webContents.isDestroyed()
  ) {
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
    width: 860,
    height: 760,
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

async function ensureTabBot(tabId) {
  const tab = tabs.get(tabId);
  if (!tab) throw new Error("Вкладку не знайдено. Додай вкладку заново.");
  if (tab.bot) return tab;
  throw new Error("Вкладка не ініціалізована. Створи її заново кнопкою браузера.");
}

async function stopAllTabs({ closePages = false } = {}) {
  for (const tab of tabs.values()) {
    if (!tab.bot) continue;
    if (closePages) await tab.bot.stop();
    else await tab.bot.softStop();
  }
  if (closePages) tabs.clear();
}

async function closeAll() {
  await stopAllTabs({ closePages: true });
}

async function handleAddTab(_event, payload) {
  try {
    const requestedType = String(
      (payload && payload.browserType) || "",
    ).toLowerCase();
    const browserType = BROWSER_TYPES.includes(requestedType)
      ? requestedType
      : "chrome";

    const tabsForBrowser = [...tabs.values()].filter(
      (tab) => tab.browserType === browserType,
    ).length;

    if (tabsForBrowser >= MAX_PER_BROWSER) {
      throw new Error(
        `Для ${browserType} максимум ${MAX_PER_BROWSER} вкладки.`,
      );
    }

    if (tabs.size >= MAX_PER_BROWSER * BROWSER_TYPES.length) {
      throw new Error(
        `Максимум ${MAX_PER_BROWSER * BROWSER_TYPES.length} вкладок (${MAX_PER_BROWSER} на кожен браузер).`,
      );
    }

    const tabId = nextTabId;
    nextTabId += 1;
    let sessionBot = browserSessions.get(browserType);
    if (!sessionBot) {
      sessionBot = new BotController({
        profileDir: getAuthProfileDir(browserType),
        browserType,
        onStatus: (s, d, e) => sendStatus(`[${browserType}] ${s}`, d, e),
      });
      browserSessions.set(browserType, sessionBot);
    }

    const helperTab = await sessionBot.openHelperTab("https://coins.bank.gov.ua/");

    const bot = new BotController({
      profileDir: workerProfileDir,
      browserType,
      onStatus: (s, d, e) => sendTabStatus(tabId, s, d, e),
    });
    await bot.openHelperTab("https://coins.bank.gov.ua/");

    tabs.set(tabId, {
      id: tabId,
      browserType,
      bot,
      profileDir: workerProfileDir,
    });

    const nextIndex = tabsForBrowser + 1;

    sendTabStatus(
      tabId,
      "Готово",
      `${browserType}: вкладка ${nextIndex} відкрита. Увійди в акаунт у цьому браузері, відкрий монету та встав URL у форму.`,
      "ready",
    );

    return { ok: true, tabId, browserType };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function handleStartTab(_event, payload) {
  try {
    const tabId = Number(payload && payload.tabId);
    const url = String((payload && payload.url) || "").trim();
    if (!url) throw new Error("Вкажи URL товару для вкладки.");

    const tab = await ensureTabBot(tabId);

    tab.bot
      .arm({
        url,
        startAtLocal: (payload && payload.startAtLocal) || null,
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
      ? payload.tabIds
          .map((id) => Number(id))
          .filter((id) => Number.isFinite(id))
      : [];

    for (const tabId of tabIds.slice(0, parseTabs(tabIds.length))) {
      const url = String(payload?.urlsByTab?.[String(tabId)] || "").trim();
      if (!url) {
        sendTabStatus(tabId, "Помилка", "Вкажи URL для цієї вкладки", "error");
        continue;
      }

      const tab = await ensureTabBot(tabId);

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
}

app.whenReady().then(() => {
  createWindow();

  registerIpc("addTab", handleAddTab);
  registerIpc("addTab_v2", handleAddTab);
  registerIpc("startTab", handleStartTab);
  registerIpc("startTab_v2", handleStartTab);
  registerIpc("startAllTabs", handleStartAllTabs);
  registerIpc("startAllTabs_v2", handleStartAllTabs);

  registerIpc("stopTab", async (_event, payload) => {
    try {
      const tabId = Number(payload && payload.tabId);
      const tab = tabs.get(tabId);
      if (!tab || !tab.bot) return { ok: true };

      await tab.bot.softStop();
      sendTabStatus(tabId, "Готово", "Вкладку зупинено", "ready");
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  registerIpc("stop", async () => {
    try {
      await stopAllTabs();
      return { ok: true };
    } catch (e) {
      sendStatus("Помилка", e.message, "error");
      return { ok: false, error: e.message };
    }
  });

  registerIpc("auth_v2", async () => {
    return {
      ok: false,
      error:
        "Канал auth_v2 більше не використовується. Натисни кнопку браузера (Chrome/Opera/Mozilla), щоб відкрити вікно авторизації.",
    };
  });

  registerIpc("getStatus", async () => {
    return {
      ok: true,
      state: {
        tabs: [...tabs.values()].map((t) => ({
          id: t.id,
          browserType: t.browserType,
          ...(t.bot ? t.bot.getState() : {}),
        })),
      },
    };
  });
});

app.on("window-all-closed", async () => {
  try {
    await closeAll();
  } catch {}
  if (process.platform !== "darwin") app.quit();
});
