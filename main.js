const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const Bot = require("./bot");
let mainWindow;
let bot = null;

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
    const toDelete = [
      path.join(__dirname, "zalo_session"),
      path.join(__dirname, "bot_state.json"),
      path.join(__dirname, "messages.json"),
      path.join(__dirname, "images"),
    ];
    for (const p of toDelete) {
      if (!fs.existsSync(p)) continue;
      if (fs.lstatSync(p).isDirectory()) {
        fs.rmSync(p, { recursive: true, force: true });
      } else {
        fs.unlinkSync(p);
      }
    }
    event.reply(
      "session-cleared",
      "✅ Đã xóa session, state, images và queue!",
    );
  } catch (error) {
    event.reply("session-clear-error", error.message);
  }
});
