const $ = (id) => document.getElementById(id);

const btnAuth = $("btnAuth");
const btnArm = $("btnArm");
const btnStop = $("btnStop");

const urlsInput = $("urls");
const tabsInput = $("tabs");
const startAtInput = $("startAt");

const dot = $("dot");
const statusTitle = $("statusTitle");
const statusDetail = $("statusDetail");

let lastSoundEvent = "";

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

const ALERT_SOUND_SRC = "./sounds/success.mp3";

function playAlert(kind) {
  if (!kind) return;

  const audio = new Audio(ALERT_SOUND_SRC);
  audio.volume = 0.8;
  audio.play().catch(() => {});
}

function maybePlayStatusSound(eventCode) {
  const soundByEventCode = {
    captcha_required: "captcha",
    added_to_cart: "added",
  };

  const soundEvent = soundByEventCode[eventCode] || "";

  if (!soundEvent) {
    lastSoundEvent = "";
    return;
  }

  if (lastSoundEvent !== soundEvent) {
    playAlert(soundEvent);
    lastSoundEvent = soundEvent;
  }
}

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

btnAuth?.addEventListener("click", async () => {
  try {
    btnAuth.disabled = true;
    const r = await invokeApi(() => window.api.auth());
    if (!r?.ok) {
      statusTitle.textContent = "Помилка";
      statusDetail.textContent = r?.error || "Не вдалося відкрити авторизацію";
      setDot("Помилка");
    }
  } catch (error) {
    statusTitle.textContent = "Помилка";
    statusDetail.textContent = error?.message || "Помилка під час авторизації";
    setDot("Помилка");
  } finally {
    btnAuth.disabled = false;
  }
});

btnArm?.addEventListener("click", async () => {
  lastSoundEvent = "";
  const payload = {
    urls: urlsInput.value.trim(),
    tabs: tabsInput.value,
    startAtLocal: startAtInput.value || null,
  };

  const r = await invokeApi(() => window.api.arm(payload));
  if (!r || r.ok !== true) {
    statusTitle.textContent = "Помилка";
    statusDetail.textContent = (r && r.error) || "Не вдалося запустити";
    setDot("Помилка");
  }
});

btnStop?.addEventListener("click", async () => {
  await invokeApi(() => window.api.stop());
});

if (window.api?.onStatus) {
  window.api.onStatus(({ status, detail, eventCode }) => {
    statusTitle.textContent = status;
    statusDetail.textContent = detail || "";
    setDot(status);
    maybePlayStatusSound(eventCode);
  });
}
