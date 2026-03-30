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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class WaitClickBot {
  constructor(page) {
    this.page = page;
    this.started = false;
  }

  async start() {
    this.started = true;
  }

  async stop() {
    this.started = false;
  }

  async waitAndClickBuy({ timeoutMs = 120000, pollMs = 50 } = {}) {
    if (!this.started) {
      throw new Error("Бот не запущен. Сначала вызови start().");
    }

    const deadline = Date.now() + timeoutMs;

    while (this.started && Date.now() < deadline) {
      const buyButton = await this._findBuyButton();
      if (buyButton) {
        await this._clickNow(buyButton);
        return { ok: true, clickedAt: Date.now() };
      }
      await sleep(pollMs);
    }

    if (!this.started) {
      return { ok: false, reason: "stopped" };
    }

    return { ok: false, reason: "timeout" };
  }

  async _findBuyButton() {
    const isReadyToClick = async (node) => {
      if (!node) return false;
      try {
        return await node.evaluate((el) => {
          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          const text = (el.innerText || el.textContent || "").toLowerCase().trim();
          const semanticText = [
            text,
            el.getAttribute("aria-label") || "",
            el.getAttribute("title") || "",
            el.getAttribute("data-action") || "",
            el.getAttribute("href") || "",
            el.className || "",
          ]
            .join(" ")
            .toLowerCase();
          const actionText = [
            text,
            el.getAttribute("aria-label") || "",
            el.getAttribute("title") || "",
            el.getAttribute("data-action") || "",
          ]
            .join(" ")
            .toLowerCase();
          const looksLikeInCart =
            text.includes("у кошику") ||
            text.includes("в кошику") ||
            text.includes("перейти до кошика");
          const looksNegative =
            text.includes("очіку") ||
            text.includes("незабаром") ||
            text.includes("розпродано") ||
            text.includes("немає в наявності") ||
            text.includes("sold out") ||
            text.includes("unavailable");
          const looksLikeBuyAction =
            actionText.includes("купити") ||
            actionText.includes("в кошик") ||
            actionText.includes("до кошика") ||
            actionText.includes("buy");
          const looksLikeCaptcha =
            semanticText.includes("я не робот") ||
            semanticText.includes("i am human") ||
            semanticText.includes("verify") ||
            semanticText.includes("cloudflare") ||
            semanticText.includes("challenge") ||
            semanticText.includes("captcha") ||
            semanticText.includes("recaptcha") ||
            semanticText.includes("turnstile");

          const visible =
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            Number(style.opacity || 1) > 0 &&
            style.pointerEvents !== "none" &&
            rect.width > 0 &&
            rect.height > 0;

          const enabled =
            !el.hasAttribute("disabled") &&
            el.getAttribute("aria-disabled") !== "true" &&
            !String(el.className || "").toLowerCase().includes("disabled") &&
            !String(el.className || "").toLowerCase().includes("inactive");

          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          const topElement = document.elementFromPoint(cx, cy);
          const notCovered = !topElement || topElement === el || el.contains(topElement);

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

    for (const selector of BUY_SELECTORS) {
      try {
        const nodes = await this.page.$$(selector);
        for (const node of nodes) {
          if (await isReadyToClick(node)) return node;
        }
      } catch {}
    }

    const handle = await this.page.evaluateHandle(() => {
      const controls = [...document.querySelectorAll("button, a, [role='button']")];
      const byText = controls.find((el) => {
        const text = (el.innerText || el.textContent || "").toLowerCase().trim();
        const semanticText = [
          text,
          el.getAttribute("aria-label") || "",
          el.getAttribute("title") || "",
          el.getAttribute("data-action") || "",
          el.getAttribute("href") || "",
          el.className || "",
        ]
          .join(" ")
          .toLowerCase();
        const actionText = [
          text,
          el.getAttribute("aria-label") || "",
          el.getAttribute("title") || "",
          el.getAttribute("data-action") || "",
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
          text.includes("у кошику") ||
          text.includes("в кошику") ||
          text.includes("перейти до кошика");
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
          (actionText.includes("купити") ||
            actionText.includes("в кошик") ||
            actionText.includes("buy"))
        );
      });
      return byText || null;
    });

    return handle.asElement();
  }

  async _clickNow(buttonHandle) {
    try {
      await buttonHandle.evaluate((el) =>
        el.scrollIntoView({ block: "center", inline: "center" }),
      );
    } catch {}

    try {
      await buttonHandle.click({ delay: 10 });
      return;
    } catch {}

    const box = await buttonHandle.boundingBox();
    if (!box) throw new Error('Не удалось кликнуть "Купить": кнопка недоступна.');
    await this.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, {
      delay: 10,
    });
  }
}

async function createBot({ browserWSEndpoint, targetUrl }) {
  const browser = await puppeteer.connect({ browserWSEndpoint });
  const page = await browser.newPage();
  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });

  const bot = new WaitClickBot(page);
  await bot.start();

  return { bot, browser, page };
}

module.exports = { WaitClickBot, createBot, BUY_SELECTORS };
