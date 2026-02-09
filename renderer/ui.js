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

function setDot(status) {
  dot.className = "dot";
  if (status.includes("Помилка")) dot.classList.add("dot-red");
  else if (status.includes("Очікую") || status.includes("Підготовка"))
    dot.classList.add("dot-yellow");
  else if (status.includes("Додано")) dot.classList.add("dot-green");
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
    prewarmSeconds: prewarmInput ? Number(prewarmInput.value || 0) : 0,
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
});
