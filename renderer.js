const { ipcRenderer } = require("electron");

// DOM Elements
const sourceGroupInput = document.getElementById("sourceGroup");
const targetGroupInput = document.getElementById("targetGroup");
const checkIntervalInput = document.getElementById("checkInterval");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const statusIndicator = document.getElementById("statusIndicator");
const statusText = document.getElementById("statusText");
const logContainer = document.getElementById("logContainer");
const clearLogBtn = document.getElementById("clearLogBtn");
const clearSessionBtn = document.getElementById("clearSessionBtn");

let isRunning = false;

// Add log entry
function addLog(message, type = "info") {
  const logEntry = document.createElement("div");
  logEntry.className = `log-entry ${type}`;
  logEntry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  logContainer.appendChild(logEntry);
  logContainer.scrollTop = logContainer.scrollHeight;
}

// Update status
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

// Start bot
startBtn.addEventListener("click", () => {
  const sourceGroup = sourceGroupInput.value.trim();
  const targetGroup = targetGroupInput.value.trim();
  const checkInterval = parseInt(checkIntervalInput.value);

  if (!sourceGroup || !targetGroup) {
    alert("Vui lòng nhập đầy đủ tên nhóm nguồn và nhóm đích!");
    return;
  }

  if (checkInterval < 1000) {
    alert("Thời gian quét phải >= 1000ms!");
    return;
  }

  isRunning = true;
  startBtn.disabled = true;
  stopBtn.disabled = false;
  sourceGroupInput.disabled = true;
  targetGroupInput.disabled = true;
  checkIntervalInput.disabled = true;

  updateStatus("Đang khởi động bot...", "running");
  addLog("Đang khởi động bot...", "info");

  ipcRenderer.send("start-bot", {
    sourceGroup,
    targetGroup,
    checkInterval,
    subId: "justj", // Hard coded
  });
});

// Stop bot
stopBtn.addEventListener("click", () => {
  ipcRenderer.send("stop-bot");
  isRunning = false;
  startBtn.disabled = false;
  stopBtn.disabled = true;
  sourceGroupInput.disabled = false;
  targetGroupInput.disabled = false;
  checkIntervalInput.disabled = false;
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

  if (confirm("⚠️ Bạn có chắc muốn xóa session hiện tại?\n\nSau khi xóa, bạn sẽ cần quét QR code để đăng nhập lại.")) {
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
  alert("✅ Đã xóa session thành công!\n\nBạn có thể khởi động bot để đăng nhập lại.");
});

ipcRenderer.on("session-clear-error", (event, message) => {
  addLog(message, "error");
  alert("❌ Lỗi khi xóa session: " + message);
});

// Initialize
addLog("Ứng dụng đã sẵn sàng", "success");
