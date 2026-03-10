const $ = (id) => document.getElementById(id);

const btnAuth = $("btnAuth");
const btnArm = $("btnArm");
const btnStop = $("btnStop");

const urlInput = $("url");
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
  dot.className = "dot";
  const kind = STATUS_COLOR[status] || "idle";

  if (kind === "error") dot.classList.add("dot-red");
  else if (kind === "pending") dot.classList.add("dot-yellow");
  else if (kind === "success") dot.classList.add("dot-green");
}

btnAuth.onclick = async () => {
  const r = await window.api.auth();
  if (!r.ok) {
    statusTitle.textContent = "Помилка";
    statusDetail.textContent = r.error || "";
    setDot("Помилка");
  }
};

btnArm.onclick = async () => {
  lastSoundEvent = "";
  const payload = {
    url: urlInput.value.trim(),
    startAtLocal: startAtInput.value || null,
  };

  const r = await window.api.arm(payload);
  if (!r.ok) {
    statusTitle.textContent = "Помилка";
    statusDetail.textContent = r.error || "";
    setDot("Помилка");
  }
};

btnStop.onclick = async () => {
  await window.api.stop();
};

window.api.onStatus(({ status, detail, eventCode }) => {
  statusTitle.textContent = status;
  statusDetail.textContent = detail || "";
  setDot(status);
  maybePlayStatusSound(eventCode);
});
