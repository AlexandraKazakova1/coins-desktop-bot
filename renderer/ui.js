const $ = (id) => document.getElementById(id);

const btnAuth = $("btnAuth");
const btnArm = $("btnArm");
const btnStop = $("btnStop");

const urlInput = $("url");
const startAtInput = $("startAt");
const dot = $("dot");
const statusTitle = $("statusTitle");
const statusDetail = $("statusDetail");

function setDot(status) {
  const normalized = (status || "").toLowerCase();

  dot.className = "dot";
  if (normalized.includes("помилка")) dot.classList.add("dot-red");
  else if (normalized.includes("очікую") || normalized.includes("підготовка") || normalized.includes("standby") || normalized.includes("озброєно"))
    dot.classList.add("dot-yellow");
  else if (normalized.includes("додано")) dot.classList.add("dot-green");
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
});
