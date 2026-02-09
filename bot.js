const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

const BUY_SELECTOR = "button.btn-primary.buy";

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

  async _browser() {
    if (this.browser) return;

    const chrome = chromePaths().find(fs.existsSync);
    if (!chrome) throw new Error("Chrome не знайдено");

    this.browser = await puppeteer.launch({
      headless: false,
      executablePath: chrome,
      userDataDir: this.profileDir,
      defaultViewport: null,
      args: ["--start-maximized"],
    });

    const pages = await this.browser.pages();
    this.page = pages[0];
    if (!this.page || this.page.isClosed()) {
      this.page = await this.browser.newPage();
    }

    await this.page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
  }

  async openAuth() {
    await this._browser();

    // Просто показуємо браузер і даємо тобі вручну зайти/перевірити сесію
    await this.page.bringToFront();

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
    await this.page.waitForSelector(BUY_SELECTOR, {
      visible: true,
      timeout: 5000,
    });
    const btn = await this.page.$(BUY_SELECTOR);
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

  async arm({ url, startAtLocal, prewarmSeconds = 5 }) {
    if (!url) throw new Error("URL обовʼязковий");

    const hasStartTime = !!startAtLocal;

    await this._browser();
    await this.page.bringToFront();

    // ====== РЕЖИМ БЕЗ ЧАСУ (STANDBY) ======
    if (!hasStartTime) {
      if (this.tracking)
        throw new Error("Відстеження вже запущено. Натисни 'Зупинити'.");

      this.tracking = true;
      this._status("Standby", "Очікую появу/активацію кнопки “Купити”");

      await this.page.goto(url, { waitUntil: "domcontentloaded" });

      while (this.tracking) {
        // чекаємо появу кнопки
        const btn = await this.page.$(BUY_SELECTOR);
        if (btn) {
          this._status("Кнопка доступна", "Клікаю");
          const before = await this._getCartCount();
          await this._fastClick();
          const added = await this._waitAddedByCartCount(before, 6000);

          if (added) {
            this._status("Товар додано в кошик", "Готово ✅");
            this.tracking = false;
          } else {
            this._status("Не підтверджено", "Перевір кошик вручну");
          }
        }

        await this._humanIdle(); // людська активність до появи кнопки
        await sleep(120);
      }

      this._status("Зупинено", "");
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
    await this._fastClick();

    const added = await this._waitAdded();
    if (added) {
      this._status("Товар додано в кошик", "Готово ✅");
      this.tracking = false;
    } else {
      this._status("Не підтверджено", "Перевір кошик вручну");
    }
  }

  async stop() {
    this.tracking = false;
    if (this.browser) await this.browser.close();
    this.browser = null;
    this.page = null;
    this._status("Зупинено");
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
        if (nowCount > beforeCount) return true;
      }

      // 2) Fallback: toast/текст “додано … кошик”
      const toastLike = await this.page.evaluate(() => {
        const t = (document.body?.innerText || "").toLowerCase();
        return (
          t.includes("додано") && (t.includes("кошик") || t.includes("корзин"))
        );
      });
      if (toastLike) return true;

      await sleep(120);
    }

    return false;
  }
}

module.exports = { BotController };
