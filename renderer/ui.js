const $ = (id) => document.getElementById(id);

const btnStartAll = $("btnStartAll");
const btnStopAll = $("btnStopAll");
const btnChrome = $("btnChrome");
const btnOpera = $("btnOpera");
const btnEdge = $("btnEdge");
const chromeCount = $("chromeCount");
const operaCount = $("operaCount");
const edgeCount = $("edgeCount");
const startAtInput = $("startAt");
const tabsList = $("tabsList");

const dot = $("dot");
const statusTitle = $("statusTitle");
const statusDetail = $("statusDetail");

const tabsState = new Map();
const MAX_PER_BROWSER = 3;
const lastAlertAtByTab = new Map();

const BROWSER_LABEL = {
  chrome: "Chrome",
  opera: "Opera",
  edge: "Edge",
};

const STATUS_COLOR = {
  Готово: "idle",
  Авторизація: "pending",
  "Очікую кнопку “Купити”": "pending",
  "Кнопка доступна": "pending",
  Озброєно: "pending",
  Підготовка: "pending",
  "Очікую старт": "pending",
  "Потрібно ввести капчу": "pending",
  "Очікує підтвердження Cloudflare": "pending",
  "Повторна спроба після Cloudflare": "pending",
  "Товар додано в кошик": "success",
  Зупинено: "idle",
  Помилка: "error",
  "Відʼєднано": "error",
  "Page closed": "error",
};

function countTabsByBrowser(type) {
  return [...tabsState.values()].filter((tab) => tab.browserType === type).length;
}

function updateBrowserCounters() {
  chromeCount.textContent = `${countTabsByBrowser("chrome")}/${MAX_PER_BROWSER} вкладок`;
  operaCount.textContent = `${countTabsByBrowser("opera")}/${MAX_PER_BROWSER} вкладок`;
  edgeCount.textContent = `${countTabsByBrowser("edge")}/${MAX_PER_BROWSER} вкладок`;

  btnChrome.disabled = countTabsByBrowser("chrome") >= MAX_PER_BROWSER;
  btnOpera.disabled = countTabsByBrowser("opera") >= MAX_PER_BROWSER;
  btnEdge.disabled = countTabsByBrowser("edge") >= MAX_PER_BROWSER;
}

function setDot(status) {
  const normalizedStatus = String(status || "").replace(/^\[[^\]]+\]\s*/, "");
  dot.className = "dot";
  const kind = STATUS_COLOR[normalizedStatus] || "idle";

  if (kind === "error") dot.classList.add("dot-red");
  else if (kind === "pending") dot.classList.add("dot-yellow");
  else if (kind === "success") dot.classList.add("dot-green");
}

function playAlertBeep() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;

  const ctx = new AudioContextClass();
  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();

  oscillator.type = "sine";
  oscillator.frequency.value = 880;
  gainNode.gain.value = 0.03;

  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination);
  oscillator.start();
  oscillator.stop(ctx.currentTime + 0.35);
  oscillator.onended = () => ctx.close().catch(() => {});
}

async function invokeApi(call) {
  if (!window.api) {
    throw new Error("API не ініціалізовано. Перезапусти застосунок.");
  }
  return call();
}

function renderTab(tabId) {
  const tab = tabsState.get(tabId);
  if (!tab) return;

  const tabNumberInBrowser = [...tabsState.values()]
    .filter((item) => item.browserType === tab.browserType)
    .sort((a, b) => a.id - b.id)
    .findIndex((item) => item.id === tabId) + 1;

  const card = document.createElement("div");
  card.className = "tabCard";
  card.id = `tab-card-${tabId}`;

  card.innerHTML = `
    <div class="tabRow">
      <strong>${BROWSER_LABEL[tab.browserType] || "Браузер"} • Вкладка ${tabNumberInBrowser}</strong>
      <div class="tabActions">
        <button class="danger" data-action="stop">Зупинити</button>
        <button class="tabCloseBtn" data-action="remove" title="Закрити вкладку">✕</button>
      </div>
    </div>
    <input data-role="url" placeholder="https://coins.bank.gov.ua/..." value="${tab.url || ""}" />
    <div class="tabRow">
      <button data-action="start">Очікування кнопки купити</button>
      <span data-role="status" class="tabStatus">${tab.status || "Готово"}</span>
    </div>
    <div data-role="detail" class="statusDetail">${tab.detail || ""}</div>
  `;

  card.querySelector('[data-action="start"]').addEventListener("click", async () => {
    const url = card.querySelector('[data-role="url"]').value.trim();
    tabsState.set(tabId, { ...tabsState.get(tabId), url });

    const r = await invokeApi(() =>
      window.api.startTab({
        tabId,
        url,
        startAtLocal: startAtInput.value || null,
      }),
    );

    if (!r?.ok) {
      updateTabStatus(tabId, "Помилка", r?.error || "Не вдалося запустити", "error");
    }
  });

  card.querySelector('[data-action="stop"]').addEventListener("click", async () => {
    await invokeApi(() => window.api.stopTab({ tabId }));
  });

  card.querySelector('[data-action="remove"]').addEventListener("click", async () => {
    const r = await invokeApi(() => window.api.removeTab({ tabId }));
    if (!r?.ok) {
      updateTabStatus(
        tabId,
        "Помилка",
        r?.error || "Не вдалося закрити вкладку",
        "error",
      );
      return;
    }

    tabsState.delete(tabId);
    lastAlertAtByTab.delete(tabId);
    const currentCard = $(`tab-card-${tabId}`);
    if (currentCard) currentCard.remove();

    updateBrowserCounters();

    const browserType = tab.browserType;
    statusTitle.textContent = "Вкладку видалено";
    statusDetail.textContent = `${
      BROWSER_LABEL[browserType] || "Браузер"
    }: залишилось ${countTabsByBrowser(browserType)}/${MAX_PER_BROWSER} вкладок.`;
    setDot("Готово");

    const sorted = [...tabsState.values()]
      .filter((item) => item.browserType === browserType)
      .sort((a, b) => a.id - b.id);
    for (const item of sorted) {
      renderTab(item.id);
    }
  });

  const existing = $(card.id);
  if (existing) existing.replaceWith(card);
  else tabsList.appendChild(card);
}

function updateTabStatus(tabId, status, detail = "") {
  const tab = tabsState.get(tabId);
  if (!tab) return;

  tabsState.set(tabId, { ...tab, status, detail });

  const card = $(`tab-card-${tabId}`);
  if (!card) return;

  const statusEl = card.querySelector('[data-role="status"]');
  const detailEl = card.querySelector('[data-role="detail"]');
  if (statusEl) statusEl.textContent = status;
  if (detailEl) detailEl.textContent = detail || "";
}

async function openBrowserTab(browserType) {
  const r = await invokeApi(() => window.api.addTab({ browserType }));
  if (!r?.ok) {
    statusTitle.textContent = "Помилка";
    statusDetail.textContent = r?.error || "Не вдалося відкрити вкладку браузера";
    setDot("Помилка");
    return;
  }

  tabsState.set(r.tabId, {
    id: r.tabId,
    browserType: r.browserType || browserType,
    url: "",
    status: "Готово",
    detail: "Скопіюй посилання з цієї вкладки браузера та встав сюди.",
  });

  renderTab(r.tabId);
  updateBrowserCounters();

  const browserTabs = countTabsByBrowser(r.browserType || browserType);
  statusTitle.textContent = `${BROWSER_LABEL[r.browserType || browserType]}: вкладку відкрито`;
  statusDetail.textContent = `Відкрито ${browserTabs}/${MAX_PER_BROWSER} вкладок. Авторизуйся, відкрий монету, скопіюй URL та встав у форму.`;
  setDot("Авторизація");
}

btnChrome?.addEventListener("click", async () => openBrowserTab("chrome"));
btnOpera?.addEventListener("click", async () => openBrowserTab("opera"));
btnEdge?.addEventListener("click", async () => openBrowserTab("edge"));

btnStartAll?.addEventListener("click", async () => {
  const tabIds = [...tabsState.keys()];
  const urlsByTab = {};

  for (const tabId of tabIds) {
    const card = $(`tab-card-${tabId}`);
    if (!card) continue;
    const url = card.querySelector('[data-role="url"]').value.trim();
    urlsByTab[String(tabId)] = url;
    tabsState.set(tabId, { ...tabsState.get(tabId), url });
  }

  const r = await invokeApi(() =>
    window.api.startAllTabs({
      tabIds,
      urlsByTab,
      startAtLocal: startAtInput.value || null,
    }),
  );

  if (!r?.ok) {
    statusTitle.textContent = "Помилка";
    statusDetail.textContent = r?.error || "Не вдалося запустити всі вкладки";
    setDot("Помилка");
  }
});

btnStopAll?.addEventListener("click", async () => {
  await invokeApi(() => window.api.stop());
  for (const tabId of tabsState.keys()) {
    updateTabStatus(tabId, "Готово", "Зупинено");
  }
});

if (window.api?.onStatus) {
  window.api.onStatus(({ status, detail }) => {
    statusTitle.textContent = status;
    statusDetail.textContent = detail || "";
    setDot(status);
  });
}

if (window.api?.onTabStatus) {
  window.api.onTabStatus(({ tabId, status, detail }) => {
    if (!tabsState.has(tabId)) {
      tabsState.set(tabId, {
        id: tabId,
        browserType: "chrome",
        url: "",
        status: "Готово",
        detail: "",
      });
      renderTab(tabId);
    }
    updateTabStatus(tabId, status, detail);

    const needsManualChallenge =
      status === "Очікує підтвердження Cloudflare" ||
      String(detail || "").toLowerCase().includes("я не робот");

    if (needsManualChallenge) {
      const now = Date.now();
      const lastAt = lastAlertAtByTab.get(tabId) || 0;
      if (now - lastAt > 15000) {
        playAlertBeep();
        lastAlertAtByTab.set(tabId, now);
      }
    }
  });
}

updateBrowserCounters();
