const path = require("path");
const { app, BrowserWindow, ipcMain, dialog, Menu } = require("electron");

const { BotController } = require("./bot");

let win;
let bots = [];

function slugifyAccountName(raw, fallbackIndex = 0) {
  const normalized = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-zа-яіїєґ0-9]+/giu, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || `account-${fallbackIndex + 1}`;
}

function parseAccounts(rawAccounts) {
  const source = String(rawAccounts || "").trim();
  if (!source) return ["default"];

  const unique = [];
  const seen = new Set();
  const parts = source.split(/[\n,;]+/g).map((item) => item.trim());

  for (const part of parts) {
    if (!part) continue;
    const key = part.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(part);
  }

  return unique.length > 0 ? unique : ["default"];
}

function parseTabs(rawTabs) {
  const tabs = Number(rawTabs);
  if (!Number.isFinite(tabs)) return 1;
  return Math.max(1, Math.min(10, Math.floor(tabs)));
}

function createBotsForConfig(rawAccounts, rawTabs) {
  const accounts = parseAccounts(rawAccounts);
  const tabsPerAccount = parseTabs(rawTabs);
  const nextBots = [];

  for (let i = 0; i < accounts.length; i += 1) {
    const accountName = accounts[i];
    const accountSlug = slugifyAccountName(accountName, i);

    for (let tab = 1; tab <= tabsPerAccount; tab += 1) {
      const label = `${accountName} · вкладка ${tab}`;
      const bot = new BotController({
        profileDir: path.join(
          app.getPath("userData"),
          "chrome-profiles",
          accountSlug,
          `tab-${tab}`,
        ),
        onStatus: (s, d, e) => sendStatus(`[${label}] ${s}`, d, e),
      });

      nextBots.push(bot);
    }
  }

  return nextBots;
}

function createWindow() {
  win = new BrowserWindow({
    width: 600,
    height: 520,
    resizable: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, "renderer", "ui.html"));

  win.webContents.on("context-menu", (event, params) => {
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

function sendStatus(status, detail = "", eventCode = "") {
  if (!win) return;
  if (win.isDestroyed()) return;
  if (!win.webContents) return;
  if (win.webContents.isDestroyed()) return;

  try {
    win.webContents.send("status", {
      status,
      detail,
      eventCode,
      ts: Date.now(),
    });
  } catch (e) {
    // ігноруємо, якщо вікно вже закрите
  }
}

app.whenReady().then(() => {
  createWindow();

  bots = createBotsForConfig("", 1);

  // --- IPC API ---

  ipcMain.handle("auth", async (_, payload) => {
    try {
      const nextBots = createBotsForConfig(payload?.accounts, payload?.tabs);

      for (const runningBot of bots) {
        await runningBot.stop();
      }
      bots = nextBots;

      for (const bot of bots) {
        await bot.openAuth();
      }
      return { ok: true };
    } catch (e) {
      sendStatus("Помилка", e.message, "error");
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("stop", async () => {
    try {
      for (const bot of bots) {
        await bot.stop();
      }
      return { ok: true };
    } catch (e) {
      sendStatus("Помилка", e.message, "error");
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("getStatus", async () => {
    return { ok: true, state: bots.map((bot) => bot.getState()) };
  });

  ipcMain.handle("arm", async (_, payload) => {
    try {
      // запуск у фоні, не блокуємо UI
      if (!bots.length) {
        bots = createBotsForConfig(payload?.accounts, payload?.tabs);
      }

      for (const bot of bots) {
        bot.arm(payload).catch((e) => sendStatus("Помилка", e.message, "error"));
      }

      return { ok: true };
    } catch (e) {
      sendStatus("Помилка", e.message, "error");
      return { ok: false, error: e.message };
    }
  });
});

app.on("window-all-closed", async () => {
  try {
    for (const bot of bots) {
      await bot.stop();
    }
  } catch {}
  if (process.platform !== "darwin") app.quit();
});
