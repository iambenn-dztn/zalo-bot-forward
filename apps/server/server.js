#!/usr/bin/env node
// server.js — Entry point chạy trên server (không cần Electron)
// Giao tiếp qua HTTP + WebSocket thay vì IPC

const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");
const Bot = require("@zalo-bot/core");

const PORT = parseInt(process.env.PORT || "3005", 10);
const CONFIG_FILE = path.join(process.cwd(), "config.json");

let bot = null;
let lastQrScreenshot = null; // Buffer PNG mới nhất khi chờ QR
let logs = []; // Lưu 200 dòng log gần nhất
let wsClients = new Set();

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function broadcast(type, data) {
  const msg = JSON.stringify({ type, data, ts: Date.now() });
  for (const ws of wsClients) {
    if (ws.readyState === 1 /* OPEN */) ws.send(msg);
  }
}

function addLog(type, data) {
  const entry = { type, data, ts: Date.now() };
  logs.push(entry);
  if (logs.length > 200) logs.shift();
  broadcast(type, data);
  const prefix = type === "error" ? "❌" : type === "status" ? "ℹ️" : "📝";
  console.log(`${prefix} ${data}`);
}

function loadConfig() {
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
      return cfg;
    } catch (e) {
      console.error("[server] config.json lỗi parse:", e.message);
    }
  }
  // Fallback sang biến môi trường
  return {
    sourceGroup: process.env.SOURCE_GROUP || "",
    targetGroups: (process.env.TARGET_GROUPS || "").split("\n").filter(Boolean),
    forwardInterval: parseInt(process.env.FORWARD_INTERVAL || "60000", 10),
    chromePath: process.env.CHROME_PATH || undefined,
  };
}

async function startBot(config) {
  if (bot) {
    await bot.stop().catch(() => {});
    bot = null;
  }

  if (
    !config.sourceGroup ||
    !config.targetGroups ||
    config.targetGroups.length === 0
  ) {
    throw new Error("Thiếu sourceGroup hoặc targetGroups trong config");
  }

  const cfg = { ...config, serverMode: true };
  bot = new Bot(cfg);

  bot.on("status", (msg) => addLog("status", msg));
  bot.on("log", (msg) => addLog("log", msg));
  bot.on("error", (msg) => addLog("error", msg));
  bot.on("qr-screenshot", (buf) => {
    lastQrScreenshot = buf;
    broadcast("qr-available", null);
  });

  // Chạy nền — không await
  bot.start().catch((err) => addLog("error", `Bot crashed: ${err.message}`));
}

function clearSession() {
  const toDelete = [
    path.join(process.cwd(), "zalo_session"),
    path.join(process.cwd(), "bot_state.json"),
    path.join(process.cwd(), "messages.json"),
    path.join(process.cwd(), "images"),
  ];
  for (const p of toDelete) {
    if (!fs.existsSync(p)) continue;
    if (fs.lstatSync(p).isDirectory()) {
      fs.rmSync(p, { recursive: true, force: true });
    } else {
      fs.unlinkSync(p);
    }
  }
}

// ─── STATUS PAGE HTML ─────────────────────────────────────────────────────────

const STATUS_HTML = `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Zalo Bot Forward</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:"Segoe UI",Tahoma,Geneva,Verdana,sans-serif;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);min-height:100vh;padding:20px;color:#333}
.container{max-width:850px;margin:0 auto;background:#fff;border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,.2);overflow:hidden}
.header{background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:#fff;padding:30px;text-align:center}
.header h1{font-size:32px;margin-bottom:8px}
.subtitle{font-size:14px;opacity:.9}
.config-section{padding:30px;border-bottom:2px solid #f0f0f0}
.qr-section{padding:24px 30px;background:#eff6ff;border-bottom:2px solid #bfdbfe;text-align:center;display:none}
.qr-section h3{font-size:16px;color:#1d4ed8;margin-bottom:4px}
.qr-section p{font-size:13px;color:#3b82f6;margin-bottom:16px}
#qrImg{max-width:280px;border:3px solid #3b82f6;border-radius:8px;animation:qrpulse 2s ease-in-out infinite}
@keyframes qrpulse{0%,100%{box-shadow:0 0 0 0 rgba(59,130,246,.4)}50%{box-shadow:0 0 0 10px rgba(59,130,246,0)}}
.session-section{padding:20px 30px;background:#fef3c7;border-bottom:2px solid #f0f0f0}
.form-group{margin-bottom:20px}
.form-group label{display:block;margin-bottom:8px;font-weight:600;color:#555;font-size:14px}
.form-group input,.form-group textarea{width:100%;padding:12px;border:2px solid #e0e0e0;border-radius:6px;font-size:14px;transition:all .3s;font-family:inherit;resize:vertical}
.form-group input:focus,.form-group textarea:focus{outline:none;border-color:#667eea;box-shadow:0 0 0 3px rgba(102,126,234,.1)}
.form-group input:disabled,.form-group textarea:disabled{background:#f5f5f5;color:#999}
.button-group{display:flex;gap:12px;margin-top:24px}
.btn{flex:1;padding:14px 24px;border:none;border-radius:6px;font-size:16px;font-weight:600;cursor:pointer;transition:all .3s}
.btn:disabled{opacity:.5;cursor:not-allowed}
.btn-start{background:#10b981;color:#fff}
.btn-start:hover:not(:disabled){background:#059669;transform:translateY(-2px);box-shadow:0 4px 12px rgba(16,185,129,.4)}
.btn-stop{background:#ef4444;color:#fff}
.btn-stop:hover:not(:disabled){background:#dc2626;transform:translateY(-2px);box-shadow:0 4px 12px rgba(239,68,68,.4)}
.btn-warning{background:#f59e0b;color:#fff;padding:12px 20px;border:none;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer;transition:all .3s;width:100%}
.btn-warning:hover{background:#d97706;transform:translateY(-2px);box-shadow:0 4px 12px rgba(245,158,11,.4)}
.helper-text{margin-top:8px;font-size:12px;color:#92400e;font-style:italic}
.status-section{padding:20px 30px;background:#f9fafb;border-bottom:2px solid #f0f0f0}
.status-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
.status-header h3{font-size:16px;color:#374151}
.status-indicator{padding:6px 12px;border-radius:20px;font-size:13px;font-weight:600}
.status-indicator.idle{background:#e5e7eb;color:#6b7280}
.status-indicator.running{background:#d1fae5;color:#065f46;animation:pulse 2s infinite}
.status-indicator.error{background:#fee2e2;color:#991b1b}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.7}}
.status-text{font-size:14px;color:#6b7280;padding:8px 0}
.log-section{padding:20px 30px 30px}
.log-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
.log-header h3{font-size:16px;color:#374151}
.btn-clear{background:none;border:1px solid #d1d5db;color:#6b7280;padding:6px 12px;border-radius:6px;font-size:12px;cursor:pointer;transition:all .2s}
.btn-clear:hover{background:#f3f4f6}
.log-container{background:#1e1e1e;border-radius:8px;padding:16px;height:300px;overflow-y:auto;font-family:"Courier New",monospace;font-size:13px}
.log-entry{padding:2px 0;color:#ccc}
.log-entry.success{color:#4ade80}
.log-entry.error{color:#f87171}
.log-entry.info{color:#93c5fd}
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>🤖 Zalo Bot Forward</h1>
    <p class="subtitle">Tự động forward tin nhắn giữa các nhóm</p>
  </div>

  <div class="config-section">
    <div class="form-group">
      <label for="sourceGroup">Nhóm nguồn (1 nhóm):</label>
      <input type="text" id="sourceGroup" placeholder="Nhập tên nhóm nguồn">
    </div>
    <div class="form-group">
      <label for="targetGroups">Nhóm đích (mỗi dòng 1 nhóm):</label>
      <textarea id="targetGroups" rows="4" placeholder="Nhóm A&#10;Nhóm B&#10;Nhóm C"></textarea>
    </div>
    <div class="form-group">
      <label for="forwardInterval">Cửa sổ lắng nghe (ms) - mặc định 60 giây:</label>
      <input type="number" id="forwardInterval" value="60000" min="10000" step="5000">
    </div>
    <div class="form-group">
      <label for="chromePath">Đường dẫn Chrome (để trống nếu dùng mặc định):</label>
      <input type="text" id="chromePath" placeholder="/usr/bin/chromium">
    </div>
    <div class="button-group">
      <button id="startBtn" class="btn btn-start" onclick="doStart()">▶ Bắt đầu</button>
      <button id="stopBtn" class="btn btn-stop" onclick="doStop()" disabled>⏹ Dừng lại</button>
    </div>
  </div>

  <div class="qr-section" id="qrSection">
    <h3>📱 Quét QR để đăng nhập Zalo</h3>
    <p>Mở Zalo trên điện thoại → Cài đặt → Quét mã QR bên dưới</p>
    <img id="qrImg" src="" alt="QR Code">
  </div>

  <div class="session-section">
    <div class="form-group">
      <label>Quản lý phiên đăng nhập:</label>
      <button class="btn btn-warning" onclick="doClear()">🗑️ Xóa session & Login mới</button>
      <p class="helper-text">Xóa session hiện tại để đăng nhập tài khoản Zalo khác</p>
    </div>
  </div>

  <div class="status-section">
    <div class="status-header">
      <h3>Trạng thái</h3>
      <span id="statusIndicator" class="status-indicator idle">⚪ Chưa chạy</span>
    </div>
    <div id="statusText" class="status-text">Nhập thông tin và nhấn "Bắt đầu" để chạy bot</div>
  </div>

  <div class="log-section">
    <div class="log-header">
      <h3>Nhật ký hoạt động</h3>
      <button class="btn-clear" onclick="clearLog()">🗑️ Xóa log</button>
    </div>
    <div id="logContainer" class="log-container">
      <div class="log-entry">Đang kết nối...</div>
    </div>
  </div>
</div>
<script>
var isRunning = false;
var qrRefreshTimer = null;

var sourceGroupInput = document.getElementById('sourceGroup');
var targetGroupsInput = document.getElementById('targetGroups');
var forwardIntervalInput = document.getElementById('forwardInterval');
var chromePathInput = document.getElementById('chromePath');
var startBtn = document.getElementById('startBtn');
var stopBtn = document.getElementById('stopBtn');
var statusIndicator = document.getElementById('statusIndicator');
var statusText = document.getElementById('statusText');
var logContainer = document.getElementById('logContainer');
var qrSection = document.getElementById('qrSection');
var qrImg = document.getElementById('qrImg');

function addLog(message, type) {
  type = type || 'info';
  var div = document.createElement('div');
  div.className = 'log-entry ' + type;
  div.textContent = '[' + new Date().toLocaleTimeString('vi-VN') + '] ' + message;
  logContainer.appendChild(div);
  logContainer.scrollTop = logContainer.scrollHeight;
}

function updateStatus(message, state) {
  statusText.textContent = message;
  statusIndicator.className = 'status-indicator ' + state;
  if (state === 'running') statusIndicator.textContent = '🟢 Đang chạy';
  else if (state === 'error') statusIndicator.textContent = '🔴 Lỗi';
  else statusIndicator.textContent = '⚪ Chưa chạy';
}

function setFormDisabled(disabled) {
  sourceGroupInput.disabled = disabled;
  targetGroupsInput.disabled = disabled;
  forwardIntervalInput.disabled = disabled;
  chromePathInput.disabled = disabled;
}

function setRunningState(running) {
  isRunning = running;
  startBtn.disabled = running;
  stopBtn.disabled = !running;
  setFormDisabled(running);
}

function showQr() {
  qrSection.style.display = 'block';
  qrImg.src = '/qr?t=' + Date.now();
  if (!qrRefreshTimer) {
    qrRefreshTimer = setInterval(function() {
      if (qrSection.style.display !== 'none') {
        qrImg.src = '/qr?t=' + Date.now();
      } else {
        clearInterval(qrRefreshTimer);
        qrRefreshTimer = null;
      }
    }, 3000);
  }
}

function hideQr() {
  qrSection.style.display = 'none';
  if (qrRefreshTimer) { clearInterval(qrRefreshTimer); qrRefreshTimer = null; }
}

function handleEvent(entry) {
  if (entry.type === 'status') {
    var d = entry.data;
    if (d.includes('dang chay') || d.includes('Bot dang chay')) {
      updateStatus(d, 'running');
      setRunningState(true);
      hideQr();
    } else if (d.includes('da dung') || d.includes('đã dừng')) {
      updateStatus(d, 'idle');
      setRunningState(false);
    } else {
      updateStatus(d, isRunning ? 'running' : 'idle');
    }
    addLog(d, 'success');
  } else if (entry.type === 'log') {
    addLog(entry.data, 'info');
  } else if (entry.type === 'error') {
    updateStatus('Lỗi: ' + entry.data, 'error');
    addLog(entry.data, 'error');
  } else if (entry.type === 'qr-available') {
    showQr();
  }
}

// Load config từ server để điền vào form
fetch('/config').then(function(r) { return r.json(); }).then(function(cfg) {
  if (cfg.sourceGroup) sourceGroupInput.value = cfg.sourceGroup;
  if (cfg.targetGroups && cfg.targetGroups.length) targetGroupsInput.value = cfg.targetGroups.join('\\n');
  if (cfg.forwardInterval) forwardIntervalInput.value = cfg.forwardInterval;
  if (cfg.chromePath) chromePathInput.value = cfg.chromePath;
}).catch(function() {});

// WebSocket — hỗ trợ cả ws:// và wss:// (Render dùng https)
var wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
var ws = new WebSocket(wsProto + '//' + location.host);

ws.onopen = function() { addLog('Đã kết nối server', 'success'); };
ws.onclose = function() {
  addLog('Mất kết nối server, đang thử lại...', 'error');
  setTimeout(function() { location.reload(); }, 3000);
};
ws.onmessage = function(e) {
  var msg = JSON.parse(e.data);
  if (msg.type === 'history') { msg.data.forEach(handleEvent); }
  else { handleEvent(msg); }
};

function doStart() {
  var sourceGroup = sourceGroupInput.value.trim();
  var targetGroups = targetGroupsInput.value.split('\\n').map(function(s) { return s.trim(); }).filter(Boolean);
  var forwardInterval = parseInt(forwardIntervalInput.value, 10);
  var chromePath = chromePathInput.value.trim();

  if (!sourceGroup || targetGroups.length === 0) {
    alert('Vui lòng nhập nhóm nguồn và ít nhất 1 nhóm đích!');
    return;
  }
  if (forwardInterval < 10000) {
    alert('Cửa sổ lắng nghe phải >= 10000ms (10 giây)!');
    return;
  }

  setRunningState(true);
  updateStatus('Đang khởi động bot...', 'running');
  addLog('Đang khởi động bot (nguồn "' + sourceGroup + '" -> ' + targetGroups.length + ' nhóm đích)...', 'info');

  fetch('/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceGroup: sourceGroup, targetGroups: targetGroups, forwardInterval: forwardInterval, chromePath: chromePath || undefined }),
  }).then(function(r) { return r.json(); }).then(function(data) {
    if (!data.ok) { addLog('Lỗi: ' + (data.error || 'Unknown'), 'error'); setRunningState(false); }
  }).catch(function(err) { addLog('Lỗi kết nối: ' + err.message, 'error'); setRunningState(false); });
}

function doStop() {
  fetch('/stop', { method: 'POST' });
  setRunningState(false);
  updateStatus('Bot đã dừng', 'idle');
  addLog('Yêu cầu dừng bot...', 'info');
  hideQr();
}

function clearLog() {
  logContainer.innerHTML = '<div class="log-entry">Log đã được xóa</div>';
}

function doClear() {
  if (isRunning) { alert('Vui lòng dừng bot trước khi xóa session!'); return; }
  if (!confirm('⚠️ Bạn có chắc muốn xóa session hiện tại?\\n\\nSau khi xóa, bạn sẽ cần quét QR code để đăng nhập lại.')) return;
  addLog('Đang xóa session...', 'info');
  fetch('/clear-session', { method: 'POST' }).then(function(r) { return r.json(); }).then(function(data) {
    if (data.ok) {
      addLog('✅ Đã xóa session, state, images và queue!', 'success');
      alert('✅ Đã xóa session thành công!\\n\\nBạn có thể khởi động bot để đăng nhập lại.');
    } else {
      addLog('Lỗi xóa session: ' + data.error, 'error');
    }
  });
}
</script>
</body>
</html>`;

// ─── HTTP SERVER ──────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://localhost`);

  // GET /
  if (req.method === "GET" && urlObj.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(STATUS_HTML);
    return;
  }

  // GET /config — trả về config hiện tại để điền vào form
  if (req.method === "GET" && urlObj.pathname === "/config") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(loadConfig()));
    return;
  }

  // GET /qr — chụp screenshot trang hiện tại (dùng khi chờ QR login)
  if (req.method === "GET" && urlObj.pathname === "/qr") {
    if (bot && bot.page) {
      try {
        const screenshot = await bot.page.screenshot({ type: "png" });
        res.writeHead(200, {
          "Content-Type": "image/png",
          "Cache-Control": "no-cache, no-store",
        });
        res.end(screenshot);
        return;
      } catch {
        /* fallthrough to lastQrScreenshot */
      }
    }
    if (lastQrScreenshot) {
      res.writeHead(200, {
        "Content-Type": "image/png",
        "Cache-Control": "no-cache, no-store",
      });
      res.end(lastQrScreenshot);
      return;
    }
    res.writeHead(404);
    res.end("No QR available");
    return;
  }

  // GET /status — JSON
  if (req.method === "GET" && urlObj.pathname === "/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        running: bot ? bot.running : false,
        queueLength: bot ? bot.messageQueue.length : 0,
        logs: logs.slice(-50),
      }),
    );
    return;
  }

  // POST /start
  if (req.method === "POST" && urlObj.pathname === "/start") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", async () => {
      let config;
      try {
        config = body.trim() ? JSON.parse(body) : loadConfig();
      } catch {
        config = loadConfig();
      }
      try {
        await startBot(config);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  // POST /stop
  if (req.method === "POST" && urlObj.pathname === "/stop") {
    if (bot) {
      await bot.stop().catch(() => {});
      bot = null;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // POST /clear-session
  if (req.method === "POST" && urlObj.pathname === "/clear-session") {
    if (bot) {
      await bot.stop().catch(() => {});
      bot = null;
    }
    try {
      clearSession();
      lastQrScreenshot = null;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, message: "Đã xóa session" }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }

  // GET /health — cho Render health check & UptimeRobot keep-alive
  if (req.method === "GET" && urlObj.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

// ─── WEBSOCKET ────────────────────────────────────────────────────────────────

const wss = new WebSocketServer({ server });
wss.on("connection", (ws) => {
  wsClients.add(ws);
  // Gửi lịch sử log cho client mới
  ws.send(JSON.stringify({ type: "history", data: logs.slice(-50) }));
  ws.on("close", () => wsClients.delete(ws));
  ws.on("error", () => wsClients.delete(ws));
});

// ─── GRACEFUL SHUTDOWN ────────────────────────────────────────────────────────

async function shutdown() {
  console.log("\n[server] Đang dừng...");
  if (bot) await bot.stop().catch(() => {});
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// ─── START ────────────────────────────────────────────────────────────────────

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[server] ▶  http://0.0.0.0:${PORT}`);

  const config = loadConfig();
  if (
    config.sourceGroup &&
    config.targetGroups &&
    config.targetGroups.length > 0
  ) {
    console.log("[server] Auto-start bot từ config...");
    startBot(config).catch((err) =>
      console.error("[server] Auto-start lỗi:", err.message),
    );
  } else {
    console.log(
      "[server] Chưa có config. Tạo config.json hoặc POST /start với body JSON.",
    );
    console.log("[server] Xem config.json.example để biết cấu trúc.");
  }
});
