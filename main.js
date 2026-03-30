const fs = require("fs");
const path = require("path");
const { app, BrowserWindow, ipcMain, dialog, Menu } = require("electron");

const { BotController } = require("./bot");

let win;
let workerBots = [];
let authBot = null;

function parseTabs(rawTabs) {
  const tabs = Number(rawTabs);
  if (!Number.isFinite(tabs)) return 1;
  return Math.max(1, Math.min(10, Math.floor(tabs)));
}

function parseUrls(rawUrls) {
  const rows = String(rawUrls || "")
    .split(/\n+/g)
    .map((item) => item.trim())
    .filter(Boolean);

  return [...new Set(rows)];
}

function buildUrlsPlan(urls, tabsCount) {
  if (!urls.length) return [];

  const plan = [];
  for (let i = 0; i < tabsCount; i += 1) {
    plan.push(urls[i % urls.length]);
  }
  return plan;
}

function getAuthProfileDir() {
  return path.join(app.getPath("userData"), "chrome-profiles", "authorized");
}

function getWorkerProfileDir(tabIndex) {
  return path.join(app.getPath("userData"), "chrome-profiles", `tab-${tabIndex + 1}`);
}

function recreateDirectory(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function cloneAuthProfileToWorkers(tabsCount) {
  const authProfile = getAuthProfileDir();
  if (!fs.existsSync(authProfile)) {
    throw new Error("Спочатку натисни «Авторизація» і увійди в акаунт.");
  }

  for (let i = 0; i < tabsCount; i += 1) {
    const workerProfile = getWorkerProfileDir(i);
    recreateDirectory(workerProfile);
    fs.cpSync(authProfile, workerProfile, { recursive: true, force: true });
  }
}

async function stopWorkers() {
  for (const bot of workerBots) {
    await bot.stop();
  }
  workerBots = [];
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
  authBot = new BotController({
    profileDir: getAuthProfileDir(),
    onStatus: (s, d, e) => sendStatus(`[Авторизація] ${s}`, d, e),
  });

  // --- IPC API ---

  ipcMain.handle("auth", async () => {
    try {
      if (!authBot) {
        authBot = new BotController({
          profileDir: getAuthProfileDir(),
          onStatus: (s, d, e) => sendStatus(`[Авторизація] ${s}`, d, e),
        });
      }
      await stopWorkers();
      await authBot.openAuth();
      return { ok: true };
    } catch (e) {
      sendStatus("Помилка", e.message, "error");
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("stop", async () => {
    try {
      await stopWorkers();
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
        workers: workerBots.map((bot) => bot.getState()),
      },
    };
  });

  ipcMain.handle("arm", async (_, payload) => {
    try {
      const urls = parseUrls(payload?.urls);
      if (!urls.length) {
        throw new Error("Додай хоча б одне посилання на товар.");
      }

      const tabsCount = parseTabs(payload?.tabs);
      const plan = buildUrlsPlan(urls, tabsCount);
      await stopWorkers();
      cloneAuthProfileToWorkers(tabsCount);

      sendStatus(
        "Підготовка",
        `Запускаю ${tabsCount} вкладок для ${urls.length} посилань.`,
        "prepare",
      );

      workerBots = plan.map((url, i) =>
        new BotController({
          profileDir: getWorkerProfileDir(i),
          onStatus: (s, d, e) => sendStatus(`[Вкладка ${i + 1}] ${s}`, d, e),
        }),
      );

      for (let i = 0; i < workerBots.length; i += 1) {
        const bot = workerBots[i];
        const url = plan[i];
        bot
          .arm({ url, startAtLocal: payload?.startAtLocal || null })
          .catch((e) => sendStatus("Помилка", e.message, "error"));
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
    await stopWorkers();
    await authBot?.stop();
  } catch {}
  if (process.platform !== "darwin") app.quit();
});
