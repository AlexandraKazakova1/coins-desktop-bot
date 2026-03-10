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

function playAudioWithFallback(sources) {
  const [current, ...rest] = sources;
  if (!current) return;

  const audio = new Audio(current);
  audio.volume = 0.8;

  audio.addEventListener(
    "error",
    () => {
      if (rest.length) playAudioWithFallback(rest);
    },
    { once: true },
  );

  audio.play().catch(() => {
    if (rest.length) playAudioWithFallback(rest);
  });
}

function playAlert(kind) {
  const sourcesByKind = {
    captcha: ["/sounds/success.mp3", "./sounds/captcha-alert.wav"],
    added: ["/sounds/success.mp3", "./sounds/cart-added.wav"],
  };

  const sources = sourcesByKind[kind];
  if (!sources) return;

  playAudioWithFallback(sources);
}

function maybePlayStatusSound(status) {
  const normalized = (status || "").toLowerCase();

  if (
    normalized.includes("потрібно ввести капчу") ||
    normalized.includes("введи капчу")
  ) {
    if (lastSoundEvent !== "captcha") {
      playAlert("captcha");
      lastSoundEvent = "captcha";
    }
    return;
  }

  if (
    normalized.includes("товар додано в кошик") ||
    normalized.includes("додано в кошик") ||
    normalized.includes("додано до кошика")
  ) {
    if (lastSoundEvent !== "added") {
      playAlert("added");
      lastSoundEvent = "added";
    }
    return;
  }

  if (!normalized.includes("потрібно") && !normalized.includes("додано")) {
    lastSoundEvent = "";
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

window.api.onStatus(({ status, detail }) => {
  statusTitle.textContent = status;
  statusDetail.textContent = detail || "";
  setDot(status);
  maybePlayStatusSound(status);
});
