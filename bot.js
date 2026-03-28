const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const { EventEmitter } = require("events");
const { transformText } = require("./util");

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

    this.checkInterval = config.checkInterval || 1000; // 1 giây mặc định
    this.browser = null;
    this.page = null;
    this.intervalId = null;
    this.lastMessage = "";
    this.scanCount = 0;
    this.sessionPath = "./zalo_session";
    this.stateFilePath = "./bot_state.json";
    this.imagesPath = "./images"; // Folder lưu ảnh

    // Tạo thư mục images nếu chưa tồn tại
    if (!fs.existsSync(this.imagesPath)) {
      fs.mkdirSync(this.imagesPath, { recursive: true });
    }

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

  // Download ảnh từ blob URL
  async downloadImage(blobUrl, fileName) {
    try {
      this.emit("log", `   🔄 Đang fetch blob URL...`);

      const base64Data = await this.page.evaluate(async (url) => {
        try {
          const response = await fetch(url);
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }
          const blob = await response.blob();
          return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = () => reject(new Error("FileReader error"));
            reader.readAsDataURL(blob);
          });
        } catch (error) {
          return `ERROR: ${error.message}`;
        }
      }, blobUrl);

      if (typeof base64Data === "string" && base64Data.startsWith("ERROR:")) {
        throw new Error(base64Data);
      }

      if (!base64Data || !base64Data.includes("base64,")) {
        throw new Error("Invalid base64 data received");
      }

      this.emit("log", `   💾 Đang lưu file...`);

      const base64Image = base64Data.split(";base64,").pop();
      // Sử dụng absolute path để Puppeteer có thể upload file
      const filePath = path.resolve(this.imagesPath, fileName);
      fs.writeFileSync(filePath, base64Image, { encoding: "base64" });

      const stats = fs.statSync(filePath);
      this.emit(
        "log",
        `   ✅ Đã lưu ảnh: ${fileName} (${(stats.size / 1024).toFixed(2)} KB)`,
      );
      this.emit("log", `   📂 Đường dẫn đầy đủ: ${filePath}`);

      return filePath;
    } catch (error) {
      this.emit("error", `   ❌ Lỗi khi tải ảnh: ${error.message}`);
      return null;
    }
  }

  // Gửi tất cả tin nhắn đang chờ
  async sendPendingMessages() {
    if (this.pendingMessages.length === 0) {
      this.emit("log", "⏭️ Queue rỗng, bỏ qua gửi");
      return;
    }

    // TẠM DỪNG quét tin nhắn khi đang gửi
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.emit("log", "⏸️ Tạm dừng quét tin nhắn");
    }

    // CLEAR QUEUE NGAY để nhận tin mới trong lúc gửi
    const messagesToSend = [...this.pendingMessages];
    const messageCount = messagesToSend.length;
    this.pendingMessages = [];

    this.emit("log", `\n========== BẮT ĐẦU GỮI TIN NHẮN ==========`);
    this.emit("log", `🗑️ Đã clear queue: ${messageCount} tin nhắn`);
    this.emit("log", `🔍 Xác nhận đang ở nhóm nguồn: "${this.sourceGroup}"`);

    try {
      // BƯỚC 1: DI CHUYỂN sang nhóm đích
      this.emit("log", `\n[BƯỚC 1/3] Tìm nhóm đích: "${this.targetGroup}"...`);

      // Navigate đến nhóm đích - GIỐNG CODE TÌM NHÓM NGUỒN
      await this.page.type("#contact-search-input", this.targetGroup);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await this.page.keyboard.press("Enter");
      await new Promise((resolve) => setTimeout(resolve, 2500));

      const searchInput = await this.page.$("#contact-search-input");
      await searchInput.click({ clickCount: 3 });
      await this.page.keyboard.press("Backspace");
      await new Promise((resolve) => setTimeout(resolve, 500));

      this.emit("log", `✅ Đã vào nhóm đích: "${this.targetGroup}"\n`);

      // BƯỚC 2: GỮI TỮNG TIN NHẮN
      this.emit("log", `[BƯỚC 2/3] Gửi ${messageCount} tin nhắn...`);

      // Gửi từng tin nhắn
      for (let i = 0; i < messagesToSend.length; i++) {
        const msg = messagesToSend[i];

        try {
          if (msg.type === "text") {
            // GỬI TEXT
            this.emit(
              "log",
              `  ${i + 1}/${messagesToSend.length}. Gửi text: "${msg.content.substring(0, 50)}${msg.content.length > 50 ? "..." : ""}"`,
            );

            const richInput = await this.page.$("#richInput");
            if (!richInput) {
              this.emit("error", "Không tìm thấy input box");
              continue;
            }

            await richInput.click();
            await new Promise((resolve) => setTimeout(resolve, 200));

            // Clear input trước
            await this.page.keyboard.down("Control");
            await this.page.keyboard.press("KeyA");
            await this.page.keyboard.up("Control");
            await this.page.keyboard.press("Backspace");
            await new Promise((resolve) => setTimeout(resolve, 100));

            // Transform text trước khi gửi
            const transformedContent = await transformText(msg.content);
            const contentToSend = transformedContent || msg.content;

            // Xử lý tin nhắn nhiều dòng
            if (contentToSend.includes("\n")) {
              const lines = contentToSend.split("\n");
              for (let j = 0; j < lines.length; j++) {
                if (lines[j]) {
                  await richInput.type(lines[j], { delay: 5 });
                }
                if (j < lines.length - 1) {
                  await this.page.keyboard.down("Shift");
                  await this.page.keyboard.press("Enter");
                  await this.page.keyboard.up("Shift");
                  await new Promise((resolve) => setTimeout(resolve, 30));
                }
              }
            } else {
              await richInput.type(contentToSend, { delay: 5 });
            }

            await new Promise((resolve) => setTimeout(resolve, 200));
            await this.page.keyboard.press("Enter");
            await new Promise((resolve) => setTimeout(resolve, 800));
          } else if (msg.type === "images") {
            // GỬI NHIỀU ẢNH (ALBUM) BẰNG DRAG & DROP
            this.emit(
              "log",
              `  ${i + 1}/${messagesToSend.length}. Gửi ${msg.count} ảnh cùng lúc`,
            );

            try {
              // Verify tất cả files tồn tại
              const validPaths = [];
              for (const fp of msg.filePaths) {
                const absolutePath = path.resolve(fp);
                if (fs.existsSync(absolutePath)) {
                  validPaths.push(absolutePath);
                } else {
                  this.emit(
                    "error",
                    `     ❌ File không tồn tại: ${absolutePath}`,
                  );
                }
              }

              if (validPaths.length === 0) {
                this.emit("error", `     ❌ Không có file nào hợp lệ`);
                continue;
              }

              this.emit("log", `     📂 Sẽ upload ${validPaths.length} ảnh`);

              // Đọc tất cả files thành base64
              const filesData = validPaths.map((fp) => {
                const fileBuffer = fs.readFileSync(fp);
                return {
                  name: path.basename(fp),
                  base64: fileBuffer.toString("base64"),
                  mimeType: "image/jpeg",
                };
              });

              this.emit("log", `     🎯 Tìm vùng drop...`);

              // Tìm element để drop
              const dropSelectors = [
                ".dragOverlayInputbox",
                "#richInput",
                '[data-id="richInput"]',
                ".chat-input",
                ".input-area",
              ];

              let dropTarget = null;
              let usedSelector = "";
              for (const selector of dropSelectors) {
                dropTarget = await this.page.$(selector);
                if (dropTarget) {
                  usedSelector = selector;
                  this.emit("log", `     ✓ Tìm thấy drop zone: ${selector}`);
                  break;
                }
              }

              if (!dropTarget) {
                this.emit("error", `     ❌ Không tìm thấy vùng drop`);
                continue;
              }

              this.emit(
                "log",
                `     🖱️ Simulate drag & drop ${filesData.length} files...`,
              );

              // Simulate drag and drop với NHIỀU files
              await this.page.evaluate(
                async (selector, filesData) => {
                  const element = document.querySelector(selector);
                  if (!element) {
                    throw new Error(`Element ${selector} not found`);
                  }

                  // Tạo DataTransfer với NHIỀU files
                  const dataTransfer = new DataTransfer();

                  for (const fileData of filesData) {
                    // Convert base64 to blob
                    const byteCharacters = atob(fileData.base64);
                    const byteNumbers = new Array(byteCharacters.length);
                    for (let i = 0; i < byteCharacters.length; i++) {
                      byteNumbers[i] = byteCharacters.charCodeAt(i);
                    }
                    const byteArray = new Uint8Array(byteNumbers);
                    const blob = new Blob([byteArray], {
                      type: fileData.mimeType,
                    });

                    // Tạo File object và add vào DataTransfer
                    const file = new File([blob], fileData.name, {
                      type: fileData.mimeType,
                    });
                    dataTransfer.items.add(file);
                  }

                  // Dispatch drag events
                  const dragenterEvent = new DragEvent("dragenter", {
                    bubbles: true,
                    cancelable: true,
                    dataTransfer: dataTransfer,
                  });
                  element.dispatchEvent(dragenterEvent);

                  const dragoverEvent = new DragEvent("dragover", {
                    bubbles: true,
                    cancelable: true,
                    dataTransfer: dataTransfer,
                  });
                  element.dispatchEvent(dragoverEvent);

                  // Dispatch drop event
                  const dropEvent = new DragEvent("drop", {
                    bubbles: true,
                    cancelable: true,
                    dataTransfer: dataTransfer,
                  });
                  element.dispatchEvent(dropEvent);

                  return `Dropped ${filesData.length} files`;
                },
                usedSelector,
                filesData,
              );

              this.emit("log", `     ⏳ Chờ xử lý...`);
              await new Promise((resolve) => setTimeout(resolve, 3000));

              // Tìm và click nút Send
              this.emit("log", `     ✉️ Tìm nút gửi...`);
              const sendButtons = [
                'button[data-translate-inner="STR_SEND"]',
                "button.btn-send",
                'button[title*="Gửi"]',
                'button[aria-label*="Send"]',
                ".btn-send-photo",
              ];

              let sendClicked = false;
              for (const selector of sendButtons) {
                try {
                  const sendBtn = await this.page.$(selector);
                  if (sendBtn) {
                    this.emit("log", `     ✓ Click nút: ${selector}`);
                    await sendBtn.click();
                    sendClicked = true;
                    break;
                  }
                } catch (e) {
                  // Bỏ qua
                }
              }

              if (!sendClicked) {
                this.emit("log", `     ⌨️ Gửi bằng Enter...`);
                await this.page.keyboard.press("Enter");
              }

              await new Promise((resolve) => setTimeout(resolve, 2000));
              this.emit("log", `     ✅ Đã gửi ${msg.count} ảnh`);

              // Xóa các file ảnh đã gửi
              for (const fp of validPaths) {
                try {
                  fs.unlinkSync(fp);
                  this.emit("log", `     🗑️ Đã xóa: ${path.basename(fp)}`);
                } catch (delError) {
                  this.emit(
                    "error",
                    `     ⚠️ Không xóa được: ${path.basename(fp)}`,
                  );
                }
              }
            } catch (uploadError) {
              this.emit(
                "error",
                `     ❌ Lỗi khi gửi nhiều ảnh: ${uploadError.message}`,
              );
            }
          } else if (msg.type === "images_with_text") {
            // GỬI NHIỀU ẢNH + TEXT - ĐÂY LÀ 1 TIN NHẮN DUY NHẤT
            this.emit(
              "log",
              `  ${i + 1}/${messagesToSend.length}. Gửi 1 tin nhắn (${msg.count} ảnh + caption)`,
            );
            this.emit(
              "log",
              `     💬 Caption: "${msg.caption.substring(0, 50)}${msg.caption.length > 50 ? "..." : ""}"`,
            );

            try {
              // Verify tất cả files tồn tại
              const validPaths = [];
              for (const fp of msg.filePaths) {
                const absolutePath = path.resolve(fp);
                if (fs.existsSync(absolutePath)) {
                  validPaths.push(absolutePath);
                } else {
                  this.emit(
                    "error",
                    `     ❌ File không tồn tại: ${absolutePath}`,
                  );
                }
              }

              if (validPaths.length === 0) {
                this.emit("error", `     ❌ Không có file nào hợp lệ`);
                continue;
              }

              this.emit(
                "log",
                `     🎬 BƯỚC 1: Kéo ${validPaths.length} ảnh vào chat...`,
              );

              // Đọc tất cả files thành base64
              const filesData = validPaths.map((fp) => {
                const fileBuffer = fs.readFileSync(fp);
                return {
                  name: path.basename(fp),
                  base64: fileBuffer.toString("base64"),
                  mimeType: "image/jpeg",
                };
              });

              // Tìm element để drop
              const dropSelectors = [
                ".dragOverlayInputbox",
                "#richInput",
                '[data-id="richInput"]',
                ".chat-input",
                ".input-area",
              ];

              let dropTarget = null;
              let usedSelector = "";
              for (const selector of dropSelectors) {
                dropTarget = await this.page.$(selector);
                if (dropTarget) {
                  usedSelector = selector;
                  this.emit("log", `     ✓ Tìm thấy drop zone: ${selector}`);
                  break;
                }
              }

              if (!dropTarget) {
                this.emit("error", `     ❌ Không tìm thấy vùng drop`);
                continue;
              }

              this.emit(
                "log",
                `     🖱️ Drag & drop ${filesData.length} files...`,
              );

              // Simulate drag and drop với NHIỀU files
              await this.page.evaluate(
                async (selector, filesData) => {
                  const element = document.querySelector(selector);
                  if (!element) {
                    throw new Error(`Element ${selector} not found`);
                  }

                  const dataTransfer = new DataTransfer();

                  for (const fileData of filesData) {
                    const byteCharacters = atob(fileData.base64);
                    const byteNumbers = new Array(byteCharacters.length);
                    for (let i = 0; i < byteCharacters.length; i++) {
                      byteNumbers[i] = byteCharacters.charCodeAt(i);
                    }
                    const byteArray = new Uint8Array(byteNumbers);
                    const blob = new Blob([byteArray], {
                      type: fileData.mimeType,
                    });
                    const file = new File([blob], fileData.name, {
                      type: fileData.mimeType,
                    });
                    dataTransfer.items.add(file);
                  }

                  element.dispatchEvent(
                    new DragEvent("dragenter", {
                      bubbles: true,
                      cancelable: true,
                      dataTransfer,
                    }),
                  );
                  element.dispatchEvent(
                    new DragEvent("dragover", {
                      bubbles: true,
                      cancelable: true,
                      dataTransfer,
                    }),
                  );
                  element.dispatchEvent(
                    new DragEvent("drop", {
                      bubbles: true,
                      cancelable: true,
                      dataTransfer,
                    }),
                  );

                  return `Dropped ${filesData.length} files`;
                },
                usedSelector,
                filesData,
              );

              this.emit("log", `     ⏳ Chờ preview load...`);
              await new Promise((resolve) => setTimeout(resolve, 2500));

              // Type caption text
              this.emit("log", `     🎬 BƯỚC 2: Typing caption...`);
              this.emit(
                "log",
                `        "${msg.caption.substring(0, 60)}${msg.caption.length > 60 ? "..." : ""}"`,
              );
              const richInput = await this.page.$("#richInput");
              if (richInput) {
                await richInput.click();
                await new Promise((resolve) => setTimeout(resolve, 200));

                // Transform caption trước khi gửi
                const transformedCaption = await transformText(msg.caption);
                const captionToSend = transformedCaption || msg.caption;

                // Type caption (hỗ trợ nhiều dòng)
                if (captionToSend.includes("\n")) {
                  const lines = captionToSend.split("\n");
                  for (let j = 0; j < lines.length; j++) {
                    if (lines[j]) {
                      await richInput.type(lines[j], { delay: 5 });
                    }
                    if (j < lines.length - 1) {
                      await this.page.keyboard.down("Shift");
                      await this.page.keyboard.press("Enter");
                      await this.page.keyboard.up("Shift");
                      await new Promise((resolve) => setTimeout(resolve, 30));
                    }
                  }
                } else {
                  await richInput.type(captionToSend, { delay: 5 });
                }
              }

              await new Promise((resolve) => setTimeout(resolve, 500));

              // Gửi tin nhắn
              this.emit("log", `     🎬 BƯỚC 3: Send 1 tin nhắn hoàn chỉnh...`);
              await this.page.keyboard.press("Enter");
              await new Promise((resolve) => setTimeout(resolve, 2000));
              this.emit(
                "log",
                `     ✅ Đã gửi 1 tin nhắn (${msg.count} ảnh + caption)`,
              );

              // Xóa các file ảnh đã gửi
              for (const fp of validPaths) {
                try {
                  fs.unlinkSync(fp);
                  this.emit("log", `     🗑️ Đã xóa: ${path.basename(fp)}`);
                } catch (delError) {
                  this.emit(
                    "error",
                    `     ⚠️ Không xóa được: ${path.basename(fp)}`,
                  );
                }
              }
            } catch (uploadError) {
              this.emit("error", `     ❌ Lỗi: ${uploadError.message}`);
            }
          } else if (msg.type === "image_with_text") {
            // GỬI 1 ẢNH + TEXT - ĐÂY LÀ 1 TIN NHẮN DUY NHẤT
            this.emit(
              "log",
              `  ${i + 1}/${messagesToSend.length}. Gửi 1 tin nhắn (1 ảnh + caption)`,
            );
            this.emit(
              "log",
              `     💬 Caption: "${msg.caption.substring(0, 50)}${msg.caption.length > 50 ? "..." : ""}"`,
            );

            try {
              const absolutePath = path.resolve(msg.filePath);
              if (!fs.existsSync(absolutePath)) {
                this.emit(
                  "error",
                  `     ❌ File không tồn tại: ${absolutePath}`,
                );
                continue;
              }

              // Đọc file thành base64
              const fileBuffer = fs.readFileSync(absolutePath);
              const base64Data = fileBuffer.toString("base64");
              const mimeType = "image/jpeg";

              // Tìm element để drop
              const dropSelectors = [
                ".dragOverlayInputbox",
                "#richInput",
                '[data-id="richInput"]',
                ".chat-input",
                ".input-area",
              ];

              let dropTarget = null;
              let usedSelector = "";
              for (const selector of dropSelectors) {
                dropTarget = await this.page.$(selector);
                if (dropTarget) {
                  usedSelector = selector;
                  break;
                }
              }

              if (!dropTarget) {
                this.emit("error", `     ❌ Không tìm thấy vùng drop`);
                continue;
              }

              this.emit("log", `     🎬 BƯỚC 1: Kéo ảnh vào chat...`);

              // Simulate drag and drop với file
              await this.page.evaluate(
                async (selector, fileName, base64, mimeType) => {
                  const byteCharacters = atob(base64);
                  const byteNumbers = new Array(byteCharacters.length);
                  for (let i = 0; i < byteCharacters.length; i++) {
                    byteNumbers[i] = byteCharacters.charCodeAt(i);
                  }
                  const byteArray = new Uint8Array(byteNumbers);
                  const blob = new Blob([byteArray], { type: mimeType });
                  const file = new File([blob], fileName, { type: mimeType });

                  const element = document.querySelector(selector);
                  if (!element) {
                    throw new Error(`Element ${selector} not found`);
                  }

                  const dataTransfer = new DataTransfer();
                  dataTransfer.items.add(file);

                  element.dispatchEvent(
                    new DragEvent("dragenter", {
                      bubbles: true,
                      cancelable: true,
                      dataTransfer,
                    }),
                  );
                  element.dispatchEvent(
                    new DragEvent("dragover", {
                      bubbles: true,
                      cancelable: true,
                      dataTransfer,
                    }),
                  );
                  element.dispatchEvent(
                    new DragEvent("drop", {
                      bubbles: true,
                      cancelable: true,
                      dataTransfer,
                    }),
                  );

                  return "Drop event dispatched";
                },
                usedSelector,
                path.basename(msg.filePath),
                base64Data,
                mimeType,
              );

              this.emit("log", `     ⏳ Chờ preview load...`);
              await new Promise((resolve) => setTimeout(resolve, 2500));

              // Type caption text
              this.emit("log", `     🎬 BƯỚC 2: Typing caption...`);
              this.emit(
                "log",
                `        "${msg.caption.substring(0, 60)}${msg.caption.length > 60 ? "..." : ""}"`,
              );
              const richInput = await this.page.$("#richInput");
              if (richInput) {
                await richInput.click();
                await new Promise((resolve) => setTimeout(resolve, 200));

                // Transform caption trước khi gửi
                const transformedCaption = await transformText(msg.caption);
                const captionToSend = transformedCaption || msg.caption;

                // Type caption (hỗ trợ nhiều dòng)
                if (captionToSend.includes("\n")) {
                  const lines = captionToSend.split("\n");
                  for (let j = 0; j < lines.length; j++) {
                    if (lines[j]) {
                      await richInput.type(lines[j], { delay: 5 });
                    }
                    if (j < lines.length - 1) {
                      await this.page.keyboard.down("Shift");
                      await this.page.keyboard.press("Enter");
                      await this.page.keyboard.up("Shift");
                      await new Promise((resolve) => setTimeout(resolve, 30));
                    }
                  }
                } else {
                  await richInput.type(captionToSend, { delay: 5 });
                }
              }

              await new Promise((resolve) => setTimeout(resolve, 500));

              // Gửi tin nhắn
              this.emit("log", `     🎬 BƯỚC 3: Send 1 tin nhắn hoàn chỉnh...`);
              await this.page.keyboard.press("Enter");
              await new Promise((resolve) => setTimeout(resolve, 2000));
              this.emit("log", `     ✅ Đã gửi 1 tin nhắn (1 ảnh + caption)`);

              // Xóa file ảnh đã gửi
              try {
                fs.unlinkSync(absolutePath);
                this.emit(
                  "log",
                  `     🗑️ Đã xóa: ${path.basename(absolutePath)}`,
                );
              } catch (delError) {
                this.emit(
                  "error",
                  `     ⚠️ Không xóa được file: ${delError.message}`,
                );
              }
            } catch (uploadError) {
              this.emit("error", `     ❌ Lỗi: ${uploadError.message}`);
            }
          } else if (msg.type === "image") {
            // GỬI 1 ẢNH BẰNG DRAG & DROP
            this.emit(
              "log",
              `  ${i + 1}/${messagesToSend.length}. Gửi ảnh: ${path.basename(msg.filePath)}`,
            );

            try {
              // Verify file tồn tại trước khi upload
              const absolutePath = path.resolve(msg.filePath);
              if (!fs.existsSync(absolutePath)) {
                this.emit(
                  "error",
                  `     ❌ File không tồn tại: ${absolutePath}`,
                );
                continue;
              }
              this.emit("log", `     📂 Đọc file từ: ${absolutePath}`);

              // Đọc file thành base64
              const fileBuffer = fs.readFileSync(absolutePath);
              const base64Data = fileBuffer.toString("base64");
              const mimeType = "image/jpeg"; // Có thể detect từ extension

              this.emit("log", `     🎯 Tìm vùng drop...`);

              // Tìm element để drop - thử nhiều selector
              const dropSelectors = [
                ".dragOverlayInputbox",
                "#richInput",
                '[data-id="richInput"]',
                ".chat-input",
                ".input-area",
              ];

              let dropTarget = null;
              let usedSelector = "";
              for (const selector of dropSelectors) {
                dropTarget = await this.page.$(selector);
                if (dropTarget) {
                  usedSelector = selector;
                  this.emit("log", `     ✓ Tìm thấy drop zone: ${selector}`);
                  break;
                }
              }

              if (!dropTarget) {
                this.emit("error", `     ❌ Không tìm thấy vùng drop`);
                continue;
              }

              this.emit("log", `     🖱️ Simulate drag & drop...`);

              // Simulate drag and drop với file
              await this.page.evaluate(
                async (selector, fileName, base64, mimeType) => {
                  // Convert base64 to blob
                  const byteCharacters = atob(base64);
                  const byteNumbers = new Array(byteCharacters.length);
                  for (let i = 0; i < byteCharacters.length; i++) {
                    byteNumbers[i] = byteCharacters.charCodeAt(i);
                  }
                  const byteArray = new Uint8Array(byteNumbers);
                  const blob = new Blob([byteArray], { type: mimeType });

                  // Tạo File object
                  const file = new File([blob], fileName, { type: mimeType });

                  // Tìm element
                  const element = document.querySelector(selector);
                  if (!element) {
                    throw new Error(`Element ${selector} not found`);
                  }

                  // Tạo DataTransfer
                  const dataTransfer = new DataTransfer();
                  dataTransfer.items.add(file);

                  // Dispatch drag events
                  const dragenterEvent = new DragEvent("dragenter", {
                    bubbles: true,
                    cancelable: true,
                    dataTransfer: dataTransfer,
                  });
                  element.dispatchEvent(dragenterEvent);

                  const dragoverEvent = new DragEvent("dragover", {
                    bubbles: true,
                    cancelable: true,
                    dataTransfer: dataTransfer,
                  });
                  element.dispatchEvent(dragoverEvent);

                  // Dispatch drop event
                  const dropEvent = new DragEvent("drop", {
                    bubbles: true,
                    cancelable: true,
                    dataTransfer: dataTransfer,
                  });
                  element.dispatchEvent(dropEvent);

                  return "Drop event dispatched";
                },
                usedSelector,
                path.basename(msg.filePath),
                base64Data,
                mimeType,
              );

              this.emit("log", `     ⏳ Chờ xử lý...`);
              await new Promise((resolve) => setTimeout(resolve, 2500));

              // Tìm và click nút Send
              this.emit("log", `     ✉️ Tìm nút gửi...`);
              const sendButtons = [
                'button[data-translate-inner="STR_SEND"]',
                "button.btn-send",
                'button[title*="Gửi"]',
                'button[aria-label*="Send"]',
                ".btn-send-photo",
              ];

              let sendClicked = false;
              for (const selector of sendButtons) {
                try {
                  const sendBtn = await this.page.$(selector);
                  if (sendBtn) {
                    this.emit("log", `     ✓ Click nút: ${selector}`);
                    await sendBtn.click();
                    sendClicked = true;
                    break;
                  }
                } catch (e) {
                  // Bỏ qua
                }
              }

              // Nếu không tìm thấy nút, thử Enter
              if (!sendClicked) {
                this.emit("log", `     ⌨️ Gửi bằng Enter...`);
                await this.page.keyboard.press("Enter");
              }

              await new Promise((resolve) => setTimeout(resolve, 1500));
              this.emit("log", `     ✅ Đã gửi ảnh`);

              // Xóa file ảnh đã gửi
              try {
                fs.unlinkSync(absolutePath);
                this.emit(
                  "log",
                  `     🗑️ Đã xóa: ${path.basename(absolutePath)}`,
                );
              } catch (delError) {
                this.emit(
                  "error",
                  `     ⚠️ Không xóa được file: ${delError.message}`,
                );
              }
            } catch (uploadError) {
              this.emit(
                "error",
                `     ❌ Lỗi khi gửi ảnh: ${uploadError.message}`,
              );
            }
          }
        } catch (error) {
          this.emit("error", `Lỗi gửi tin ${i + 1}: ${error.message}`);
        }
      }

      this.emit(
        "log",
        `\n✅ Đã gửi xong ${messagesToSend.length} tin nhắn đến "${this.targetGroup}"`,
      );

      // BƯỚC 3: QUAY VỀ NHÓM NGUỒN
      this.emit("log", `\n[BƯỚC 3/3] Quay về nhóm nguồn...`);
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
      this.emit("log", `🔙 Tìm nhóm nguồn: "${this.sourceGroup}"...`);

      // GIỐNG CODE TÌM NHÓM NGUỒN
      await this.page.type("#contact-search-input", this.sourceGroup);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await this.page.keyboard.press("Enter");
      await new Promise((resolve) => setTimeout(resolve, 2500));

      const searchInput = await this.page.$("#contact-search-input");
      await searchInput.click({ clickCount: 3 });
      await this.page.keyboard.press("Backspace");
      await new Promise((resolve) => setTimeout(resolve, 500));

      this.emit("log", `✅ Đã về nhóm nguồn: "${this.sourceGroup}"`);
      this.emit("log", `🔄 Tiếp tục quét tin nhắn tại nhóm nguồn...`);
      this.emit("log", `========== KẾT THÚC GỮI TIN NHẮN ==========\n`);

      // KHỞI ĐỘNG LẠI quét tin nhắn
      this.startScanning();
      this.emit(
        "log",
        `▶️ Đã khởi động lại quét tin nhắn (mỗi ${this.checkInterval}ms)\n`,
      );
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

      // Launch với UI nếu chưa có session, ẩn nếu đã có session
      this.browser = await puppeteer.launch({
        headless: hasSession, // Chỉ ẩn khi đã có session
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
        defaultViewport: hasSession ? { width: 1366, height: 768 } : null,
      });

      // Đóng tất cả tab hiện tại và tạo tab mới
      const pages = await this.browser.pages();
      this.emit(
        "log",
        `🗑️ Tìm thấy ${pages.length} tab, đang đóng các tab cũ...`,
      );

      // Đóng tất cả tab trừ tab đầu tiên
      for (let i = 1; i < pages.length; i++) {
        await pages[i].close();
      }

      // Sử dụng tab đầu tiên hoặc tạo mới nếu không có
      if (pages.length > 0) {
        this.page = pages[0];
      } else {
        this.page = await this.browser.newPage();
      }

      this.emit("log", `✓ Chỉ giữ lại 1 tab`);

      await this.page.setViewport({ width: 1366, height: 768 });
      await this.page.goto("https://chat.zalo.me/", {
        waitUntil: "networkidle2",
      });

      if (!hasSession) {
        this.emit("status", "⏳ Vui lòng quét QR code để đăng nhập...");
      }

      await this.page.waitForSelector("#contact-search-input", { timeout: 0 });
      this.emit("status", "✅ Đã đăng nhập thành công");

      // Nếu là lần đầu login, restart ở chế độ ẩn
      if (!hasSession) {
        this.emit("log", "🔄 Đang khởi động lại ở chế độ ẩn...");
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
          timeout: 10000,
        });
        this.emit("status", "✅ Đã chuyển sang chế độ ẩn");

        // Setup console listener cho page mới
        this.page.on("console", (msg) => {
          const text = msg.text();
          if (text.includes("[IMAGE DETECTED]") || text.includes("[DEBUG]")) {
            this.emit("log", `🔍 Browser: ${text}`);
          }
        });
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

      // Bắt console.log từ browser để debug
      this.page.on("console", (msg) => {
        const text = msg.text();
        if (text.includes("[IMAGE DETECTED]") || text.includes("[DEBUG]")) {
          this.emit("log", `🔍 Browser: ${text}`);
        }
      });

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
          // Tìm cả message-frame VÀ message-non-frame
          const frames = document.querySelectorAll(
            '[id^="message-frame_"], .message-frame, .message-non-frame',
          );
          console.log(`[DEBUG] Found ${frames.length} message frames`);

          for (let i = frames.length - 1; i >= 0; i--) {
            // TẠM THỜI quét TẤT CẢ tin nhắn (kể cả của mình) để test
            // Sau khi test xong, đổi lại: if (!frames[i].classList.contains("me"))
            const skipMyMessages = false; // true = chỉ quét tin người khác, false = quét tất cả
            const isMe = frames[i].classList.contains("me");

            if (!skipMyMessages || !isMe) {
              // KIỂM TRA ẢNH - Chỉ lấy ảnh thật, bỏ qua ảnh preview của link
              let imgElements = [];

              // Tìm ảnh trong các container ảnh thật
              const imageContainers = frames[i].querySelectorAll(
                '.chatImageMessage--audit, .img-msg-v2.photo-message-v2, .album, [id^="album-container"]',
              );

              if (imageContainers.length > 0) {
                // Lấy tất cả ảnh blob từ các container ảnh thật
                imageContainers.forEach((container) => {
                  const imgs = container.querySelectorAll('img[src^="blob:"]');
                  imgs.forEach((img) => {
                    // Đảm bảo không nằm trong link-message
                    if (!img.closest(".link-message")) {
                      imgElements.push(img);
                    }
                  });
                });

                if (imgElements.length > 0) {
                  console.log(
                    `[IMAGE DETECTED] Found ${imgElements.length} real images (excluded link previews)`,
                  );
                }
              }

              // Fallback: tìm tất cả ảnh blob KHÔNG nằm trong link-message
              if (imgElements.length === 0) {
                const allImages =
                  frames[i].querySelectorAll('img[src^="blob:"]');
                allImages.forEach((img) => {
                  // Chỉ lấy ảnh KHÔNG nằm trong link-message
                  if (!img.closest(".link-message")) {
                    imgElements.push(img);
                  }
                });

                if (imgElements.length > 0) {
                  console.log(
                    `[IMAGE DETECTED] Found ${imgElements.length} images (fallback, excluded link previews)`,
                  );
                }
              }

              // LẤY TEXT (bất kể có ảnh hay không)
              let text = "";

              // Tìm container message-text-content (chứa TOÀN BỘ tin nhắn dài)
              const textContainer = frames[i].querySelector(
                '[data-component="message-text-content"]',
              );
              if (textContainer) {
                text =
                  textContainer.innerText || textContainer.textContent || "";
              }

              // Nếu không có, thử lấy từ caption trong ảnh
              if (!text || text.trim() === "") {
                const imgCaption = frames[i].querySelector(
                  '.img-msg-v2__cap [data-component="message-text-content"]',
                );
                if (imgCaption) {
                  text = imgCaption.innerText || imgCaption.textContent || "";
                  console.log(
                    `[TEXT DETECTED] Found caption in image: ${text.substring(0, 50)}...`,
                  );
                }
              }

              // Fallback: thử lấy từ text-message__container
              if (!text || text.trim() === "") {
                const msgContainer = frames[i].querySelector(
                  ".text-message__container",
                );
                if (msgContainer) {
                  text =
                    msgContainer.innerText || msgContainer.textContent || "";
                }
              }

              // Fallback: lấy từ span.text (tin nhắn ngắn)
              if (!text || text.trim() === "") {
                const textSpan = frames[i].querySelector("span.text");
                if (textSpan) {
                  text = textSpan.innerText;

                  if (!text || text.trim() === "") {
                    let html = textSpan.innerHTML;
                    html = html.replace(/<br\s*\/?>/gi, "\n");
                    html = html.replace(/<\/(div|p)>/gi, "\n");
                    html = html.replace(/<[^>]*>/g, "");
                    const txt = document.createElement("textarea");
                    txt.innerHTML = html;
                    text = txt.value;
                  }
                }
              }

              text = text.trim();

              // Nếu có ẢNH
              if (imgElements.length > 0) {
                console.log(
                  `[IMAGE DETECTED] Total: ${imgElements.length} image(s)`,
                );
                console.log(
                  `[IMAGE DETECTED] Frame index: ${i}/${frames.length - 1}`,
                );

                const images = imgElements.map((img, idx) => {
                  console.log(
                    `[IMAGE DETECTED] #${idx + 1} - Src: ${img.src.substring(0, 60)}...`,
                  );
                  return {
                    src: img.src,
                    id: img.id || `unknown_${idx}`,
                    width: img.width || 0,
                    height: img.height || 0,
                  };
                });

                text = text.trim();

                // CÓ CẢ ẢNH VÀ TEXT (caption)
                if (text) {
                  console.log(
                    `[MIXED DETECTED] Images with caption: "${text.substring(0, 50)}..."`,
                  );
                  if (images.length === 1) {
                    return {
                      type: "image_with_text",
                      image: images[0],
                      caption: text,
                    };
                  } else {
                    return {
                      type: "images_with_text",
                      images: images,
                      count: images.length,
                      caption: text,
                    };
                  }
                }

                // CHỈ CÓ ẢNH (không có text)
                if (images.length === 1) {
                  return {
                    type: "image",
                    ...images[0],
                    foundBy: "single image",
                  };
                } else {
                  return {
                    type: "images",
                    images: images,
                    count: images.length,
                  };
                }
              }

              // CHỈ CÓ TEXT (không có ảnh) - text đã được lấy ở trên
              if (text) return { type: "text", content: text };
            }
          }
          return null;
        });

        if (
          currentMsg &&
          JSON.stringify(currentMsg) !== JSON.stringify(this.lastMessage)
        ) {
          let messageAdded = false;

          if (currentMsg.type === "text") {
            this.emit("log", `📨 Tin nhắn text mới: "${currentMsg.content}"`);
            this.lastMessage = currentMsg;
            this.saveLastMessage(currentMsg.content);
            this.pendingMessages.push(currentMsg);
            messageAdded = true;
          } else if (currentMsg.type === "image") {
            this.emit("log", `📨 Tin nhắn ảnh mới!`);
            this.emit(
              "log",
              `   - Tìm thấy bởi: ${currentMsg.foundBy || "unknown"}`,
            );
            this.emit("log", `   - ID: ${currentMsg.id}`);
            this.emit(
              "log",
              `   - Kích thước: ${currentMsg.width}x${currentMsg.height}`,
            );
            this.emit("log", `   - Src: ${currentMsg.src.substring(0, 60)}...`);

            const timestamp = Date.now();
            const fileName = `image_${timestamp}.jpg`;
            this.emit("log", `⬇️ Bắt đầu download ảnh: ${fileName}`);

            const filePath = await this.downloadImage(currentMsg.src, fileName);

            if (filePath) {
              this.emit("log", `✅ Download thành công: ${filePath}`);
              this.lastMessage = currentMsg;
              this.saveLastMessage(`[IMAGE:${fileName}]`);
              this.pendingMessages.push({
                type: "image",
                filePath: filePath,
              });
              messageAdded = true;
            } else {
              this.emit("error", `❌ Download ảnh thất bại!`);
            }
          } else if (currentMsg.type === "images") {
            // XỬ LÝ NHIỀU ẢNH (ALBUM)
            this.emit("log", `📨 Tin nhắn ${currentMsg.count} ảnh mới!`);

            const filePaths = [];
            const timestamp = Date.now();

            // Download tất cả ảnh
            for (let idx = 0; idx < currentMsg.images.length; idx++) {
              const img = currentMsg.images[idx];
              const fileName = `image_${timestamp}_${idx + 1}.jpg`;

              this.emit(
                "log",
                `   ⬇️ [${idx + 1}/${currentMsg.count}] Download: ${fileName}`,
              );
              this.emit(
                "log",
                `      - Kích thước: ${img.width}x${img.height}`,
              );

              const filePath = await this.downloadImage(img.src, fileName);

              if (filePath) {
                this.emit("log", `      ✅ Download thành công`);
                filePaths.push(filePath);
              } else {
                this.emit("error", `      ❌ Download thất bại`);
              }

              // Delay nhỏ giữa các lần download
              await new Promise((resolve) => setTimeout(resolve, 300));
            }

            if (filePaths.length > 0) {
              this.emit(
                "log",
                `✅ Download xong ${filePaths.length}/${currentMsg.count} ảnh`,
              );
              this.lastMessage = currentMsg;
              this.saveLastMessage(`[IMAGES:${filePaths.length}]`);
              this.pendingMessages.push({
                type: "images",
                filePaths: filePaths,
                count: filePaths.length,
              });
              messageAdded = true;
            } else {
              this.emit("error", `❌ Không download được ảnh nào!`);
            }
          } else if (currentMsg.type === "image_with_text") {
            // XỬ LÝ 1 ẢNH + TEXT (CAPTION) - CỘI LÀ 1 TIN NHẮN DUY NHẤT
            this.emit("log", `📨 Tin nhắn mới: 1 ảnh + caption (1 tin nhắn)`);
            this.emit(
              "log",
              `   - Caption: "${currentMsg.caption.substring(0, 50)}${currentMsg.caption.length > 50 ? "..." : ""}"`,
            );

            const timestamp = Date.now();
            const fileName = `image_${timestamp}.jpg`;
            this.emit("log", `⬇️ Download ảnh: ${fileName}`);

            const filePath = await this.downloadImage(
              currentMsg.image.src,
              fileName,
            );

            if (filePath) {
              this.emit("log", `✅ Download thành công`);
              this.lastMessage = currentMsg;
              this.saveLastMessage(`[IMAGE+TEXT:${fileName}]`);
              // Push vào queue như 1 tin nhắn duy nhất
              this.pendingMessages.push({
                type: "image_with_text",
                filePath: filePath,
                caption: currentMsg.caption,
              });
              this.emit(
                "log",
                `   ➕ Đã thêm 1 tin nhắn (ảnh + text) vào queue`,
              );
              messageAdded = true;
            } else {
              this.emit("error", `❌ Download ảnh thất bại!`);
            }
          } else if (currentMsg.type === "images_with_text") {
            // XỬ LÝ NHIỀU ẢNH + TEXT (ALBUM + CAPTION) - CỘI LÀ 1 TIN NHẮN DUY NHẤT
            this.emit(
              "log",
              `📨 Tin nhắn mới: ${currentMsg.count} ảnh + caption (1 tin nhắn)`,
            );
            this.emit(
              "log",
              `   - Caption: "${currentMsg.caption.substring(0, 50)}${currentMsg.caption.length > 50 ? "..." : ""}"`,
            );

            const filePaths = [];
            const timestamp = Date.now();

            // Download tất cả ảnh
            for (let idx = 0; idx < currentMsg.images.length; idx++) {
              const img = currentMsg.images[idx];
              const fileName = `image_${timestamp}_${idx + 1}.jpg`;

              this.emit(
                "log",
                `   ⬇️ [${idx + 1}/${currentMsg.count}] Download: ${fileName}`,
              );

              const filePath = await this.downloadImage(img.src, fileName);

              if (filePath) {
                this.emit("log", `      ✅ Download thành công`);
                filePaths.push(filePath);
              } else {
                this.emit("error", `      ❌ Download thất bại`);
              }

              await new Promise((resolve) => setTimeout(resolve, 300));
            }

            if (filePaths.length > 0) {
              this.emit(
                "log",
                `✅ Download xong ${filePaths.length}/${currentMsg.count} ảnh`,
              );
              this.lastMessage = currentMsg;
              this.saveLastMessage(`[IMAGES+TEXT:${filePaths.length}]`);
              // Push vào queue như 1 tin nhắn duy nhất
              this.pendingMessages.push({
                type: "images_with_text",
                filePaths: filePaths,
                count: filePaths.length,
                caption: currentMsg.caption,
              });
              this.emit(
                "log",
                `   ➕ Đã thêm 1 tin nhắn (${filePaths.length} ảnh + text) vào queue`,
              );
              messageAdded = true;
            } else {
              this.emit("error", `❌ Không download được ảnh nào!`);
            }
          }

          // CHỈ setup debounce timer NẾU ĐÃ THÊM TIN NHẮN VÀO QUEUE
          if (messageAdded) {
            this.emit(
              "log",
              `⏳ Đã thêm vào queue (${this.pendingMessages.length} tin nhắn chờ)`,
            );

            // Clear timer cũ và set timer mới (debounce)
            if (this.debounceTimer) {
              clearTimeout(this.debounceTimer);
              this.emit("log", `🔄 Reset timer 5s (có tin nhắn mới)`);
            } else {
              this.emit("log", `⏱️ Bắt đầu đếm 5s...`);
            }

            this.debounceTimer = setTimeout(async () => {
              this.emit(
                "log",
                `⏰ Hết 5s không có tin nhắn mới → Bắt đầu di chuyển sang nhóm đích...`,
              );
              await this.sendPendingMessages();
            }, this.debounceDelay);
          }
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
