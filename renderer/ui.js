const $ = (id) => document.getElementById(id);

const btnAuth = $("btnAuth");
const btnAddTab = $("btnAddTab");
const btnStartAll = $("btnStartAll");
const btnStopAll = $("btnStopAll");
const startAtInput = $("startAt");
const tabsList = $("tabsList");

const dot = $("dot");
const statusTitle = $("statusTitle");
const statusDetail = $("statusDetail");

const tabsState = new Map();

const STATUS_COLOR = {
  Готово: "idle",
  Авторизація: "pending",
  "Очікую кнопку “Купити”": "pending",
  "Кнопка доступна": "pending",
  Озброєно: "pending",
  Підготовка: "pending",
  "Очікую старт": "pending",
  "Потрібно ввести капчу": "pending",
  "Товар додано в кошик": "success",
  Зупинено: "idle",
  Помилка: "error",
  Відʼєднано: "error",
  "Page closed": "error",
};

function setDot(status) {
  const normalizedStatus = String(status || "").replace(/^\[[^\]]+\]\s*/, "");
  dot.className = "dot";
  const kind = STATUS_COLOR[normalizedStatus] || "idle";

  if (kind === "error") dot.classList.add("dot-red");
  else if (kind === "pending") dot.classList.add("dot-yellow");
  else if (kind === "success") dot.classList.add("dot-green");
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

  const card = document.createElement("div");
  card.className = "tabCard";
  card.id = `tab-card-${tabId}`;

  card.innerHTML = `
    <div class="tabRow">
      <strong>Вкладка ${tabId}</strong>
      <button class="danger" data-action="stop">Зупинити</button>
    </div>
    <input data-role="url" placeholder="https://coins.bank.gov.ua/..." value="${tab.url || ""}" />
    <div class="tabRow">
      <button data-action="start">Почати пошук кнопки «Купити»</button>
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

btnAuth?.addEventListener("click", async () => {
  try {
    btnAuth.disabled = true;
    const r = await invokeApi(() => window.api.auth());
    if (!r?.ok) {
      statusTitle.textContent = "Помилка";
      statusDetail.textContent = r?.error || "Не вдалося відкрити авторизацію";
      setDot("Помилка");
      return;
    }

    btnAddTab.disabled = false;
    btnStartAll.disabled = false;
    statusTitle.textContent = "Авторизація";
    statusDetail.textContent = "Готово. Тепер додай вкладки для цього акаунта.";
    setDot("Авторизація");
  } catch (error) {
    statusTitle.textContent = "Помилка";
    statusDetail.textContent = error?.message || "Помилка під час авторизації";
    setDot("Помилка");
  } finally {
    btnAuth.disabled = false;
  }
});

btnAddTab?.addEventListener("click", async () => {
  const r = await invokeApi(() => window.api.addTab());
  if (!r?.ok) {
    statusTitle.textContent = "Помилка";
    statusDetail.textContent = r?.error || "Не вдалося додати вкладку";
    setDot("Помилка");
    return;
  }

  tabsState.set(r.tabId, {
    id: r.tabId,
    url: "",
    status: "Готово",
    detail: "Скопіюй посилання з нової вкладки браузера та встав сюди.",
  });
  renderTab(r.tabId);
  statusTitle.textContent = "Вкладку додано";
  statusDetail.textContent = "У браузері відкрито нову вкладку. Скопіюй URL та встав у поле вкладки.";
  setDot("Готово");
});

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
      tabsState.set(tabId, { id: tabId, url: "", status: "Готово", detail: "" });
      renderTab(tabId);
    }
    updateTabStatus(tabId, status, detail);
  });
}
