const $ = (id) => document.getElementById(id);

const btnAuth = $("btnAuth");
const btnStart = $("btnStart");
const btnStop = $("btnStop");
const urlInput = $("url");

const dot = $("dot");
const statusTitle = $("statusTitle");
const statusDetail = $("statusDetail");

function setDot(status) {
  dot.className = "dot";
  if (status.includes("Помилка")) dot.classList.add("dot-red");
  else if (status.includes("Очікую") || status.includes("Відкриваю"))
    dot.classList.add("dot-yellow");
  else if (status.includes("Натиснуто") || status.includes("доступна"))
    dot.classList.add("dot-green");
  else if (status.includes("Потрібна перевірка"))
    dot.classList.add("dot-yellow");
}

btnAuth.onclick = async () => {
  const r = await window.api.auth();
  if (!r.ok) {
    statusTitle.textContent = "Помилка";
    statusDetail.textContent = r.error || "";
    setDot("Помилка");
  }
};

btnStart.onclick = async () => {
  const url = urlInput.value.trim();
  const r = await window.api.startTracking({ url });
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
