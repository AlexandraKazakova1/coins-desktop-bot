const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

const BUY_SELECTORS = [
  "button.btn-primary.buy",
  "button.buy",
  "button[aria-label*='куп' i]",
  "a.btn-primary.buy",
  "a.buy",
  "a[aria-label*='куп' i]",
  "[data-action*='buy' i]",
  "[class*='buy' i]",
];

const BOT_STATES = {
  READY: "READY",
  AUTH: "AUTH",
  WAIT_BUY: "WAIT_BUY",
  TRY_ADD: "TRY_ADD",
  ARMED: "ARMED",
  PREPARE: "PREPARE",
  WAIT_START: "WAIT_START",
  ADDED: "ADDED",
  WAIT_CAPTCHA: "WAIT_CAPTCHA",
  STOPPED: "STOPPED",
  ERROR: "ERROR",
  DISCONNECTED: "DISCONNECTED",
  PAGE_CLOSED: "PAGE_CLOSED",
};

const STATUS_MAP = {
  [BOT_STATES.READY]: { title: "Готово", detail: "Браузер закрито" },
  [BOT_STATES.AUTH]: { title: "Авторизація" },
  [BOT_STATES.WAIT_BUY]: {
    title: "Очікую кнопку “Купити”",
    detail: "Технічний режим очікування",
    technical: true,
  },
  [BOT_STATES.TRY_ADD]: { title: "Кнопка доступна", detail: "Клікаю" },
  [BOT_STATES.ARMED]: { title: "Озброєно" },
  [BOT_STATES.PREPARE]: { title: "Підготовка", detail: "Відкриваю сторінку" },
  [BOT_STATES.WAIT_START]: { title: "Очікую старт" },
  [BOT_STATES.ADDED]: {
    title: "Товар додано в кошик",
    detail: "Готово ✅",
    final: true,
  },
  [BOT_STATES.WAIT_CAPTCHA]: {
    title: "Потрібно ввести капчу",
    detail: "Підтвердь капчу вручну",
    technical: true,
  },
  [BOT_STATES.STOPPED]: {
    title: "Зупинено",
    detail: "Відстеження припинено",
    final: true,
  },
  [BOT_STATES.ERROR]: { title: "Помилка", final: true },
  [BOT_STATES.DISCONNECTED]: {
    title: "Відʼєднано",
    detail: "Chrome/сесія DevTools закрита. Перепідключусь при наступній дії.",
  },
  [BOT_STATES.PAGE_CLOSED]: { title: "Page closed", detail: "Вкладку закрито" },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function chromePaths() {
  return [
    "C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe",
    "C:\\\\Program Files (x86)\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe",
    path.join(
      process.env.LOCALAPPDATA || "",
      "Google\\Chrome\\Application\\chrome.exe",
    ),
  ];
}

class BotController {
  constructor({ profileDir, onStatus }) {
    this.profileDir = profileDir;
    ensureDir(profileDir);
    this.onStatus = onStatus;
    this.browser = null;
    this.page = null;
    this.tracking = false;
    this.waitingCaptcha = false;
    this.state = BOT_STATES.READY;
  }

  _status(state, detailOverride = "") {
    if (this.state === BOT_STATES.ADDED && state === BOT_STATES.STOPPED) return;

    const message = STATUS_MAP[state] || { title: state, detail: "" };
    const detail = detailOverride || message.detail || "";
    this.state = state;
    this.onStatus(message.title, detail);
  }

  async _focusCoinsTab() {
    if (!this.browser) return false;

    const pages = await this.browser.pages();
    const existingCoinsTab = pages.find((p) =>
      (p.url?.() || "").includes("coins.bank.gov.ua"),
    );

    if (!existingCoinsTab) return false;

    this.page = existingCoinsTab;

    try {
      if (this.page.bringToFront) await this.page.bringToFront();
    } catch {}

    return true;
  }

  async _findBuyButton() {
    for (const sel of BUY_SELECTORS) {
      try {
        const el = await this.page.$(sel);
        if (el) return el;
      } catch {
        // пропускаємо некоректний/нестабільний селектор, не валимо пошук
      }
    }

    // fallback по тексту (button/a/div[role=button])
    const handle = await this.page.evaluateHandle(() => {
      const candidates = [
        ...document.querySelectorAll("button, a, [role='button']"),
      ];

      const byText = candidates.find((el) => {
        const t = (el.innerText || el.textContent || "").toLowerCase().trim();
        return (
          t.includes("купити") || t.includes("в кошик") || t.includes("buy")
        );
      });

      if (byText) return byText;

      // Частий випадок — span всередині кнопки
      const span = [...document.querySelectorAll("span")].find((el) => {
        const t = (el.innerText || el.textContent || "").toLowerCase().trim();
        return (
          t.includes("купити") || t.includes("в кошик") || t.includes("buy")
        );
      });

      return span?.closest("button, a, [role='button']") || null;
    });

    return handle.asElement();
  }

  async _browser() {
    // якщо браузер є, але відключений — скидаємо і запускаємо заново
    if (this.browser) {
      if (
        typeof this.browser.isConnected === "function" &&
        !this.browser.isConnected()
      ) {
        this.browser = null;
        this.page = null;
      } else {
        return;
      }
    }

    const chrome = chromePaths().find(fs.existsSync);
    if (!chrome) throw new Error("Chrome не знайдено");

    this.browser = await puppeteer.launch({
      headless: false,
      executablePath: chrome,
      userDataDir: this.profileDir,
      defaultViewport: null,
      args: ["--start-maximized"],
    });

    // якщо Chrome відвалиться — щоб не лишався “мертвий” browser в памʼяті
    this.browser.on("disconnected", () => {
      this._status(BOT_STATES.DISCONNECTED);
      this.browser = null;
      this.page = null;
    });

    const pages = await this.browser.pages();
    this.page = pages[0] || (await this.browser.newPage());

    await this.page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
  }

  async openAuth() {
    await this._ensurePage();
    await this._focusCoinsTab();

    const currentUrl = this.page.url() || "";

    // Якщо вже на coins.bank.gov.ua — НЕ перезавантажуємо
    if (currentUrl.includes("coins.bank.gov.ua")) {
      this._status(BOT_STATES.AUTH, "Браузер відкрито.");
      return;
    }

    // Інакше — відкриємо головну
    this._status(
      BOT_STATES.AUTH,
      "Відкриваю сайт. Авторизуватись вручну, якщо потрібно.",
    );
    await this.page.goto("https://coins.bank.gov.ua/", {
      waitUntil: "domcontentloaded",
    });
  }

  async _humanIdle() {
    if (!this.page) return;

    // 60% часу — взагалі нічого не робимо
    if (Math.random() < 0.6) {
      await sleep(300 + Math.random() * 600);
      return;
    }

    // маленький “людський” скрол
    const direction = Math.random() < 0.7 ? 1 : -1; // частіше вниз
    const delta = direction * (80 + Math.random() * 140); // 80–220px

    await this.page.mouse.wheel({ deltaY: delta });
    await sleep(180 + Math.random() * 320);
  }

  async _fastClick() {
    const timeoutAt = Date.now() + 5000;
    let btn = null;

    while (!btn && Date.now() < timeoutAt) {
      btn = await this._findBuyButton();
      if (!btn) await sleep(120);
    }

    if (!btn) throw new Error('Кнопку "Купити" не знайдено');
    await btn.evaluate((el) =>
      el.scrollIntoView({ block: "center", inline: "center" }),
    );
    await sleep(80);

    try {
      await btn.click({ delay: 20 });
      return;
    } catch {
      const box = await btn.boundingBox();
      if (!box) throw new Error('Кнопка "Купити" не клікабельна');
      await this.page.mouse.click(
        box.x + box.width / 2,
        box.y + box.height / 2,
        {
          delay: 20,
        },
      );
    }
  }

  // async _waitAdded(timeout = 3000) {
  //   const t0 = Date.now();
  //   while (Date.now() - t0 < timeout) {
  //     const ok = await this.page.evaluate(() =>
  //       document.body.innerText.toLowerCase().includes("додано"),
  //     );
  //     if (ok) return true;
  //     await sleep(80);
  //   }
  //   return false;
  // }
  async _ensurePage() {
    await this._browser(); // має підняти this.browser / this.page або хоча б this.browser

    // Якщо page не існує або закрита — створюємо нову
    if (!this.page || this.page.isClosed?.() === true) {
      if (!this.browser) throw new Error("Browser не ініціалізовано");
      this.page = await this.browser.newPage();

      // (опційно) базові налаштування
      await this.page.setViewport({ width: 1280, height: 720 }).catch(() => {});
      this.page.on("close", () => this._status(BOT_STATES.PAGE_CLOSED));
    }

    // bringToFront робимо “м’яко”
    try {
      if (this.page.bringToFront) await this.page.bringToFront();
    } catch (e) {
      // якщо сесія закрита — не валимо весь процес, просто продовжуємо
      if (!String(e).includes("Session closed")) throw e;
    }

    return this.page;
  }
  async arm({ url, startAtLocal, prewarmSeconds = 5 }) {
    if (!url) throw new Error("URL обовʼязковий");

    const hasStartTime = !!startAtLocal;

    await this._ensurePage();

    // ====== РЕЖИМ БЕЗ ЧАСУ (STANDBY) ======
    if (!hasStartTime) {
      if (this.tracking)
        throw new Error("Відстеження вже запущено. Натисни 'Зупинити'.");

      this.tracking = true;
      this._status(BOT_STATES.WAIT_BUY);

      await this.page.goto(url, { waitUntil: "domcontentloaded" });
      let addedToCart = false;

      while (this.tracking) {
        // чекаємо появу кнопки
        const btn = await this._findBuyButton();
        if (btn) {
          this._status(BOT_STATES.TRY_ADD);

          const before = await this._getCartCount();
          await this._fastClick();
          const result = await this._waitAddedByCartCount(before, 6000);

          if (result === "added") {
            this._status(BOT_STATES.ADDED);
            addedToCart = true;
            this.tracking = false;
            return;
          } else if (result === "captcha") {
            this._status(BOT_STATES.WAIT_CAPTCHA);
            this.tracking = false;
          } else {
            this._status(
              BOT_STATES.ERROR,
              "Не вдалося підтвердити додавання. Перевір кошик вручну.",
            );
            this.tracking = false;
          }
        }
        await this._humanIdle(); // людська активність до появи кнопки
        await sleep(120);
      }
      if (!addedToCart) {
        this._status(BOT_STATES.STOPPED);
      }
      return;
    }

    // ====== РЕЖИМ З ЧАСОМ (ARM ПО ТЗ) ======
    const startAt = new Date(startAtLocal).getTime();
    if (!Number.isFinite(startAt))
      throw new Error("Некоректна дата/час старту");

    const openAt = startAt - Number(prewarmSeconds || 0) * 1000;

    if (this.tracking)
      throw new Error("Відстеження вже запущено. Натисни 'Зупинити'.");
    this.tracking = true;

    this._status(
      BOT_STATES.ARMED,
      `Старт: ${new Date(startAt).toLocaleString()}`,
    );

    // чекаємо prewarm
    while (this.tracking && Date.now() < openAt) {
      await this._humanIdle();
      await sleep(120);
    }
    if (!this.tracking) return;

    this._status(BOT_STATES.PREPARE);
    await this.page.goto(url, { waitUntil: "domcontentloaded" });

    // чекаємо точний старт
    this._status(BOT_STATES.WAIT_START, new Date(startAt).toLocaleString());
    while (this.tracking && Date.now() < startAt) {
      await this._humanIdle();
      await sleep(80);
    }
    if (!this.tracking) return;

    this._status(BOT_STATES.TRY_ADD, "Старт! Клікаю");
    const before = await this._getCartCount();
    await this._fastClick();

    const result = await this._waitAddedByCartCount(before, 6000);
    if (result === "added") {
      this._status(BOT_STATES.ADDED);
      this.tracking = false;
      return;
    } else if (result === "captcha") {
      this._status(BOT_STATES.WAIT_CAPTCHA);
      this.tracking = false;
    } else {
      this._status(
        BOT_STATES.ERROR,
        "Не вдалося підтвердити додавання. Перевір кошик вручну.",
      );
      this.tracking = false;
    }
  }
  async softStop() {
    if (this.state === BOT_STATES.ADDED) return;
    this.tracking = false;
    this.waitingCaptcha = false;
    this._status(BOT_STATES.STOPPED);
  }
  async stop() {
    this.tracking = false;
    this.waitingCaptcha = false;
    if (this.browser) await this.browser.close();
    this.browser = null;
    this.page = null;
    this._status(BOT_STATES.READY);
  }

  async _getCartCount() {
    if (!this.page) return null;

    return await this.page.evaluate(() => {
      // Спробуємо знайти лічильник біля іконки кошика
      const cartLink =
        document.querySelector('a[aria-label="кошик"]') ||
        document.querySelector('a.small-wrap-a[aria-label="кошик"]') ||
        document.querySelector('a[href*="cart"], a[href*="kosik"]');

      const texts = [];

      if (cartLink) texts.push(cartLink.textContent || "");
      // часті варіанти бейджа
      const badge =
        document.querySelector(".cart_count") ||
        document.querySelector(".cart-count") ||
        document.querySelector(".cart__count") ||
        (cartLink ? cartLink.querySelector("span") : null);

      if (badge) texts.push(badge.textContent || "");

      const joined = texts.join(" ").replace(/\s+/g, " ").trim();
      const m = joined.match(/(\d+)/);
      return m ? Number(m[1]) : 0; // якщо не знайшли — вважаємо 0
    });
  }

  async _isInCartStateVisible() {
    if (!this.page) return false;

    return this.page.evaluate(() => {
      const text = (document.body?.innerText || "").toLowerCase();
      const addedPhrases = [
        "додано до кошика",
        "додано в кошик",
        "товар у кошику",
        "у кошику",
        "в кошику",
        "перейти до кошика",
      ];

      if (addedPhrases.some((phrase) => text.includes(phrase))) return true;

      const controls = [
        ...document.querySelectorAll("button, a, [role='button']"),
      ];

      return controls.some((el) => {
        const t = (el.innerText || el.textContent || "").toLowerCase().trim();
        return (
          t.includes("у кошику") ||
          t.includes("в кошику") ||
          t.includes("перейти до кошика")
        );
      });
    });
  }

  async _waitAddedByCartCount(beforeCount, timeout = 5000) {
    const t0 = Date.now();

    while (Date.now() - t0 < timeout) {
      // 1) Найнадійніше: лічильник кошика зріс
      const nowCount = await this._getCartCount();
      if (typeof nowCount === "number" && typeof beforeCount === "number") {
        if (nowCount > beforeCount) return "added";
      }

      // 2) Fallback: toast/текст “додано … кошик”
      const toastLike = await this.page.evaluate(() => {
        const t = (document.body?.innerText || "").toLowerCase();
        return (
          (t.includes("додано") &&
            (t.includes("кошик") || t.includes("корзин"))) ||
          t.includes("додано до кошика") ||
          t.includes("додано в кошик")
        );
      });
      if (toastLike) return "added";

      const inCartState = await this._isInCartStateVisible();
      if (inCartState) return "added";

      const captchaNeeded = await this._hasCaptcha();
      if (captchaNeeded) return "captcha";

      await sleep(120);
    }

    return "unknown";
  }

  async _isCaptchaStillVisible() {
    if (!this.page) return false;

    return this.page.evaluate(() => {
      const bodyText = (document.body?.innerText || "").toLowerCase();
      const challengeTextHints = [
        "cloudflare",
        "підтвердіть, що ви людина",
        "verify you are human",
        "checking your browser",
        "перевірка безпеки",
      ];

      if (challengeTextHints.some((hint) => bodyText.includes(hint))) {
        return true;
      }

      const selectors = [
        "iframe[src*='challenges.cloudflare.com']",
        "iframe[title*='challenge' i]",
        "iframe[src*='captcha']",
        "div.g-recaptcha",
        "textarea[name='g-recaptcha-response']",
        "[id*='challenge' i]",
        "[class*='challenge' i]",
      ];

      return selectors.some((selector) => !!document.querySelector(selector));
    });
  }

  async _waitCaptchaAndRetry(beforeCount) {
    this.waitingCaptcha = true;
    this._status(
      "Очікує підтвердження Cloudflare",
      "Пройди challenge вручну. Я продовжу автоматично.",
    );

    while (this.tracking && this.waitingCaptcha) {
      const visible = await this._isCaptchaStillVisible();
      if (!visible) break;
      await sleep(500);
    }

    if (!this.tracking) {
      this.waitingCaptcha = false;
      return "stopped";
    }

    this.waitingCaptcha = false;

    for (let attempt = 1; attempt <= 3 && this.tracking; attempt += 1) {
      this._status(
        "Повторна спроба після Cloudflare",
        `Спроба ${attempt}/3: повторно натискаю “Купити”`,
      );

      await sleep(100 + Math.floor(Math.random() * 201));
      try {
        await this._fastClick();
      } catch (e) {
        this._status("Повторна спроба після Cloudflare", String(e));
        continue;
      }

      const result = await this._waitAddedByCartCount(beforeCount, 3000);
      if (result === "added") return "added";
      if (result === "captcha") {
        this.waitingCaptcha = true;
        this._status(
          "Очікує підтвердження Cloudflare",
          "Challenge зʼявився знову. Пройди його вручну.",
        );

        while (this.tracking && this.waitingCaptcha) {
          const visible = await this._isCaptchaStillVisible();
          if (!visible) break;
          await sleep(500);
        }

        this.waitingCaptcha = false;
      }
    }

    return "unknown";
  }

  async _hasCaptcha() {
    if (!this.page) return false;

    return this.page.evaluate(() => {
      const bodyText = (document.body?.innerText || "").toLowerCase();
      if (bodyText.includes("капч")) return true;

      const selectors = [
        "iframe[src*='captcha']",
        "div.g-recaptcha",
        "textarea[name='g-recaptcha-response']",
        "input[name*='captcha']",
        "img[alt*='captcha' i]",
      ];

      return selectors.some((selector) => !!document.querySelector(selector));
    });
  }

  getState() {
    return {
      tracking: this.tracking,
      waitingCaptcha: this.waitingCaptcha,
      hasBrowser: !!this.browser,
      hasPage: !!this.page && this.page.isClosed?.() !== true,
      pageUrl: this.page?.url?.() || null,
    };
  }
}

module.exports = { BotController };
