const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

const BUY_SELECTORS = [
  "button.btn-primary.buy",
  "button.buy",
  "button:contains('Купити')",
  "button:contains('купити')",
  "button[aria-label*='куп']",
];

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
  }

  _status(s, d = "") {
    this.onStatus(s, d);
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
      const el = await this.page.$(sel);
      if (el) return el;
    }

    // fallback по тексту
    const handle = await this.page.evaluateHandle(() => {
      const btns = [...document.querySelectorAll("button")];
      return (
        btns.find((b) => b.innerText?.toLowerCase().includes("купити")) || null
      );
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
      this._status(
        "Відʼєднано",
        "Chrome/сесія DevTools закрита. Перепідключусь при наступній дії.",
      );
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
      this._status(
        "Авторизація",
        "Браузер відкрито. Якщо вже увійшла — нічого не роби.",
      );
      return;
    }

    // Інакше — відкриємо головну
    this._status(
      "Авторизація",
      "Відкриваю сайт. Увійди вручну, якщо потрібно.",
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
    await btn.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await btn.click();
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
      this.page.on("close", () =>
        this._status("Page closed", "Вкладку закрито"),
      );
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
      this._status("Standby", "Очікую появу/активацію кнопки “Купити”");

      await this.page.goto(url, { waitUntil: "domcontentloaded" });
      let addedToCart = false;

      while (this.tracking) {
        // чекаємо появу кнопки
        const btn = await this._findBuyButton();
        if (btn) {
          this._status("Кнопка доступна", "Клікаю");

          const before = await this._getCartCount();
          await this._fastClick();
          const result = await this._waitAddedByCartCount(before, 6000);

          if (result === "added") {
            this._status("Товар додано в кошик", "Готово ✅");
            addedToCart = true;
            this.tracking = false;
          } else if (result === "captcha") {
            this._status("Потрібно ввести капчу", "Підтвердь капчу вручну");
          } else {
            this._status("Потрібна перевірка", "Перевір кошик вручну");
          }
        }
        await this._humanIdle(); // людська активність до появи кнопки
        await sleep(120);
      }
      if (!addedToCart) {
        this._status("Зупинено", "");
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

    this._status("Озброєно", `Старт: ${new Date(startAt).toLocaleString()}`);

    // чекаємо prewarm
    while (this.tracking && Date.now() < openAt) {
      await this._humanIdle();
      await sleep(120);
    }
    if (!this.tracking) return;

    this._status("Підготовка", "Відкриваю сторінку");
    await this.page.goto(url, { waitUntil: "domcontentloaded" });

    // чекаємо точний старт
    this._status("Очікую старт", new Date(startAt).toLocaleString());
    while (this.tracking && Date.now() < startAt) {
      await this._humanIdle();
      await sleep(80);
    }
    if (!this.tracking) return;

    this._status("Старт!", "Клікаю");
    const before = await this._getCartCount();
    await this._fastClick();

    const result = await this._waitAddedByCartCount(before, 6000);
    if (result === "added") {
      this._status("Товар додано в кошик", "Готово ✅");
      this.tracking = false;
    } else if (result === "captcha") {
      this._status("Потрібно ввести капчу", "Підтвердь капчу вручну");
    } else {
      this._status("Потрібна перевірка", "Перевір кошик вручну");
    }
  }
  async softStop() {
    this.tracking = false;
    this._status("Зупинено", "Відстеження припинено");
  }
  async stop() {
    this.tracking = false;
    if (this.browser) await this.browser.close();
    this.browser = null;
    this.page = null;
    this._status("Готово", "Браузер закрито");
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
          t.includes("додано") && (t.includes("кошик") || t.includes("корзин"))
        );
      });
      if (toastLike) return "added";

      const captchaNeeded = await this._hasCaptcha();
      if (captchaNeeded) return "captcha";

      await sleep(120);
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
      hasBrowser: !!this.browser,
      hasPage: !!this.page && this.page.isClosed?.() !== true,
      pageUrl: this.page?.url?.() || null,
    };
  }
}

module.exports = { BotController };
