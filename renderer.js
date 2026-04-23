const { ipcRenderer } = require("electron");

// DOM Elements
const sourceGroupsInput = document.getElementById("sourceGroups");
const targetGroupInput = document.getElementById("targetGroup");
const checkIntervalInput = document.getElementById("checkInterval");
const forwardIntervalInput = document.getElementById("forwardInterval");
const chromePathInput = document.getElementById("chromePath");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const statusIndicator = document.getElementById("statusIndicator");
const statusText = document.getElementById("statusText");
const logContainer = document.getElementById("logContainer");
const clearLogBtn = document.getElementById("clearLogBtn");
const clearSessionBtn = document.getElementById("clearSessionBtn");

let isRunning = false;

function addLog(message, type = "info") {
  const logEntry = document.createElement("div");
  logEntry.className = `log-entry ${type}`;
  logEntry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  logContainer.appendChild(logEntry);
  logContainer.scrollTop = logContainer.scrollHeight;
}

function updateStatus(message, state = "idle") {
  statusText.textContent = message;
  statusIndicator.className = `status-indicator ${state}`;
  if (state === "running") {
    statusIndicator.textContent = "🟢 Đang chạy";
  } else if (state === "error") {
    statusIndicator.textContent = "🔴 Lỗi";
  } else {
    statusIndicator.textContent = "⚪ Chưa chạy";
  }
}

function setInputsDisabled(disabled) {
  sourceGroupsInput.disabled = disabled;
  targetGroupInput.disabled = disabled;
  checkIntervalInput.disabled = disabled;
  forwardIntervalInput.disabled = disabled;
  chromePathInput.disabled = disabled;
}

// Start bot
startBtn.addEventListener("click", () => {
  // Parse nhóm nguồn: mỗi dòng 1 nhóm, bỏ dòng trống
  const sourceGroups = sourceGroupsInput.value
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const targetGroup = targetGroupInput.value.trim();
  const checkInterval = parseInt(checkIntervalInput.value);
  const forwardInterval = parseInt(forwardIntervalInput.value);
  const chromePath = chromePathInput.value.trim();

  if (sourceGroups.length === 0 || !targetGroup) {
    alert("Vui lòng nhập ít nhất 1 nhóm nguồn và nhóm đích!");
    return;
  }
  if (checkInterval < 1000) {
    alert("Thời gian quét phải >= 1000ms!");
    return;
  }
  if (forwardInterval < 10000) {
    alert("Chu kỳ forward phải >= 10000ms (10 giây)!");
    return;
  }

  isRunning = true;
  startBtn.disabled = true;
  stopBtn.disabled = false;
  setInputsDisabled(true);

  updateStatus("Đang khởi động bot...", "running");
  addLog(`Đang khởi động bot (${sourceGroups.length} nhóm nguồn)...`, "info");

  ipcRenderer.send("start-bot", {
    sourceGroups,
    targetGroup,
    checkInterval,
    forwardInterval,
    chromePath: chromePath || undefined,
  });
});

// Stop bot
stopBtn.addEventListener("click", () => {
  ipcRenderer.send("stop-bot");
  isRunning = false;
  startBtn.disabled = false;
  stopBtn.disabled = true;
  setInputsDisabled(false);
  updateStatus("Bot đã dừng", "idle");
  addLog("Bot đã dừng", "info");
});

// Clear log
clearLogBtn.addEventListener("click", () => {
  logContainer.innerHTML = '<div class="log-entry">Log đã được xóa</div>';
});

// Clear session
clearSessionBtn.addEventListener("click", () => {
  if (isRunning) {
    alert("Vui lòng dừng bot trước khi xóa session!");
    return;
  }
  if (
    confirm(
      "⚠️ Bạn có chắc muốn xóa session hiện tại?\n\nSau khi xóa, bạn sẽ cần quét QR code để đăng nhập lại.",
    )
  ) {
    addLog("Đang xóa session...", "info");
    ipcRenderer.send("clear-session");
  }
});

// IPC Listeners
ipcRenderer.on("bot-status", (event, message) => {
  updateStatus(message, "running");
  addLog(message, "success");
});

ipcRenderer.on("bot-log", (event, message) => {
  addLog(message, "info");
});

ipcRenderer.on("bot-error", (event, message) => {
  updateStatus(`Lỗi: ${message}`, "error");
  addLog(message, "error");
});

ipcRenderer.on("session-cleared", (event, message) => {
  addLog(message, "success");
  alert(
    "✅ Đã xóa session thành công!\n\nBạn có thể khởi động bot để đăng nhập lại.",
  );
});

ipcRenderer.on("session-clear-error", (event, message) => {
  addLog(message, "error");
  alert("❌ Lỗi khi xóa session: " + message);
});

// Initialize
addLog("Ứng dụng đã sẵn sàng", "success");
