const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

const BUY_SELECTOR = "button.btn-primary.buy";
const POLL_MS = 50;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function defaultChromePathsWin() {
  const candidates = [
    "C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe",
    "C:\\\\Program Files (x86)\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe",
    path.join(
      process.env.LOCALAPPDATA || "",
      "Google\\Chrome\\Application\\chrome.exe",
    ),
  ];
  return candidates.filter(Boolean);
}

async function fileExists(p) {
  try {
    await fs.promises.access(p);
    return true;
  } catch {
    return false;
  }
}

class BotController {
  constructor({ profileDir, onStatus }) {
    this.profileDir = profileDir;
    ensureDir(this.profileDir);

    this.onStatus = onStatus || (() => {});
    this.chromePath = null;

    this.browser = null;
    this.page = null;

    this.tracking = false;
    this.state = { status: "Готово", detail: "", url: "" };
  }

  setChromePath(p) {
    this.chromePath = p;
  }

  getState() {
    return {
      ...this.state,
      tracking: this.tracking,
      chromePath: this.chromePath,
    };
  }

  _setStatus(status, detail = "") {
    this.state.status = status;
    this.state.detail = detail;
    this.onStatus(status, detail);
  }

  async _humanIdleActivity() {
    if (!this.page) return;

    // 50% шанс нічого не робити (людина може просто дивитись)
    if (Math.random() < 0.5) {
      await sleep(300 + Math.random() * 600);
      return;
    }

    // невеликий скрол
    const direction = Math.random() < 0.5 ? -1 : 1;
    const delta = direction * (100 + Math.random() * 200);

    await this.page.mouse.wheel({ deltaY: delta });
    await sleep(200 + Math.random() * 400);

    // іноді — рух миші
    if (Math.random() < 0.6) {
      const x = 100 + Math.random() * 600;
      const y = 100 + Math.random() * 400;
      await this.page.mouse.move(x, y, {
        steps: 8 + Math.floor(Math.random() * 6),
      });
      await sleep(120 + Math.random() * 250);
    }
  }

  async _resolveChromePath() {
    if (this.chromePath && (await fileExists(this.chromePath)))
      return this.chromePath;

    for (const p of defaultChromePathsWin()) {
      if (p && (await fileExists(p))) return p;
    }
    throw new Error(
      "Не знайдено Chrome. Встанови Google Chrome (стандартний) або вкажи шлях до chrome.exe.",
    );
  }

  async _ensureBrowser() {
    if (this.browser && this.page) return;

    const executablePath = await this._resolveChromePath();
    this._setStatus("Запуск браузера", "Відкриваю Chrome...");

    this.browser = await puppeteer.launch({
      headless: false,
      executablePath,
      userDataDir: this.profileDir,
      defaultViewport: null,
      args: [
        "--start-maximized",
        // не додаємо жодних “stealth” трюків, тільки людська поведінка
      ],
    });

    const pages = await this.browser.pages();
    this.page = pages[0] || (await this.browser.newPage());

    // ВАЖЛИВО: знімаємо “webdriver” прапорець (це не обхід CAPTCHA, а зменшення тригеру automation)
    await this.page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    // Зробимо User-Agent як у звичайного Chrome (без "Headless")
    const ua = await this.page.browser().userAgent();
    await this.page.setUserAgent(ua.replace("HeadlessChrome", "Chrome"));

    this.page.on("close", () => {
      this.page = null;
    });

    this._setStatus("Готово", "Браузер запущено.");
  }

  async openAuth() {
    await this._ensureBrowser();
    this._setStatus(
      "Авторизація",
      "Увійди вручну на сайті у відкритому Chrome.",
    );
    await this.page.goto("https://coins.bank.gov.ua/", {
      waitUntil: "domcontentloaded",
    });
    await sleep(200);
    await this._dismissCookieBannerIfAny();
  }

  async _dismissCookieBannerIfAny() {
    if (!this.page) return;
    await this.page.evaluate(() => {
      const allow = document.querySelector("a.cc-btn.cc-allow");
      const deny = document.querySelector("a.cc-btn.cc-deny");
      const el = allow || deny;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) el.click();
    });
  }

  async _isCloudflareOrTurnstileVisible() {
    if (!this.page) return false;
    return await this.page.evaluate(() => {
      const t = (document.body?.innerText || "").toLowerCase();
      const hasCfFrame = !!document.querySelector(
        'iframe[src*="challenges.cloudflare.com"]',
      );
      const hasTurnstile = !!document.querySelector(
        'iframe[title*="Turnstile"], .cf-turnstile, [data-sitekey]',
      );
      const hasError = t.includes("помилка") || t.includes("error");
      return hasCfFrame || hasTurnstile || hasError;
    });
  }

  async _buyButtonReady() {
    if (!this.page) return false;
    return await this.page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const visible = r.width > 0 && r.height > 0;
      if (!visible) return false;
      const disabled =
        !!el.disabled || el.getAttribute("aria-disabled") === "true";
      return !disabled;
    }, BUY_SELECTOR);
  }

  // ---- “людські” дії ----

  async _humanLikePause(minMs, maxMs) {
    const ms = Math.floor(minMs + Math.random() * (maxMs - minMs));
    await sleep(ms);
  }

  async _humanMoveAndClickHandle(handle) {
    await this.page.bringToFront();
    await this.page.focus("body");

    const box = await handle.boundingBox();
    if (!box) throw new Error("Не можу отримати boundingBox кнопки.");

    // стартова позиція десь в межах вікна
    const startX = 80 + Math.random() * 400;
    const startY = 80 + Math.random() * 300;

    await this.page.mouse.move(startX, startY, { steps: 5 });
    await this._humanLikePause(80, 180);

    const targetX = box.x + box.width / 2;
    const targetY = box.y + box.height / 2;

    // плавний рух до кнопки
    const steps = 18 + Math.floor(Math.random() * 10);
    await this.page.mouse.move(targetX, targetY, { steps });
    await this._humanLikePause(120, 260);

    await this.page.mouse.down();
    await this._humanLikePause(40, 90);
    await this.page.mouse.up();
  }

  async _humanScrollToHandle(handle) {
    const y = await handle.evaluate(
      (el) => el.getBoundingClientRect().top + window.scrollY,
    );
    const currentY = await this.page.evaluate(() => window.scrollY);

    const delta = y - currentY - 220;
    if (Math.abs(delta) > 10) {
      await this.page.mouse.wheel({ deltaY: delta });
      await this._humanLikePause(120, 260);
    }
  }

  async _humanClickBuy() {
    await this._dismissCookieBannerIfAny();

    // маленька “людська” пауза перед дією
    await this._humanLikePause(250, 650);

    await this.page.waitForSelector(BUY_SELECTOR, {
      visible: true,
      timeout: 2000,
    });
    const btn = await this.page.$(BUY_SELECTOR);
    if (!btn) throw new Error('Кнопку "Купити" не знайдено.');

    // “людський” скрол
    await this._humanScrollToHandle(btn);

    // перевірка перекриття
    const topOk = await btn.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const top = document.elementFromPoint(x, y);
      return top === el || el.contains(top);
    });

    if (!topOk) {
      // fallback: все одно пробуємо мишкою по центру (після скролу координати вже правильні)
      const box = await btn.boundingBox();
      if (!box) throw new Error("Не можу отримати boundingBox кнопки.");
      await this.page.mouse.click(
        box.x + box.width / 2,
        box.y + box.height / 2,
        { clickCount: 1 },
      );
      return;
    }

    // основний клік “як людина”
    await this._humanMoveAndClickHandle(btn);
  }

  // ---- основний сценарій ----

  async startTracking(url) {
    await this._ensureBrowser();
    this.state.url = url;

    this.tracking = true;
    this._setStatus("Відкриваю сторінку", url);

    await this.page.goto(url, { waitUntil: "domcontentloaded" });
    await sleep(250);
    await this._dismissCookieBannerIfAny();

    this._setStatus('Очікую "Купити"', "Відстежую появу/активацію кнопки...");

    while (this.tracking) {
      // якщо Cloudflare вже на екрані — нічого не робимо, чекаємо
      if (await this._isCloudflareOrTurnstileVisible()) {
        this._setStatus(
          "Потрібна перевірка",
          "Пройди Cloudflare вручну у браузері.",
        );
        await sleep(600);
        continue;
      }

      const ready = await this._buyButtonReady();

      if (ready) {
        this._setStatus('"Купити" доступна', "Клікаю...");
        try {
          await this._humanClickBuy();
          this._setStatus(
            "Натиснуто",
            "Якщо зʼявилась перевірка — пройди вручну.",
          );
        } catch (e) {
          this._setStatus("Помилка кліку", e.message);
        }

        // після кліку даємо сайту “подихати”
        await sleep(350);
      } else {
        // 👇 “людська” активність ДО появи кнопки
        await this._humanIdleActivity();

        // коротка пауза між перевірками
        await sleep(POLL_MS);
      }
    }

    this._setStatus("Зупинено", "");
  }

  async stop() {
    this.tracking = false;
    if (this.browser) {
      try {
        await this.browser.close();
      } catch {}
    }
    this.browser = null;
    this.page = null;
    this._setStatus("Готово", "Браузер закрито.");
  }
}

module.exports = { BotController };
