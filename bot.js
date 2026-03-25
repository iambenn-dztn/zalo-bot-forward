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

    // Validation
    if (!this.sourceGroup || !this.targetGroup) {
      console.error("❌ Lỗi: Nhóm nguồn hoặc nhóm đích không được để trống!");
    }

    if (this.sourceGroup === this.targetGroup) {
      console.warn("⚠️ Cảnh báo: Nhóm nguồn và nhóm đích giống nhau!");
    }

    this.checkInterval = config.checkInterval || 3000;
    this.browser = null;
    this.page = null;
    this.intervalId = null;
    this.lastMessage = "";
    this.scanCount = 0;
    this.sessionPath = "./zalo_session";
    this.stateFilePath = "./bot_state.json";

    // Debounce mechanism
    this.pendingMessages = []; // Mảng chứa tin nhắn chờ gửi
    this.debounceTimer = null; // Timer cho debounce
    this.debounceDelay = 5000; // 5 giây debounce

    // Đọc last message từ file khi khởi tạo
    this.loadLastMessage();
  }

  // Lưu tin nhắn cuối cùng vào file
  saveLastMessage(message) {
    try {
      const state = {
        lastMessage: message,
        timestamp: new Date().toISOString(),
        sourceGroup: this.sourceGroup,
        targetGroup: this.targetGroup,
      };
      fs.writeFileSync(this.stateFilePath, JSON.stringify(state, null, 2));
    } catch (error) {
      this.emit("log", `⚠️ Không thể lưu state: ${error.message}`);
    }
  }

  // Đọc tin nhắn cuối cùng từ file
  loadLastMessage() {
    try {
      if (fs.existsSync(this.stateFilePath)) {
        const state = JSON.parse(fs.readFileSync(this.stateFilePath, "utf8"));
        if (state.lastMessage) {
          this.lastMessage = state.lastMessage;
          this.emit("log", `📝 Đã tải tin nhắn cuối: "${this.lastMessage}"`);
        }
      }
    } catch (error) {
      this.emit("log", `⚠️ Không thể đọc state: ${error.message}`);
    }
  }

  // Gửi tất cả tin nhắn đang chờ
  async sendPendingMessages() {
    if (this.pendingMessages.length === 0) return;

    const messagesToSend = [...this.pendingMessages];
    this.pendingMessages = [];

    this.emit(
      "log",
      `📤 Đang gửi ${messagesToSend.length} tin nhắn đã batch...`,
    );

    try {
      // Verify đang ở nhóm nguồn trước khi navigate
      this.emit("log", `🔍 Đang tìm nhóm đích: "${this.targetGroup}"...`);

      // Navigate đến nhóm đích - GIỐNG CODE TÌM NHÓM NGUỒN
      await this.page.type("#contact-search-input", this.targetGroup);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await this.page.keyboard.press("Enter");
      await new Promise((resolve) => setTimeout(resolve, 2500));

      const searchInput = await this.page.$("#contact-search-input");
      await searchInput.click({ clickCount: 3 });
      await this.page.keyboard.press("Backspace");
      await new Promise((resolve) => setTimeout(resolve, 500));

      this.emit("log", `✓ Đã vào nhóm đích "${this.targetGroup}"`);

      // Gửi từng tin nhắn
      for (let i = 0; i < messagesToSend.length; i++) {
        const msg = messagesToSend[i];

        this.emit(
          "log",
          `  ${i + 1}/${messagesToSend.length}. Gửi: "${msg.substring(0, 50)}${msg.length > 50 ? "..." : ""}"`,
        );

        try {
          const richInput = await this.page.$("#richInput");
          if (!richInput) {
            this.emit("error", "Không tìm thấy input box");
            continue;
          }

          await richInput.click();
          await new Promise((resolve) => setTimeout(resolve, 500));

          // Clear input trước
          await this.page.keyboard.down("Control");
          await this.page.keyboard.press("KeyA");
          await this.page.keyboard.up("Control");
          await this.page.keyboard.press("Backspace");
          await new Promise((resolve) => setTimeout(resolve, 200));

          // Xử lý tin nhắn nhiều dòng
          if (msg.includes("\n")) {
            // Chia tin nhắn thành từng dòng và gửi với Shift+Enter
            const lines = msg.split("\n");
            for (let j = 0; j < lines.length; j++) {
              if (lines[j]) {
                await richInput.type(lines[j], { delay: 20 });
              }
              // Nếu không phải dòng cuối, nhấn Shift+Enter để xuống dòng
              if (j < lines.length - 1) {
                await this.page.keyboard.down("Shift");
                await this.page.keyboard.press("Enter");
                await this.page.keyboard.up("Shift");
                await new Promise((resolve) => setTimeout(resolve, 100));
              }
            }
          } else {
            // Tin nhắn 1 dòng, type bình thường
            await richInput.type(msg, { delay: 30 });
          }

          await new Promise((resolve) => setTimeout(resolve, 500));
          await this.page.keyboard.press("Enter");
          await new Promise((resolve) => setTimeout(resolve, 1500));
        } catch (error) {
          this.emit("error", `Lỗi gửi tin ${i + 1}: ${error.message}`);
        }
      }

      this.emit(
        "log",
        `✅ Đã gửi ${messagesToSend.length} tin nhắn đến "${this.targetGroup}"\n`,
      );

      // Navigate back về nhóm nguồn
      await this.navigateBackToSource();
    } catch (error) {
      this.emit("error", `❌ Lỗi khi gửi batch: ${error.message}`);
      // Cố gắng quay lại nhóm nguồn
      await this.navigateBackToSource();
    }
  }

  // Navigate về nhóm nguồn
  async navigateBackToSource() {
    try {
      this.emit("log", `🔙 Đang quay về nhóm nguồn: "${this.sourceGroup}"...`);

      // GIỐNG CODE TÌM NHÓM NGUỒN
      await this.page.type("#contact-search-input", this.sourceGroup);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await this.page.keyboard.press("Enter");
      await new Promise((resolve) => setTimeout(resolve, 2500));

      const searchInput = await this.page.$("#contact-search-input");
      await searchInput.click({ clickCount: 3 });
      await this.page.keyboard.press("Backspace");
      await new Promise((resolve) => setTimeout(resolve, 500));

      this.emit("log", `✓ Đã về nhóm nguồn\n`);
    } catch (error) {
      this.emit("error", `Lỗi khi về nhóm nguồn: ${error.message}`);
    }
  }

  async start() {
    try {
      // Debug: Log config
      this.emit(
        "log",
        `📋 Config - Nhóm nguồn: "${this.sourceGroup}", Nhóm đích: "${this.targetGroup}"`,
      );

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

      // Hiển thị tin nhắn cuối đã lưu nếu có
      if (this.lastMessage) {
        this.emit("log", `ℹ️ Tin nhắn cuối đã forward: "${this.lastMessage}"`);
        this.emit(
          "log",
          "📍 Bot sẽ bỏ qua tin nhắn này nếu vẫn còn là tin mới nhất\n",
        );
      }

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
                // Thử innerText trước (giữ nguyên newlines)
                let text = textSpan.innerText;

                // Nếu không có innerText, dùng cách parse HTML
                if (!text || text.trim() === "") {
                  let html = textSpan.innerHTML;
                  html = html.replace(/<br\s*\/?>/gi, "\n");
                  html = html.replace(/<\/(div|p)>/gi, "\n");
                  html = html.replace(/<[^>]*>/g, "");
                  const txt = document.createElement("textarea");
                  txt.innerHTML = html;
                  text = txt.value;
                }

                text = text.trim();
                if (text) return text;
              }
            }
          }
          return "";
        });

        if (currentMsg && currentMsg !== this.lastMessage) {
          this.emit("log", `📨 Tin nhắn mới: "${currentMsg}"`);

          this.lastMessage = currentMsg;

          // Lưu tin nhắn mới vào file
          this.saveLastMessage(currentMsg);

          // Thêm tin nhắn vào pending queue
          this.pendingMessages.push(currentMsg);
          this.emit(
            "log",
            `⏳ Đã thêm vào queue (${this.pendingMessages.length} tin nhắn chờ)`,
          );

          // Clear timer cũ và set timer mới (debounce)
          if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
          }

          this.debounceTimer = setTimeout(async () => {
            this.emit("log", `⏰ Hết thời gian debounce (5s), bắt đầu gửi...`);
            await this.sendPendingMessages();
          }, this.debounceDelay);
        }
      } catch (error) {
        if (!error.message.includes("detached Frame")) {
          this.emit("error", `❌ ${error.message}`);
        }
      }
    }, this.checkInterval);
  }

  async stop() {
    // Clear debounce timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    // Gửi tin nhắn còn lại nếu có
    if (this.pendingMessages.length > 0) {
      this.emit(
        "log",
        `⚠️ Còn ${this.pendingMessages.length} tin nhắn chưa gửi, đang gửi...`,
      );
      await this.sendPendingMessages();
    }

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }

    // Lưu state trước khi dừng
    if (this.lastMessage) {
      this.saveLastMessage(this.lastMessage);
      this.emit("log", `💾 Đã lưu tin nhắn cuối: "${this.lastMessage}"`);
    }

    this.emit("status", "Bot đã dừng");
  }
}

module.exports = Bot;
