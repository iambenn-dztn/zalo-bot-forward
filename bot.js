const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const { EventEmitter } = require("events");

puppeteer.use(StealthPlugin());

class Bot extends EventEmitter {
  constructor(config) {
    super();
    this.sourceGroup = config.sourceGroup;
    this.targetGroup = config.targetGroup;
    this.checkInterval = config.checkInterval || 3000;
    this.browser = null;
    this.page = null;
    this.intervalId = null;
    this.lastMessage = "";
    this.scanCount = 0;
    this.sessionPath = "./zalo_session";
  }

  async start() {
    try {
      const hasSession = fs.existsSync(path.join(this.sessionPath, "Default"));

      this.emit(
        "status",
        hasSession
          ? "Đang khởi động ở chế độ ẩn..."
          : "Đang khởi động... (Cần quét QR)",
      );

      // Nếu chưa có session, hiện cửa sổ để scan QR
      // Nếu đã có session, chạy headless ngay
      this.browser = await puppeteer.launch({
        headless: hasSession, // Headless nếu đã có session
        userDataDir: this.sessionPath,
        args: [
          "--start-maximized",
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-accelerated-2d-canvas",
          "--disable-gpu",
          "--disable-blink-features=AutomationControlled",
        ],
        defaultViewport: null,
      });

      this.page = await this.browser.newPage();
      await this.page.setViewport({ width: 1366, height: 768 });
      await this.page.goto("https://chat.zalo.me/", {
        waitUntil: "networkidle2",
      });

      if (!hasSession) {
        this.emit("status", "⏳ Vui lòng quét QR code để đăng nhập...");
      }

      await this.page.waitForSelector("#contact-search-input", { timeout: 0 });
      this.emit("status", "✅ Đã đăng nhập thành công");

      // Nếu vừa login lần đầu (không có session), restart với headless
      if (!hasSession) {
        this.emit("log", "Đang khởi động lại ở chế độ ẩn...");
        await this.browser.close();
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Launch lại với headless
        this.browser = await puppeteer.launch({
          headless: true,
          userDataDir: this.sessionPath,
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-accelerated-2d-canvas",
            "--disable-gpu",
            "--disable-blink-features=AutomationControlled",
          ],
        });

        this.page = await this.browser.newPage();
        await this.page.setViewport({ width: 1366, height: 768 });
        await this.page.goto("https://chat.zalo.me/", {
          waitUntil: "networkidle2",
        });
        await this.page.waitForSelector("#contact-search-input", {
          timeout: 30000,
        });
        this.emit("status", "✅ Đã chuyển sang chế độ ẩn");
      }

      this.emit("log", "Đang tìm nhóm nguồn...");

      await this.page.type("#contact-search-input", this.sourceGroup);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await this.page.keyboard.press("Enter");
      await new Promise((resolve) => setTimeout(resolve, 2500));

      const searchInput = await this.page.$("#contact-search-input");
      await searchInput.click({ clickCount: 3 });
      await this.page.keyboard.press("Backspace");
      await new Promise((resolve) => setTimeout(resolve, 500));

      this.emit("status", `✅ Đã vào nhóm "${this.sourceGroup}"`);
      this.emit("log", "Bắt đầu quét tin nhắn...\n");

      this.startScanning();
    } catch (error) {
      this.emit("error", `Lỗi khởi động: ${error.message}`);
      this.stop();
    }
  }

  startScanning() {
    this.intervalId = setInterval(async () => {
      try {
        this.scanCount++;
        this.emit(
          "log",
          `🔍 Quét lần #${this.scanCount} - ${new Date().toLocaleTimeString()}`,
        );

        const currentMsg = await this.page.evaluate(() => {
          const frames = document.querySelectorAll(".message-frame");
          for (let i = frames.length - 1; i >= 0; i--) {
            if (!frames[i].classList.contains("me")) {
              const textSpan = frames[i].querySelector("span.text");
              if (textSpan) {
                const text = (
                  textSpan.innerText ||
                  textSpan.textContent ||
                  ""
                ).trim();
                if (text) return text;
              }
            }
          }
          return "";
        });

        if (currentMsg && currentMsg !== this.lastMessage) {
          this.emit("log", `📨 Tin nhắn mới: "${currentMsg}"`);
          this.lastMessage = currentMsg;

          // Navigate to target group
          const search = await this.page.$("#contact-search-input");
          await search.click({ clickCount: 3 });
          await this.page.keyboard.press("Backspace");
          await this.page.type("#contact-search-input", this.targetGroup);
          await new Promise((resolve) => setTimeout(resolve, 1500));
          await this.page.keyboard.press("Enter");
          await new Promise((resolve) => setTimeout(resolve, 2000));

          // Send message
          await this.page.type("#richInput", `${currentMsg}`);
          await this.page.keyboard.press("Enter");
          await new Promise((resolve) => setTimeout(resolve, 1000));

          // Navigate back to source group
          const search2 = await this.page.$("#contact-search-input");
          await search2.click({ clickCount: 3 });
          await this.page.keyboard.press("Backspace");
          await this.page.type("#contact-search-input", this.sourceGroup);
          await new Promise((resolve) => setTimeout(resolve, 1500));
          await this.page.keyboard.press("Enter");
          await new Promise((resolve) => setTimeout(resolve, 2000));

          const search3 = await this.page.$("#contact-search-input");
          await search3.click({ clickCount: 3 });
          await this.page.keyboard.press("Backspace");

          this.emit(
            "log",
            `✅ Đã forward tin nhắn đến "${this.targetGroup}"\n`,
          );
        }
      } catch (error) {
        if (!error.message.includes("detached Frame")) {
          this.emit("error", `❌ ${error.message}`);
        }
      }
    }, this.checkInterval);
  }

  async stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
    this.emit("status", "Bot đã dừng");
  }
}

module.exports = Bot;
