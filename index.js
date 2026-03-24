const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");

puppeteer.use(StealthPlugin());

const SOURCE_GROUP = "Nhóm 1";
const TARGET_GROUP = "Nhóm 2";
const CHECK_INTERVAL = 3000;

async function runBot() {
  const sessionPath = "./zalo_session";
  const hasSession = fs.existsSync(path.join(sessionPath, "Default"));

  const browser = await puppeteer.launch({
    headless: hasSession,
    userDataDir: sessionPath,
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

  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 768 });
  await page.goto("https://chat.zalo.me/", { waitUntil: "networkidle2" });

  if (!hasSession) {
    console.log("⏳ Vui lòng quét QR code để đăng nhập...");
  }

  await page.waitForSelector("#contact-search-input", { timeout: 0 });
  console.log("✅ Đã đăng nhập");

  await page.type("#contact-search-input", SOURCE_GROUP);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await page.keyboard.press("Enter");
  await new Promise((resolve) => setTimeout(resolve, 2500));

  const searchInput = await page.$("#contact-search-input");
  await searchInput.click({ clickCount: 3 });
  await page.keyboard.press("Backspace");
  await new Promise((resolve) => setTimeout(resolve, 500));

  console.log(`✅ Đã vào ${SOURCE_GROUP}, bắt đầu quét...\n`);

  let lastMessage = "";
  let scanCount = 0;

  setInterval(async () => {
    try {
      scanCount++;
      console.log(
        `[${new Date().toLocaleTimeString()}] 🔍 Quét lần #${scanCount}...`,
      );

      const currentMsg = await page.evaluate(() => {
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

      if (currentMsg && currentMsg !== lastMessage) {
        console.log(`📨 "${currentMsg}"`);
        lastMessage = currentMsg;

        const search = await page.$("#contact-search-input");
        await search.click({ clickCount: 3 });
        await page.keyboard.press("Backspace");
        await page.type("#contact-search-input", TARGET_GROUP);
        await new Promise((resolve) => setTimeout(resolve, 1500));
        await page.keyboard.press("Enter");
        await new Promise((resolve) => setTimeout(resolve, 2000));

        await page.type("#richInput", `${currentMsg}`);
        await page.keyboard.press("Enter");
        await new Promise((resolve) => setTimeout(resolve, 1000));

        const search2 = await page.$("#contact-search-input");
        await search2.click({ clickCount: 3 });
        await page.keyboard.press("Backspace");
        await page.type("#contact-search-input", SOURCE_GROUP);
        await new Promise((resolve) => setTimeout(resolve, 1500));
        await page.keyboard.press("Enter");
        await new Promise((resolve) => setTimeout(resolve, 2000));

        const search3 = await page.$("#contact-search-input");
        await search3.click({ clickCount: 3 });
        await page.keyboard.press("Backspace");

        console.log(`✅ Đã forward\n`);
      }
    } catch (error) {
      if (!error.message.includes("detached Frame")) {
        console.error(`❌ ${error.message}`);
      }
    }
  }, CHECK_INTERVAL);
}

runBot();
