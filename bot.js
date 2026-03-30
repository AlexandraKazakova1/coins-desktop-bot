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
  WAIT_CLOUDFLARE: "WAIT_CLOUDFLARE",
  RETRY_AFTER_CAPTCHA: "RETRY_AFTER_CAPTCHA",
  STOPPED: "STOPPED",
  ERROR: "ERROR",
  DISCONNECTED: "DISCONNECTED",
  PAGE_CLOSED: "PAGE_CLOSED",
};

const STATE_EVENT_CODE = {
  [BOT_STATES.READY]: "ready",
  [BOT_STATES.AUTH]: "auth",
  [BOT_STATES.WAIT_BUY]: "wait_buy",
  [BOT_STATES.TRY_ADD]: "try_add",
  [BOT_STATES.ARMED]: "armed",
  [BOT_STATES.PREPARE]: "prepare",
  [BOT_STATES.WAIT_START]: "wait_start",
  [BOT_STATES.ADDED]: "added_to_cart",
  [BOT_STATES.WAIT_CAPTCHA]: "captcha_required",
  [BOT_STATES.WAIT_CLOUDFLARE]: "captcha_required",
  [BOT_STATES.RETRY_AFTER_CAPTCHA]: "retry_after_cloudflare",
  [BOT_STATES.STOPPED]: "stopped",
  [BOT_STATES.ERROR]: "error",
  [BOT_STATES.DISCONNECTED]: "disconnected",
  [BOT_STATES.PAGE_CLOSED]: "page_closed",
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
  [BOT_STATES.WAIT_CLOUDFLARE]: {
    title: "Очікує підтвердження Cloudflare",
    detail: "Пройди challenge вручну. Я продовжу автоматично.",
    technical: true,
  },
  [BOT_STATES.RETRY_AFTER_CAPTCHA]: {
    title: "Повторна спроба після Cloudflare",
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

const randomBetween = (min, max) =>
  Math.floor(min + Math.random() * (max - min + 1));

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

function operaPaths() {
  return [
    "C:\\\\Program Files\\\\Opera\\\\launcher.exe",
    "C:\\\\Program Files (x86)\\\\Opera\\\\launcher.exe",
    path.join(process.env.LOCALAPPDATA || "", "Programs\\Opera\\launcher.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Programs\\Opera\\opera.exe"),
  ];
}

function firefoxPaths() {
  return [
    "C:\\\\Program Files\\\\Mozilla Firefox\\\\firefox.exe",
    "C:\\\\Program Files (x86)\\\\Mozilla Firefox\\\\firefox.exe",
    path.join(process.env.LOCALAPPDATA || "", "Mozilla Firefox\\firefox.exe"),
  ];
}

function resolveBrowserExecutable(browserType) {
  const normalized = String(browserType || "chrome").toLowerCase();
  const firefoxCandidate = firefoxPaths().find((candidatePath) =>
    fs.existsSync(candidatePath),
  );
  const chromeCandidate = chromePaths().find((candidatePath) =>
    fs.existsSync(candidatePath),
  );
  const operaCandidate = operaPaths().find((candidatePath) =>
    fs.existsSync(candidatePath),
  );

  if (normalized === "opera") return operaCandidate || chromeCandidate;
  if (normalized === "firefox") return firefoxCandidate || chromeCandidate;
  return chromeCandidate;
}

class BotController {
  constructor({ profileDir, onStatus, browser = null, page = null, ownsBrowser = true, browserType = "chrome" }) {
    this.profileDir = profileDir;
    ensureDir(profileDir);
    this.onStatus = onStatus || (() => {});
    this.browser = browser;
    this.page = page;
    this.ownsBrowser = ownsBrowser;
    this.browserType = String(browserType || "chrome").toLowerCase();
    this.tracking = false;
    this.waitingCaptcha = false;
    this.lastChallengeResolvedAt = 0;
    this.state = BOT_STATES.READY;
  }

  _status(state, detailOverride = "", eventCodeOverride = "") {
    if (this.state === BOT_STATES.ADDED && state === BOT_STATES.STOPPED) return;

    const message = STATUS_MAP[state] || { title: state, detail: "" };
    const detail = detailOverride || message.detail || "";
    const eventCode =
      eventCodeOverride || STATE_EVENT_CODE[state] || "status_update";
    this.state = state;
    this.onStatus(message.title, detail, eventCode);
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
    const isReadyToClick = async (el) => {
      if (!el) return false;
      try {
        return await el.evaluate((node) => {
          const style = window.getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          const text = (node.innerText || node.textContent || "")
            .toLowerCase()
            .trim();
          const semanticText = [
            text,
            node.getAttribute("aria-label") || "",
            node.getAttribute("title") || "",
            node.getAttribute("data-action") || "",
            node.getAttribute("href") || "",
            node.className || "",
          ]
            .join(" ")
            .toLowerCase();
          const inCartHints = ["у кошику", "в кошику", "перейти до кошика"];
          const negativeHints = [
            "очіку",
            "незабаром",
            "розпродано",
            "немає в наявності",
            "sold out",
            "unavailable",
          ];
          const buyHints = ["купити", "в кошик", "до кошика", "buy"];
          const challengeHints = [
            "я не робот",
            "i am human",
            "verify",
            "cloudflare",
            "challenge",
            "captcha",
            "recaptcha",
            "turnstile",
          ];

          const visible =
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            Number(style.opacity || 1) > 0 &&
            style.pointerEvents !== "none" &&
            rect.width > 0 &&
            rect.height > 0;

          const enabled =
            !node.hasAttribute("disabled") &&
            node.getAttribute("aria-disabled") !== "true" &&
            !String(node.className || "")
              .toLowerCase()
              .includes("disabled") &&
            !String(node.className || "")
              .toLowerCase()
              .includes("inactive");

          const looksLikeInCart = inCartHints.some((hint) => text.includes(hint));
          const looksNegative = negativeHints.some((hint) => text.includes(hint));
          const looksLikeBuyAction = buyHints.some((hint) =>
            semanticText.includes(hint),
          );
          const looksLikeCaptcha = challengeHints.some((hint) =>
            semanticText.includes(hint),
          );

          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          const topElement = document.elementFromPoint(cx, cy);
          const notCovered =
            !topElement || topElement === node || node.contains(topElement);

          return (
            visible &&
            enabled &&
            looksLikeBuyAction &&
            !looksLikeInCart &&
            !looksNegative &&
            !looksLikeCaptcha &&
            notCovered
          );
        });
      } catch {
        return false;
      }
    };

    for (const sel of BUY_SELECTORS) {
      try {
        const candidates = await this.page.$$(sel);
        for (const el of candidates) {
          if (await isReadyToClick(el)) return el;
        }
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
          const semanticText = [
            t,
            el.getAttribute("aria-label") || "",
            el.getAttribute("title") || "",
            el.getAttribute("data-action") || "",
            el.getAttribute("href") || "",
            el.className || "",
          ]
            .join(" ")
            .toLowerCase();
          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          const visible =
            style.display !== "none" &&
            style.visibility !== "hidden" &&
          Number(style.opacity || 1) > 0 &&
          rect.width > 0 &&
          rect.height > 0;
        const enabled =
          !el.hasAttribute("disabled") &&
          el.getAttribute("aria-disabled") !== "true";
          const looksLikeInCart =
            t.includes("у кошику") ||
            t.includes("в кошику") ||
            t.includes("перейти до кошика");
          const looksLikeCaptcha =
            semanticText.includes("я не робот") ||
            semanticText.includes("i am human") ||
            semanticText.includes("verify") ||
            semanticText.includes("cloudflare") ||
            semanticText.includes("challenge") ||
            semanticText.includes("captcha") ||
            semanticText.includes("recaptcha") ||
            semanticText.includes("turnstile");

          return (
            visible &&
            enabled &&
            !looksLikeInCart &&
            !looksLikeCaptcha &&
            (t.includes("купити") || t.includes("в кошик") || t.includes("buy"))
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

      const nearestControl = span?.closest("button, a, [role='button']");
      if (!nearestControl) return null;

      const style = window.getComputedStyle(nearestControl);
      const rect = nearestControl.getBoundingClientRect();
      const text = (
        nearestControl.innerText ||
        nearestControl.textContent ||
        ""
      )
        .toLowerCase()
        .trim();
      const visible =
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity || 1) > 0 &&
        rect.width > 0 &&
        rect.height > 0;
      const enabled =
        !nearestControl.hasAttribute("disabled") &&
        nearestControl.getAttribute("aria-disabled") !== "true";
      const looksLikeInCart =
        text.includes("у кошику") ||
        text.includes("в кошику") ||
        text.includes("перейти до кошика");

      return visible && enabled && !looksLikeInCart ? nearestControl : null;
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

    const executablePath = resolveBrowserExecutable(this.browserType);
    if (!executablePath) {
      throw new Error(`Браузер ${this.browserType} не знайдено на компʼютері`);
    }

    const launchOptions = {
      headless: false,
      executablePath,
      userDataDir: this.profileDir,
      defaultViewport: null,
      protocolTimeout: 24000000,
      args: ["--start-maximized"],
    };

    const isNativeFirefox = String(executablePath).toLowerCase().includes("firefox.exe");
    if (this.browserType === "firefox" && isNativeFirefox) {
      launchOptions.product = "firefox";
      launchOptions.args = [];
    }

    try {
      this.browser = await puppeteer.launch(launchOptions);
    } catch (error) {
      if (this.browserType !== "firefox") throw error;

      const chromeFallback = chromePaths().find((candidatePath) =>
        fs.existsSync(candidatePath),
      );
      if (!chromeFallback) throw error;

      this.browser = await puppeteer.launch({
        ...launchOptions,
        executablePath: chromeFallback,
        product: undefined,
        args: ["--start-maximized"],
      });
      this._status(
        BOT_STATES.AUTH,
        "Mozilla не вдалося стабільно запустити через DevTools. Використовую резервний Chromium-процес для цього профілю.",
      );
    }

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


  async openHelperTab(url = "https://coins.bank.gov.ua/") {
    await this._ensurePage();

    const helperTab = await this.browser.newPage();
    this.page = helperTab;
    try {
      await helperTab.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    } catch {
      await helperTab.goto(url, { waitUntil: "load", timeout: 60000 });
    }

    try {
      if (helperTab.bringToFront) await helperTab.bringToFront();
    } catch {}

    this._status(BOT_STATES.AUTH, "Відкрито нову вкладку. Скопіюй посилання та встав у поле вкладки.");
    return helperTab;
  }

  async openAuth() {
    await this._ensurePage();
    await this._focusCoinsTab();

    const currentUrl = this.page.url() || "";

    // Якщо вже на coins.bank.gov.ua — НЕ перезавантажуємо
    if (currentUrl.includes("coins.bank.gov.ua")) {
      const authorized = await this._isLikelyAuthorized();
      if (authorized) {
        this._status(
          BOT_STATES.AUTH,
          "Вже авторизовано ✅ Можна починати відстеження.",
        );
      } else {
        this._status(
          BOT_STATES.AUTH,
          "Браузер відкрито. Увійди вручну, якщо ще не увійшла.",
        );
      }
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
    const authorized = await this._isLikelyAuthorized();
    if (authorized) {
      this._status(
        BOT_STATES.AUTH,
        "Вже авторизовано ✅ Можна починати відстеження.",
      );
    }
  }

  async _isLikelyAuthorized() {
    if (!this.page) return false;

    try {
      const currentUrl = this.page.url?.() || "";
      if (currentUrl.includes("/cabinet") || currentUrl.includes("/profile")) {
        return true;
      }

      return await this.page.evaluate(() => {
        const text = (document.body?.innerText || "").toLowerCase();
        const signedInHints = ["вийти", "профіль", "кабінет", "мої замовлення"];
        const signedOutHints = ["увійти", "вхід", "авторизація"];

        const hasSignedInHint = signedInHints.some((hint) =>
          text.includes(hint),
        );
        const hasSignedOutHint = signedOutHints.some((hint) =>
          text.includes(hint),
        );

        return hasSignedInHint && !hasSignedOutHint;
      });
    } catch {
      return false;
    }
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
    const foundAt = Date.now();
    const timeoutAt = Date.now() + 5000;
    let btn = null;

    while (!btn && Date.now() < timeoutAt) {
      btn = await this._findBuyButton();
      if (!btn) await sleep(50);
    }

    if (!btn) throw new Error('Кнопку "Купити" не знайдено');
    const buttonSeenAt = Date.now();
    await btn.evaluate((el) =>
      el.scrollIntoView({ block: "center", inline: "center" }),
    );
    await sleep(30);

    await this._applyPostChallengeCooldown();
    await this._clickWithQuickRetries(btn, 1);

    const clickSentAt = Date.now();
    console.log(
      `[timing] button_seen=${new Date(buttonSeenAt).toISOString()} click_sent=${new Date(clickSentAt).toISOString()} delay_ms=${clickSentAt - buttonSeenAt} wait_to_find_ms=${buttonSeenAt - foundAt}`,
    );
  }

  async _clickDetectedBuyButton(btn) {
    if (!btn) throw new Error('Кнопку "Купити" не знайдено');

    const safeToClick = await btn
      .evaluate((el) => {
        const semanticText = [
          el.innerText || el.textContent || "",
          el.getAttribute("aria-label") || "",
          el.getAttribute("title") || "",
          el.getAttribute("data-action") || "",
          el.getAttribute("href") || "",
          el.className || "",
        ]
          .join(" ")
          .toLowerCase();

        const buyHints = ["купити", "в кошик", "до кошика", "buy"];
        const challengeHints = [
          "я не робот",
          "i am human",
          "verify",
          "cloudflare",
          "challenge",
          "captcha",
          "recaptcha",
          "turnstile",
        ];

        return (
          buyHints.some((hint) => semanticText.includes(hint)) &&
          !challengeHints.some((hint) => semanticText.includes(hint))
        );
      })
      .catch(() => false);

    if (!safeToClick) {
      throw new Error(
        'Знайдений елемент не схожий на кнопку "Купити" (можлива перевірка "Я не робот").',
      );
    }

    try {
      await btn.evaluate((el) =>
        el.scrollIntoView({ block: "center", inline: "center" }),
      );
    } catch {}

    await this._applyPostChallengeCooldown();
    await this._clickWithQuickRetries(btn, 1);
  }

  async _applyPostChallengeCooldown() {
    const minHumanPauseMs = 0;
    const elapsed = Date.now() - Number(this.lastChallengeResolvedAt || 0);
    if (elapsed < minHumanPauseMs) {
      await sleep(minHumanPauseMs - elapsed);
    }
  }

  async _clickWithQuickRetries(btn, maxAttempts = 3) {
    const attempts = Math.max(1, Number(maxAttempts) || 1);
    let lastError = null;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        await btn.click({ delay: 10 });
        return;
      } catch (err) {
        lastError = err;
      }

      try {
        const box = await btn.boundingBox();
        if (box) {
          await this.page.mouse.click(
            box.x + box.width / 2,
            box.y + box.height / 2,
            {
              delay: 10,
            },
          );
          return;
        }
      } catch (err) {
        lastError = err;
      }

      if (attempt < attempts) {
        await sleep(randomBetween(100, 300));
      }
    }
    if (!lastError) {
      throw new Error('Не вдалося клікнути кнопку "Купити"');
    }

    const friendly = humanizeAutomationError(lastError);
    throw new Error(friendly);
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
    await this._browser();

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

  _isSameTargetUrl(targetUrl) {
    try {
      const current = new URL(this.page?.url?.() || "");
      const target = new URL(targetUrl);
      return (
        current.origin === target.origin &&
        current.pathname === target.pathname &&
        current.search === target.search
      );
    } catch {
      return false;
    }
  }

  async _openTargetIfNeeded(url) {
    if (!this.page) return;
    if (this._isSameTargetUrl(url)) return;
    await this.page.goto(url, { waitUntil: "domcontentloaded" });
  }

  async _waitChallengeIfVisible() {
    const challengeVisible = await this._isCaptchaStillVisible();
    if (!challengeVisible) return false;

    this.waitingCaptcha = true;
    this._status(
      BOT_STATES.WAIT_CLOUDFLARE,
      "Заверши перевірку «Я людина» у вкладці. Потім продовжу автоматично.",
    );

    while (this.tracking && this.waitingCaptcha) {
      const visible = await this._isCaptchaStillVisible();
      if (!visible) break;
      await sleep(400);
    }

    this.waitingCaptcha = false;
    this.lastChallengeResolvedAt = Date.now();
    if (this.tracking) this._status(BOT_STATES.WAIT_BUY);
    return true;
  }

  async arm({ url, startAtLocal, prewarmSeconds = 5 }) {
    if (!url) throw new Error("URL обовʼязковий");
    let addedToCart = false;

    const hasStartTime = !!startAtLocal;

    await this._ensurePage();

    // ====== РЕЖИМ БЕЗ ЧАСУ (STANDBY) ======
    if (!hasStartTime) {
      if (this.tracking)
        throw new Error("Відстеження вже запущено. Натисни 'Зупинити'.");

      this.tracking = true;
      this._status(BOT_STATES.WAIT_BUY);

      await this._openTargetIfNeeded(url);

      while (this.tracking) {
        const waitedChallenge = await this._waitChallengeIfVisible();
        if (waitedChallenge) {
          await sleep(60);
          continue;
        }

        // чекаємо появу кнопки
        const btn = await this._findBuyButton();
        if (btn) {
          this._status(BOT_STATES.TRY_ADD);

          const before = await this._getCartCount();
          await this._clickDetectedBuyButton(btn);
          const result = await this._waitAddedByCartCount(before, 6000);

          if (result === "added") {
            this._status(BOT_STATES.ADDED);
            addedToCart = true;
            this.tracking = false;
            return;
          } else if (result === "captcha") {
            const retryResult = await this._waitCaptchaAndRetry(before);
            if (retryResult === "added") {
              this._status(BOT_STATES.ADDED);
              addedToCart = true;
              this.tracking = false;
              return;
            }
            this._status(
              BOT_STATES.WAIT_BUY,
              "Перевірка «Я не робот» очікує ручного завершення. Після цього продовжу чекати кнопку.",
            );
            await sleep(120);
            continue;
          } else {
            this._status(
              BOT_STATES.WAIT_BUY,
              "Клік виконано, але додавання не підтверджено. Продовжую чекати кнопку без обмеження часу.",
            );
          }
        }
        // Standby-режим: максимально щільне опитування кнопки для миттєвого кліку
        await sleep(35);
      }
      if ([BOT_STATES.WAIT_BUY, BOT_STATES.TRY_ADD].includes(this.state)) {
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
    await this._openTargetIfNeeded(url);

    // чекаємо точний старт
    this._status(BOT_STATES.WAIT_START, new Date(startAt).toLocaleString());
    while (this.tracking && Date.now() < startAt) {
      await sleep(randomBetween(30, 80));
    }
    if (!this.tracking) return;

    this._status(
      BOT_STATES.WAIT_BUY,
      "Старт! Очікую появу кнопки “Купити”",
    );

    while (this.tracking) {
      const waitedChallenge = await this._waitChallengeIfVisible();
      if (waitedChallenge) {
        await sleep(80);
        continue;
      }

      const buyButton = await this._findBuyButton();
      if (!buyButton) {
        await sleep(60);
        continue;
      }

      this._status(BOT_STATES.TRY_ADD, "Кнопка зʼявилась. Клікаю");
      const before = await this._getCartCount();
      await this._clickDetectedBuyButton(buyButton);

      const result = await this._waitAddedByCartCount(before, 6000);
      if (result === "added") {
        this._status(BOT_STATES.ADDED);
        addedToCart = true;
        this.tracking = false;
        return;
      } else if (result === "captcha") {
        const retryResult = await this._waitCaptchaAndRetry(before);
        if (retryResult === "added") {
          this._status(BOT_STATES.ADDED);
          this.tracking = false;
          return;
        }

        this._status(
          BOT_STATES.WAIT_BUY,
          "Після перевірки «Я людина» додавання не підтверджено. Продовжую чекати кнопку.",
        );
        await sleep(120);
        continue;
      }

      this._status(
        BOT_STATES.WAIT_BUY,
        "Клік виконано, але додавання не підтверджено. Продовжую чекати кнопку без обмеження часу.",
      );
      await sleep(120);
    }

    if ([BOT_STATES.WAIT_BUY, BOT_STATES.TRY_ADD].includes(this.state)) {
      this._status(BOT_STATES.STOPPED);
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

    if (!this.ownsBrowser) {
      try {
        if (this.page && this.page.isClosed?.() !== true) {
          await this.page.close();
        }
      } catch {}
      this.page = null;
      this.browser = null;
      this._status(BOT_STATES.READY);
      return;
    }

    if (this.browser) await this.browser.close();
    this.browser = null;
    this.page = null;
    this._status(BOT_STATES.READY);
  }

  async _getCartCount() {
    if (!this.page) return null;

    return await this.page.evaluate(() => {
      // Спробуємо знайти лічильник біля іконки кошика
      const uniqElements = (els) => {
        const seen = new Set();
        return els.filter((el) => {
          if (!el || seen.has(el)) return false;
          seen.add(el);
          return true;
        });
      };

      const cartCandidates = uniqElements([
        ...document.querySelectorAll("a[aria-label='кошик' i]"),
        ...document.querySelectorAll("a[aria-label*='кошик' i]"),
        ...document.querySelectorAll("a[aria-label*='cart' i]"),
        ...document.querySelectorAll("a[href*='cart' i]"),
        ...document.querySelectorAll("a[href*='kosik' i]"),
        ...document.querySelectorAll("a[href*='basket' i]"),
        ...document.querySelectorAll("a[href*='checkout' i]"),
      ]);

      const textCandidates = [];
      const pushCandidate = (text, weight = 100) => {
        const value = String(text || "")
          .replace(/\s+/g, " ")
          .trim();
        if (!value) return;
        textCandidates.push({ value, weight });
      };

      for (const link of cartCandidates) {
        pushCandidate(link.textContent, 80);
        pushCandidate(link.getAttribute("aria-label"), 85);
        pushCandidate(link.getAttribute("title"), 90);
        for (const child of link.querySelectorAll(
          ".badge, [class*='count' i], span",
        )) {
          pushCandidate(child.textContent, 10);
        }
      }

      const globalBadges = uniqElements([
        ...document.querySelectorAll(".cart_count, .cart-count, .cart__count"),
        ...document.querySelectorAll(".badge"),
        ...document.querySelectorAll("[class*='cart' i] [class*='count' i]"),
      ]);

      for (const badge of globalBadges) {
        const weight = badge.matches(".badge") ? 30 : 20;
        pushCandidate(badge.textContent, weight);
      }

      const parsed = textCandidates
        .flatMap((candidate) => {
          const numbers = candidate.value.match(/\d+/g) || [];
          return numbers
            .map((raw) => Number(raw))
            .filter((n) => Number.isFinite(n) && n > 0)
            .map((n) => ({ n, weight: candidate.weight }));
        })
        .sort((a, b) => a.weight - b.weight || a.n - b.n);

      if (parsed.length > 0) return parsed[0].n;
      return 0; // якщо не знайшли — вважаємо 0
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
    let prevButtonSignal = "";

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

      const buttonState = await this.page.evaluate((prevSignal) => {
        const controls = [
          ...document.querySelectorAll("button, a, [role='button']"),
        ];
        const addToCartHints = ["купити", "в кошик", "до кошика", "buy"];
        const inCartHints = ["у кошику", "в кошику", "перейти до кошика"];

        const tracked = controls.find((el) => {
          const t = (el.innerText || el.textContent || "").toLowerCase().trim();
          return addToCartHints.some((hint) => t.includes(hint));
        });

        if (!tracked) {
          return { changedToInCart: false, signal: prevSignal || "" };
        }

        const text = (tracked.innerText || tracked.textContent || "")
          .toLowerCase()
          .trim();
        const className = (tracked.className || "").toString().toLowerCase();
        const signal = [
          text,
          tracked.hasAttribute("disabled") ||
            tracked.getAttribute("aria-disabled") === "true",
          className.includes("active") ||
            tracked.getAttribute("aria-pressed") === "true",
        ].join("|");

        const looksInCart =
          inCartHints.some((hint) => text.includes(hint)) ||
          className.includes("active") ||
          tracked.hasAttribute("disabled") ||
          tracked.getAttribute("aria-disabled") === "true";

        const changedToInCart =
          looksInCart && !!prevSignal && prevSignal !== signal;
        return { changedToInCart, signal };
      }, prevButtonSignal);

      prevButtonSignal = buttonState.signal || prevButtonSignal;
      if (buttonState.changedToInCart) return "added";

      const captchaNeeded = await this._hasCaptcha();
      if (captchaNeeded) return "captcha";

      console.debug(
        "[waitAddedByCartCount]",
        JSON.stringify({
          beforeCount,
          nowCount,
          captchaDetected: captchaNeeded,
          inCartState,
        }),
      );

      await sleep(120);
    }

    return "unknown";
  }

  async _isCaptchaStillVisible() {
    if (!this.page) return false;

    const currentUrl = this.page.url?.() || "";
    if (
      currentUrl.includes("/cdn-cgi/challenge-platform") ||
      currentUrl.includes("challenges.cloudflare.com")
    ) {
      return true;
    }

    return this.page.evaluate(() => {
      const isVisible = (el) => {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number(style.opacity || 1) > 0 &&
          rect.width > 0 &&
          rect.height > 0
        );
      };

      const selectors = [
        "iframe[src*='challenges.cloudflare.com']",
        "iframe[src*='turnstile' i]",
        "iframe[title*='challenge' i]",
        "iframe[title*='captcha' i]",
        "iframe[src*='captcha']",
        "div.g-recaptcha",
        "textarea[name='g-recaptcha-response']",
        "[data-sitekey]",
        ".cf-turnstile",
        "[class*='cf-challenge' i]",
      ];

      return selectors.some((selector) =>
        [...document.querySelectorAll(selector)].some((el) => isVisible(el)),
      );
    });
  }

  async _waitCaptchaAndRetry(_beforeCount) {
    this.waitingCaptcha = true;
    this._status(
      BOT_STATES.WAIT_CLOUDFLARE,
      "Потрібно пройти «Я не робот» вручну. Після одного кліку автодотискання вимкнено.",
    );

    while (this.tracking && this.waitingCaptcha) {
      const visible = await this._isCaptchaStillVisible();
      if (!visible) break;

      const buyButtonBack = await this._findBuyButton().catch(() => null);
      if (buyButtonBack) break;
      await sleep(500);
    }

    if (!this.tracking) {
      this.waitingCaptcha = false;
      return "stopped";
    }

    this.waitingCaptcha = false;
    this.lastChallengeResolvedAt = Date.now();
    this._status(
      BOT_STATES.WAIT_BUY,
      "Перевірку пройдено. Очікую кнопку «Купити» без повторних автокліків.",
    );
    return "manual_done";
  }

  async _hasCaptcha() {
    if (!this.page) return false;
    return this._isCaptchaStillVisible();
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
