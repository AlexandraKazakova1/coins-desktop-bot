const $ = (id) => document.getElementById(id);

const btnAuth = $("btnAuth");
const btnArm = $("btnArm");
const btnStop = $("btnStop");

const urlInput = $("url");
const startAtInput = $("startAt");
const prewarmInput = $("prewarm" || null);

const dot = $("dot");
const statusTitle = $("statusTitle");
const statusDetail = $("statusDetail");

let lastSoundEvent = "";

function playAlert(kind) {
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  const scheduleBeep = (frequency, delay = 0, duration = 0.18) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = "sine";
    osc.frequency.value = frequency;

    gain.gain.setValueAtTime(0.0001, audioCtx.currentTime + delay);
    gain.gain.exponentialRampToValueAtTime(
      0.2,
      audioCtx.currentTime + delay + 0.01,
    );
    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      audioCtx.currentTime + delay + duration,
    );

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start(audioCtx.currentTime + delay);
    osc.stop(audioCtx.currentTime + delay + duration + 0.02);
  };

  if (kind === "captcha") {
    scheduleBeep(520, 0, 0.16);
    scheduleBeep(420, 0.2, 0.16);
    scheduleBeep(520, 0.4, 0.16);
  } else if (kind === "added") {
    scheduleBeep(640, 0, 0.12);
    scheduleBeep(820, 0.16, 0.2);
  }

  setTimeout(() => audioCtx.close().catch(() => {}), 1200);
}

function maybePlayStatusSound(status) {
  const normalized = (status || "").toLowerCase();

  if (normalized.includes("потрібно ввести капчу")) {
    if (lastSoundEvent !== "captcha") {
      playAlert("captcha");
      lastSoundEvent = "captcha";
    }
    return;
  }

  if (normalized.includes("товар додано в кошик")) {
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
  if (status.includes("Помилка")) dot.classList.add("dot-red");
  else if (status.includes("Очікую") || status.includes("Підготовка"))
    dot.classList.add("dot-yellow");
  else if (status.includes("Додано")) dot.classList.add("dot-green");
  else if (status.includes("додано") || status.includes("Додано"))
    dot.classList.add("dot-green");
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
