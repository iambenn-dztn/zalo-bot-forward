const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const Bot = require("./bot");
let mainWindow;
let bot = null;

// Xóa đúng session theo sessionId hoặc sessionPath
ipcMain.on(
  "clear-session-by-id",
  (event, { sessionId, sessionPath, stateFilePath, imagesPath }) => {
    try {
      // Ưu tiên sessionPath, nếu không có thì tạo từ sessionId
      let sessionFolder = sessionPath;
      if (!sessionFolder && sessionId) {
        sessionFolder = path.join(__dirname, `zalo_session_${sessionId}`);
      }
      if (sessionFolder && fs.existsSync(sessionFolder)) {
        fs.rmSync(sessionFolder, { recursive: true, force: true });
      }

      // Xóa file state nếu có
      let stateFile = stateFilePath;
      if (!stateFile && sessionId) {
        stateFile = path.join(__dirname, `bot_state_${sessionId}.json`);
      }
      if (stateFile && fs.existsSync(stateFile)) {
        fs.unlinkSync(stateFile);
      }

      // Xóa images folder nếu có
      let imgFolder = imagesPath;
      if (!imgFolder && sessionId) {
        imgFolder = path.join(__dirname, `images_${sessionId}`);
      }
      if (imgFolder && fs.existsSync(imgFolder)) {
        fs.rmSync(imgFolder, { recursive: true, force: true });
      }

      event.reply(
        "session-cleared",
        `✅ Đã xóa session, state và images cho phiên: ${sessionId || sessionPath}`,
      );
    } catch (error) {
      event.reply("session-clear-error", error.message);
    }
  },
);

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    resizable: false,
    icon: path.join(__dirname, "build", "icon.png"),
  });

  mainWindow.loadFile("index.html");

  // Mở DevTools khi đang develop (có thể comment dòng này)
  // mainWindow.webContents.openDevTools();

  mainWindow.on("closed", function () {
    mainWindow = null;
    if (bot) {
      bot.stop();
    }
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", function () {
  if (process.platform !== "darwin") app.quit();
});

// IPC Handlers
ipcMain.on("start-bot", async (event, config) => {
  try {
    if (bot) {
      bot.stop();
    }

    bot = new Bot(config);

    bot.on("status", (message) => {
      event.reply("bot-status", message);
    });

    bot.on("log", (message) => {
      event.reply("bot-log", message);
    });

    bot.on("error", (message) => {
      event.reply("bot-error", message);
    });

    await bot.start();
  } catch (error) {
    event.reply("bot-error", error.message);
  }
});

ipcMain.on("stop-bot", (event) => {
  if (bot) {
    bot.stop();
    event.reply("bot-status", "Bot đã dừng");
  }
});

ipcMain.on("clear-session", (event) => {
  try {
    // Xóa tất cả các folder session bắt đầu bằng zalo_session
    const sessionFolders = fs
      .readdirSync(__dirname)
      .filter((f) => f.startsWith("zalo_session"));
    for (const folder of sessionFolders) {
      const fullPath = path.join(__dirname, folder);
      if (fs.existsSync(fullPath) && fs.lstatSync(fullPath).isDirectory()) {
        fs.rmSync(fullPath, { recursive: true, force: true });
      }
    }

    // Xóa tất cả các file state bắt đầu bằng bot_state_
    const stateFiles = fs
      .readdirSync(__dirname)
      .filter((f) => f.startsWith("bot_state_") && f.endsWith(".json"));
    for (const file of stateFiles) {
      const fullPath = path.join(__dirname, file);
      if (fs.existsSync(fullPath) && fs.lstatSync(fullPath).isFile()) {
        fs.unlinkSync(fullPath);
      }
    }

    event.reply(
      "session-cleared",
      "✅ Đã xóa toàn bộ session và bot state thành công!",
    );
  } catch (error) {
    event.reply("session-clear-error", error.message);
  }
});
