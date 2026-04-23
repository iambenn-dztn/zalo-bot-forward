const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const { EventEmitter } = require("events");
const { transformText } = require("./util");

puppeteer.use(StealthPlugin());

const SESSION_PATH = "./zalo_session";
const IMAGES_PATH = "./images";
const MESSAGES_FILE = "./messages.json";
const STATE_FILE = "./bot_state.json";

class Bot extends EventEmitter {
  constructor(config) {
    super();
    this.sourceGroups = config.sourceGroups || [];
    this.targetGroup = config.targetGroup;
    // Thoi gian cho sau khi navigate vao nhom de DOM load (ms)
    this.checkInterval = config.checkInterval || 3000;
    // Chu ky forward (ms) - mac dinh 30 giay
    this.forwardInterval = config.forwardInterval || 30000;
    // Duong dan Chrome executable (de trong neu dung mac dinh cua Puppeteer)
    this.chromePath = config.chromePath || undefined;

    this.browser = null;
    this.page = null; // 1 tab duy nhat
    this.running = false;

    // Theo doi tin nhan da thay per group
    this.seenFrameIds = {};
    this.groupInitialized = {};

    // In-memory queue + async lock
    this.messageQueue = [];
    this._queueLock = Promise.resolve();

    if (!fs.existsSync(IMAGES_PATH)) {
      fs.mkdirSync(IMAGES_PATH, { recursive: true });
    }

    // Phuc hoi tin nhan chua gui tu lan chay truoc
    this.messageQueue = this._loadQueueFromDisk();
  }

  // ─── QUEUE helpers ────────────────────────────────────────────────────────

  _loadQueueFromDisk() {
    try {
      if (fs.existsSync(MESSAGES_FILE)) {
        const raw = fs.readFileSync(MESSAGES_FILE, "utf8");
        return JSON.parse(raw);
      }
    } catch { /* ignore corrupt file */ }
    return [];
  }

  _flushQueueToDisk() {
    try {
      fs.writeFileSync(
        MESSAGES_FILE,
        JSON.stringify(this.messageQueue, null, 2),
        "utf8",
      );
    } catch (err) {
      this.emit("error", `Loi ghi queue ra disk: ${err.message}`);
    }
  }

  async _withQueueLock(fn) {
    const prev = this._queueLock;
    let resolve;
    this._queueLock = new Promise((r) => { resolve = r; });
    await prev;
    try {
      return await fn();
    } finally {
      resolve();
    }
  }

  async appendMessage(message) {
    await this._withQueueLock(() => {
      this.messageQueue.push({
        ...message,
        createdAt: message.createdAt || Date.now(),
        retryCount: 0,
      });
      this._flushQueueToDisk();
    });
  }

  // ─── STATE helpers ────────────────────────────────────────────────────────

  loadState() {
    try {
      if (fs.existsSync(STATE_FILE)) {
        return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
      }
    } catch { /* ignore */ }
    return {};
  }

  saveState(state) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
  }

  // ─── START ──────────────────────────────────────────────────────────────────

  async start() {
    try {
      const hasSession = fs.existsSync(path.join(SESSION_PATH, "Default"));

      this.emit(
        "status",
        hasSession
          ? "Dang khoi dong..."
          : "Dang khoi dong... (Can quet QR)",
      );

      this.browser = await puppeteer.launch({
        headless: hasSession,
        userDataDir: SESSION_PATH,
        ...(this.chromePath ? { executablePath: this.chromePath } : {}),
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

      this.page = (await this.browser.pages())[0] || (await this.browser.newPage());
      await this.page.setViewport({ width: 1366, height: 768 });
      await this._gotoZalo(this.page);

      if (!hasSession) {
        this.emit("status", "Vui long quet QR code de dang nhap...");
      }

      await this.page.waitForSelector("#contact-search-input", { timeout: 0 });

      if (!hasSession) {
        this.emit("log", "Dang nhap thanh cong, dang khoi dong lai...");
        await this.browser.close();
        await new Promise((r) => setTimeout(r, 2000));

        this.browser = await puppeteer.launch({
          headless: false,
          userDataDir: SESSION_PATH,
          ...(this.chromePath ? { executablePath: this.chromePath } : {}),
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-accelerated-2d-canvas",
            "--disable-gpu",
            "--disable-blink-features=AutomationControlled",
          ],
          defaultViewport: { width: 1366, height: 768 },
        });
        this.page = (await this.browser.pages())[0] || (await this.browser.newPage());
        await this.page.setViewport({ width: 1366, height: 768 });
        await this._gotoZalo(this.page);
        await this._waitForZaloReady(this.page);
      }

      // Dong tat ca tab thua, chi giu 1 tab duy nhat
      const allPages = await this.browser.pages();
      for (const p of allPages) {
        if (p !== this.page) await p.close();
      }

      // Xoa queue cu — chi forward tin nhan tu luc start
      this.messageQueue = [];
      this._flushQueueToDisk();

      this.browser.on("disconnected", () => {
        this.emit("error", "Browser da dong bat ngo");
        this.running = false;
      });

      this.running = true;
      this.emit("status", "Bot dang chay");
      this.emit(
        "log",
        `1 tab: lang nghe ${this.sourceGroups.length} nhom, forward moi ${this.forwardInterval / 1000}s`,
      );

      // Bat dau vong lap chinh
      await this._mainLoop();
    } catch (error) {
      if (error.message && error.message.includes("Could not find Chrome")) {
        this.emit(
          "error",
          "Khong tim thay Chrome.\nChay: npx puppeteer browsers install chrome",
        );
      } else {
        this.emit("error", `Loi khoi dong: ${error.message}`);
      }
      this.stop();
    }
  }

  // ─── MAIN LOOP ────────────────────────────────────────────────────────────
  //  Vong lap: quet tung nhom nguon → khi den han forward → vao nhom dich gui
  //  → quay lai quet tiep

  async _mainLoop() {
    let lastForwardTime = Date.now();

    while (this.running) {
      // ── Phase 1: Lang nghe - quet tung nhom nguon ──
      for (let i = 0; i < this.sourceGroups.length; i++) {
        if (!this.running) break;
        const groupName = this.sourceGroups[i];

        try {
          this.emit("log", `[Listener] Vao nhom "${groupName}"...`);
          await this._navigateToGroup(this.page, groupName);
          // Cho DOM load tin nhan
          await new Promise((r) => setTimeout(r, this.checkInterval));
          await this._scanGroup(groupName);
        } catch (err) {
          this.emit("error", `[${groupName}] Loi quet: ${err.message}`);
        }
      }

      // ── Phase 2: Kiem tra co can forward khong ──
      const elapsed = Date.now() - lastForwardTime;
      if (elapsed >= this.forwardInterval) {
        if (this.messageQueue.length > 0) {
          this.emit(
            "log",
            `[Forwarder] Co ${this.messageQueue.length} tin nhan, dang gui...`,
          );
          await this._forwardAll();
        } else {
          this.emit("log", "[Forwarder] Khong co tin nhan, tiep tuc lang nghe");
        }
        lastForwardTime = Date.now();
      } else {
        const remaining = Math.round((this.forwardInterval - elapsed) / 1000);
        this.emit("log", `[Timer] Con ${remaining}s den lan forward tiep theo`);
      }

      // Delay truoc vong tiep theo
      if (this.running) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  }

  // ─── SCAN GROUP ───────────────────────────────────────────────────────────
  //  Quet 1 nhom nguon, phat hien tin nhan moi, download anh, luu vao queue

  async _scanGroup(groupName) {
    if (!this.seenFrameIds[groupName]) {
      this.seenFrameIds[groupName] = new Set();
    }
    const seenIds = this.seenFrameIds[groupName];

    // Lay tat ca tin nhan khong phai cua minh tu DOM
    const allMessages = await this.page.evaluate(() => {
      const frames = document.querySelectorAll(
        '[id^="message-frame_"], .message-frame, .message-non-frame',
      );

      const results = [];

      for (let i = 0; i < frames.length; i++) {
        if (frames[i].classList.contains("me")) continue;

        const frameId = frames[i].id;
        if (!frameId) continue;

        // Kiem tra anh
        let imgElements = [];
        const imageContainers = frames[i].querySelectorAll(
          '.chatImageMessage--audit, .img-msg-v2.photo-message-v2, .album, [id^="album-container"]',
        );
        if (imageContainers.length > 0) {
          imageContainers.forEach((container) => {
            container.querySelectorAll('img[src^="blob:"]').forEach((img) => {
              if (!img.closest(".link-message")) imgElements.push(img);
            });
          });
        }
        if (imgElements.length === 0) {
          frames[i].querySelectorAll('img[src^="blob:"]').forEach((img) => {
            if (!img.closest(".link-message")) imgElements.push(img);
          });
        }

        // Lay text
        let text = "";
        const textContainer = frames[i].querySelector(
          '[data-component="message-text-content"]',
        );
        if (textContainer) {
          text = textContainer.innerText || textContainer.textContent || "";
        }
        if (!text.trim()) {
          const imgCaption = frames[i].querySelector(
            '.img-msg-v2__cap [data-component="message-text-content"]',
          );
          if (imgCaption) {
            text = imgCaption.innerText || imgCaption.textContent || "";
          }
        }
        if (!text.trim()) {
          const msgContainer = frames[i].querySelector(".text-message__container");
          if (msgContainer) text = msgContainer.innerText || msgContainer.textContent || "";
        }
        if (!text.trim()) {
          const textSpan = frames[i].querySelector("span.text");
          if (textSpan) {
            text = textSpan.innerText || "";
            if (!text.trim()) {
              let html = textSpan.innerHTML;
              html = html.replace(/<br\s*\/?>/gi, "\n");
              html = html.replace(/<\/(div|p)>/gi, "\n");
              html = html.replace(/<[^>]*>/g, "");
              const tmp = document.createElement("textarea");
              tmp.innerHTML = html;
              text = tmp.value;
            }
          }
        }
        text = text.trim();

        if (imgElements.length === 0 && !text) continue;

        const images = imgElements.map((img, idx) => ({
          src: img.src,
          id: img.id || `unknown_${idx}`,
          width: img.width || 0,
          height: img.height || 0,
        }));

        results.push({ frameId, text, images });
      }

      return results;
    });

    // Lan quet dau tien cho nhom nay: danh dau tat ca la da thay
    if (!this.groupInitialized[groupName]) {
      for (const msg of allMessages) seenIds.add(msg.frameId);
      this.groupInitialized[groupName] = true;
      this.emit(
        "log",
        `[${groupName}] Khoi tao, ${allMessages.length} tin nhan hien co`,
      );
      return;
    }

    // Tim tin nhan moi
    const newMessages = allMessages.filter((m) => !seenIds.has(m.frameId));
    if (newMessages.length === 0) {
      this.emit("log", `[${groupName}] Khong co tin nhan moi`);
      return;
    }

    // Phat hien page refresh: khong co overlap
    const hasOverlap = allMessages.some((m) => seenIds.has(m.frameId));
    if (!hasOverlap) {
      this.emit("log", `[${groupName}] Page refresh, khoi tao lai...`);
      seenIds.clear();
      for (const msg of allMessages) seenIds.add(msg.frameId);
      return;
    }

    this.emit("log", `[${groupName}] ${newMessages.length} tin nhan moi`);

    // Xu ly tung tin nhan moi - download anh TRUOC khi navigate di
    for (const msg of newMessages) {
      seenIds.add(msg.frameId);

      const timestamp = Date.now();
      const msgId = `${timestamp}_${Math.random().toString(36).slice(2, 7)}`;
      const hasImages = msg.images.length > 0;
      const hasText = !!msg.text;

      if (!hasImages && hasText) {
        this.emit("log", `[${groupName}] Text: "${msg.text.substring(0, 60)}"`);
        await this.appendMessage({
          id: msgId,
          sourceGroup: groupName,
          type: "text",
          content: msg.text,
          timestamp,
        });
      } else if (hasImages && !hasText) {
        if (msg.images.length === 1) {
          this.emit("log", `[${groupName}] Anh don`);
          const fileName = `image_${timestamp}.jpg`;
          const filePath = await this._downloadImage(
            this.page,
            msg.images[0].src,
            fileName,
          );
          if (filePath) {
            await this.appendMessage({
              id: msgId,
              sourceGroup: groupName,
              type: "image",
              filePath,
              timestamp,
            });
          }
        } else {
          this.emit("log", `[${groupName}] Album ${msg.images.length} anh`);
          const filePaths = [];
          for (let idx = 0; idx < msg.images.length; idx++) {
            const fileName = `image_${timestamp}_${idx + 1}.jpg`;
            const fp = await this._downloadImage(
              this.page,
              msg.images[idx].src,
              fileName,
            );
            if (fp) filePaths.push(fp);
            await new Promise((r) => setTimeout(r, 300));
          }
          if (filePaths.length > 0) {
            await this.appendMessage({
              id: msgId,
              sourceGroup: groupName,
              type: "images",
              filePaths,
              count: filePaths.length,
              timestamp,
            });
          }
        }
      } else if (hasImages && hasText) {
        if (msg.images.length === 1) {
          this.emit("log", `[${groupName}] Anh + caption`);
          const fileName = `image_${timestamp}.jpg`;
          const filePath = await this._downloadImage(
            this.page,
            msg.images[0].src,
            fileName,
          );
          if (filePath) {
            await this.appendMessage({
              id: msgId,
              sourceGroup: groupName,
              type: "image_with_text",
              filePath,
              caption: msg.text,
              timestamp,
            });
          }
        } else {
          this.emit("log", `[${groupName}] Album ${msg.images.length} anh + caption`);
          const filePaths = [];
          for (let idx = 0; idx < msg.images.length; idx++) {
            const fileName = `image_${timestamp}_${idx + 1}.jpg`;
            const fp = await this._downloadImage(
              this.page,
              msg.images[idx].src,
              fileName,
            );
            if (fp) filePaths.push(fp);
            await new Promise((r) => setTimeout(r, 300));
          }
          if (filePaths.length > 0) {
            await this.appendMessage({
              id: msgId,
              sourceGroup: groupName,
              type: "images_with_text",
              filePaths,
              count: filePaths.length,
              caption: msg.text,
              timestamp,
            });
          }
        }
      }
    }

    // Gioi han seenIds size
    if (seenIds.size > 500) {
      const arr = [...seenIds];
      this.seenFrameIds[groupName] = new Set(arr.slice(-300));
    }

    // Luu state
    const stateData = this.loadState();
    stateData[groupName] = {
      lastFrameId: newMessages[newMessages.length - 1].frameId,
      timestamp: Date.now(),
    };
    this.saveState(stateData);
  }

  // ─── FORWARD ALL ──────────────────────────────────────────────────────────
  //  Vao nhom dich, gui tung tin nhan, xoa khoi queue, roi quay lai

  async _forwardAll() {
    try {
      this.emit("log", `[Forwarder] Vao nhom dich "${this.targetGroup}"...`);
      await this._navigateToGroup(this.page, this.targetGroup);
      await new Promise((r) => setTimeout(r, 2000));

      const toForward = await this._withQueueLock(() => [...this.messageQueue]);
      const forwarded = [];
      const failed = [];
      const MAX_RETRIES = 3;
      const MAX_AGE_MS = 30 * 60 * 1000; // 30 phut

      for (const msg of toForward) {
        if (!this.running) break;

        // Bo qua message qua cu hoac qua nhieu lan retry
        if ((msg.retryCount || 0) >= MAX_RETRIES) {
          this.emit("log", `[Forwarder] Bo qua msg ${msg.id} (qua ${MAX_RETRIES} lan retry)`);
          this._deleteMessageFiles(msg);
          forwarded.push(msg.id);
          continue;
        }
        if (msg.createdAt && Date.now() - msg.createdAt > MAX_AGE_MS) {
          this.emit("log", `[Forwarder] Bo qua msg ${msg.id} (qua 30 phut)`);
          this._deleteMessageFiles(msg);
          forwarded.push(msg.id);
          continue;
        }

        try {
          await this._forwardMessage(this.page, msg);
          forwarded.push(msg.id);
        } catch (err) {
          this.emit("error", `[Forwarder] Loi gui msg ${msg.id}: ${err.message}`);
          failed.push(msg.id);
        }
      }

      // Cap nhat queue
      if (forwarded.length > 0 || failed.length > 0) {
        await this._withQueueLock(() => {
          this.messageQueue = this.messageQueue
            .filter((m) => !forwarded.includes(m.id))
            .map((m) => {
              if (failed.includes(m.id)) {
                return { ...m, retryCount: (m.retryCount || 0) + 1 };
              }
              return m;
            });
          this._flushQueueToDisk();
        });
      }

      if (forwarded.length > 0) {
        this.emit("log", `[Forwarder] Da gui ${forwarded.length} tin nhan`);
      }
      if (failed.length > 0) {
        this.emit("log", `[Forwarder] ${failed.length} tin nhan loi, se thu lai lan sau`);
      }
    } catch (err) {
      this.emit("error", `[Forwarder] Loi: ${err.message}`);
    }
  }

  _deleteMessageFiles(msg) {
    const files = msg.filePath ? [msg.filePath] : msg.filePaths || [];
    for (const fp of files) {
      try {
        const abs = path.resolve(fp);
        if (fs.existsSync(abs)) fs.unlinkSync(abs);
      } catch { /* ignore */ }
    }
  }

  // ─── NAVIGATION ───────────────────────────────────────────────────────────

  async _gotoZalo(page) {
    let retries = 0;
    while (retries < 3) {
      try {
        await page.goto("https://chat.zalo.me/", {
          waitUntil: "networkidle2",
          timeout: 60000,
        });
        return;
      } catch (err) {
        retries++;
        if (retries >= 3) throw err;
        this.emit("log", `Retry tai Zalo (${retries}/3)...`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  async _waitForZaloReady(page) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await page.waitForSelector("#contact-search-input", { timeout: 30000 });
        return;
      } catch {
        this.emit("log", `Zalo chua san sang, reload (${attempt}/3)...`);
        await page.reload({ waitUntil: "networkidle2", timeout: 60000 });
      }
    }
    throw new Error("Khong the tai Zalo sau 3 lan thu");
  }

  async _navigateToGroup(page, groupName) {
    // 1. Focus va xoa search input truoc khi type
    const searchInput = await page.$("#contact-search-input");
    if (!searchInput) throw new Error("Khong tim thay #contact-search-input");

    await searchInput.click();
    await new Promise((r) => setTimeout(r, 300));

    // Xoa text cu trong search input
    await page.keyboard.down("Control");
    await page.keyboard.press("KeyA");
    await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");
    await new Promise((r) => setTimeout(r, 300));

    // 2. Type ten nhom va cho ket qua search
    await searchInput.type(groupName, { delay: 30 });
    await new Promise((r) => setTimeout(r, 2000));

    // 3. Nhan Enter de chon ket qua dau tien
    await page.keyboard.press("Enter");
    await new Promise((r) => setTimeout(r, 2500));

    // 4. Xoa search input sau khi da vao nhom
    const searchInput2 = await page.$("#contact-search-input");
    if (searchInput2) {
      await searchInput2.click({ clickCount: 3 });
      await page.keyboard.press("Backspace");
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  // ─── FORWARD MESSAGE (giu nguyen logic cu) ────────────────────────────────

  async _forwardMessage(page, msg) {
    if (msg.type === "text") {
      this.emit("log", `  -> Text: "${msg.content.substring(0, 50)}"`);

      const richInput = await page.$("#richInput");
      if (!richInput) throw new Error("Khong tim thay #richInput");

      await richInput.click();
      await new Promise((r) => setTimeout(r, 200));

      await page.keyboard.down("Control");
      await page.keyboard.press("KeyA");
      await page.keyboard.up("Control");
      await page.keyboard.press("Backspace");
      await new Promise((r) => setTimeout(r, 100));

      const content = (await transformText(msg.content)) || msg.content;
      await this._typeMultiline(page, richInput, content);

      await new Promise((r) => setTimeout(r, 200));
      await page.keyboard.press("Enter");
      await new Promise((r) => setTimeout(r, 800));
    } else if (msg.type === "image") {
      this.emit("log", "  -> Anh don");
      await this._dropFiles(page, [msg.filePath]);
      await new Promise((r) => setTimeout(r, 2500));
      await this._clickSendOrEnter(page);
      await new Promise((r) => setTimeout(r, 1500));
      this._deleteFiles([msg.filePath]);
    } else if (msg.type === "images") {
      this.emit("log", `  -> Album ${msg.count} anh`);
      await this._dropFiles(page, msg.filePaths);
      await new Promise((r) => setTimeout(r, 3000));
      await this._clickSendOrEnter(page);
      await new Promise((r) => setTimeout(r, 2000));
      this._deleteFiles(msg.filePaths);
    } else if (msg.type === "image_with_text") {
      this.emit("log", "  -> Anh + caption");
      await this._dropFiles(page, [msg.filePath]);
      await new Promise((r) => setTimeout(r, 2500));

      const richInput = await page.$("#richInput");
      if (richInput) {
        await richInput.click();
        await new Promise((r) => setTimeout(r, 200));
        const caption = (await transformText(msg.caption)) || msg.caption;
        await this._typeMultiline(page, richInput, caption);
      }
      await new Promise((r) => setTimeout(r, 500));
      await page.keyboard.press("Enter");
      await new Promise((r) => setTimeout(r, 2000));
      this._deleteFiles([msg.filePath]);
    } else if (msg.type === "images_with_text") {
      this.emit("log", `  -> Album ${msg.count} anh + caption`);
      await this._dropFiles(page, msg.filePaths);
      await new Promise((r) => setTimeout(r, 2500));

      const richInput = await page.$("#richInput");
      if (richInput) {
        await richInput.click();
        await new Promise((r) => setTimeout(r, 200));
        const caption = (await transformText(msg.caption)) || msg.caption;
        await this._typeMultiline(page, richInput, caption);
      }
      await new Promise((r) => setTimeout(r, 500));
      await page.keyboard.press("Enter");
      await new Promise((r) => setTimeout(r, 2000));
      this._deleteFiles(msg.filePaths);
    }
  }

  async _typeMultiline(page, inputElement, text) {
    if (text.includes("\n")) {
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (lines[i]) await inputElement.type(lines[i], { delay: 5 });
        if (i < lines.length - 1) {
          await page.keyboard.down("Shift");
          await page.keyboard.press("Enter");
          await page.keyboard.up("Shift");
          await new Promise((r) => setTimeout(r, 30));
        }
      }
    } else {
      await inputElement.type(text, { delay: 5 });
    }
  }

  async _dropFiles(page, filePaths) {
    const validPaths = filePaths
      .map((fp) => path.resolve(fp))
      .filter((fp) => {
        if (fs.existsSync(fp)) return true;
        this.emit("error", `File khong ton tai: ${fp}`);
        return false;
      });

    if (validPaths.length === 0) throw new Error("Khong co file hop le de gui");

    const filesData = validPaths.map((fp) => ({
      name: path.basename(fp),
      base64: fs.readFileSync(fp).toString("base64"),
      mimeType: "image/jpeg",
    }));

    const dropSelectors = [
      ".dragOverlayInputbox",
      "#richInput",
      '[data-id="richInput"]',
      ".chat-input",
      ".input-area",
    ];

    let usedSelector = null;
    for (const selector of dropSelectors) {
      const el = await page.$(selector);
      if (el) { usedSelector = selector; break; }
    }

    if (!usedSelector) throw new Error("Khong tim thay vung drop");

    await page.evaluate(
      async (selector, filesData) => {
        const element = document.querySelector(selector);
        if (!element) throw new Error(`Element ${selector} not found`);

        const dataTransfer = new DataTransfer();
        for (const fileData of filesData) {
          const bytes = atob(fileData.base64);
          const arr = new Uint8Array(bytes.length);
          for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
          const blob = new Blob([arr], { type: fileData.mimeType });
          dataTransfer.items.add(new File([blob], fileData.name, { type: fileData.mimeType }));
        }

        const opts = { bubbles: true, cancelable: true, dataTransfer };
        element.dispatchEvent(new DragEvent("dragenter", opts));
        element.dispatchEvent(new DragEvent("dragover", opts));
        element.dispatchEvent(new DragEvent("drop", opts));
      },
      usedSelector,
      filesData,
    );
  }

  async _clickSendOrEnter(page) {
    const sendSelectors = [
      'button[data-translate-inner="STR_SEND"]',
      "button.btn-send",
      'button[title*="Gui"]',
      'button[aria-label*="Send"]',
      ".btn-send-photo",
    ];
    for (const selector of sendSelectors) {
      try {
        const btn = await page.$(selector);
        if (btn) { await btn.click(); return; }
      } catch { /* ignore */ }
    }
    await page.keyboard.press("Enter");
  }

  _deleteFiles(filePaths) {
    for (const fp of filePaths) {
      const abs = path.resolve(fp);
      try {
        if (fs.existsSync(abs)) {
          fs.unlinkSync(abs);
          this.emit("log", `  Da xoa: ${path.basename(abs)}`);
        }
      } catch (err) {
        this.emit("error", `Khong xoa duoc: ${path.basename(abs)}`);
      }
    }
  }

  // ─── DOWNLOAD IMAGE ───────────────────────────────────────────────────────

  async _downloadImage(page, blobUrl, fileName) {
    try {
      this.emit("log", `  Download: ${fileName}`);

      const base64Data = await page.evaluate(async (url) => {
        try {
          const response = await fetch(url);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const blob = await response.blob();
          return await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = () => reject(new Error("FileReader error"));
            reader.readAsDataURL(blob);
          });
        } catch (err) {
          return `ERROR: ${err.message}`;
        }
      }, blobUrl);

      if (typeof base64Data === "string" && base64Data.startsWith("ERROR:")) {
        throw new Error(base64Data);
      }
      if (!base64Data || !base64Data.includes("base64,")) {
        throw new Error("Invalid base64 data");
      }

      const base64Image = base64Data.split(";base64,").pop();
      const filePath = path.resolve(IMAGES_PATH, fileName);
      fs.writeFileSync(filePath, base64Image, { encoding: "base64" });

      const size = fs.statSync(filePath).size;
      this.emit("log", `  Saved: ${fileName} (${(size / 1024).toFixed(1)} KB)`);
      return filePath;
    } catch (error) {
      this.emit("error", `  Loi download anh: ${error.message}`);
      return null;
    }
  }

  // ─── STOP ─────────────────────────────────────────────────────────────────

  async stop() {
    this.running = false;
    this.page = null;

    if (this.browser) {
      try {
        await this.browser.close();
      } catch { /* ignore */ }
      this.browser = null;
    }

    this._flushQueueToDisk();
    this.emit("status", "Bot da dung");
  }
}

module.exports = Bot;
