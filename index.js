const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Thêm stealth plugin để tránh bị phát hiện bot
puppeteer.use(StealthPlugin());

// --- CẤU HÌNH ---
const SOURCE_GROUP = "Nhóm 1";
const TARGET_GROUP = "Nhóm 2";
const CHECK_INTERVAL = 3000; // Kiểm tra mỗi 3 giây

async function runBot() {
    // Khởi tạo trình duyệt với stealth và tối ưu hiệu suất
    const browser = await puppeteer.launch({
        headless: false, // Hiện trình duyệt để bạn quét mã QR
        userDataDir: './zalo_session',
        args: [
            '--start-maximized',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--disable-blink-features=AutomationControlled'
        ],
        defaultViewport: null
    });

    const page = await browser.newPage();
    
    // Chặn các tài nguyên không cần thiết để tăng tốc
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        const resourceType = req.resourceType();
        if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
            req.abort();
        } else {
            req.continue();
        }
    });
    
    // Tối ưu user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
    await page.goto('https://chat.zalo.me/', { waitUntil: 'networkidle2' });

    console.log("Vui lòng đăng nhập Zalo Web...");

    // Chờ cho đến khi thanh tìm kiếm xuất hiện (đã đăng nhập thành công)
    await page.waitForSelector('#contact-search-input', { timeout: 0 });
    console.log("Đăng nhập thành công!");

    // Vào Nhóm 1 một lần duy nhất
    console.log(`🔍 Đang tìm và truy cập ${SOURCE_GROUP}...`);
    await page.type('#contact-search-input', SOURCE_GROUP, { delay: 50 }); // Thêm delay tự nhiên
    await page.waitForTimeout(1500);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2500);
    
    // Xóa thanh tìm kiếm
    const searchInput = await page.$('#contact-search-input');
    if (searchInput) {
        await searchInput.click({ clickCount: 3 });
        await page.keyboard.press('Backspace');
        await page.waitForTimeout(500);
    }
    
    console.log(`✅ Đã vào ${SOURCE_GROUP}. Bắt đầu quét tin nhắn mỗi ${CHECK_INTERVAL/1000}s...\n`);

    let lastMessage = "";

    setInterval(async () => {
        try {
            // 1. Quét tin nhắn trong Nhóm 1 (đã ở trong nhóm rồi)
            const currentMsg = await page.evaluate(() => {
                const msgs = document.querySelectorAll('.content.text');
                return msgs.length > 0 ? msgs[msgs.length - 1].innerText : "";
            });

            // 2. Nếu có tin mới, forward sang Nhóm 2
            if (currentMsg && currentMsg !== lastMessage) {
                console.log(`📨 Tin mới: "${currentMsg}"`);
                lastMessage = currentMsg;

                // 3. Tìm và vào Nhóm 2
                if (search) {
                    await search.click({ clickCount: 3 });
                    await page.keyboard.press('Backspace');
                    await page.type('#contact-search-input', TARGET_GROUP, { delay: 50 });
                    await page.waitForTimeout(1500);
                    await page.keyboard.press('Enter');
                    await page.waitForTimeout(2000);

                    // 4. Gửi tin nhắn
                    await page.type('#rich-input', `${currentMsg}`, { delay: 30 });
                    await page.keyboard.press('Enter');
                    await page.waitForTimeout(1000);
                    console.log(`✅ Đã forward sang ${TARGET_GROUP}`);

                    // 5. Quay lại Nhóm 1
                    console.log(`🔙 Quay lại ${SOURCE_GROUP}...`);
                    const search2 = await page.$('#contact-search-input');
                    if (search2) {
                        await search2.click({ clickCount: 3 });
                        await page.keyboard.press('Backspace');
                        await page.type('#contact-search-input', SOURCE_GROUP, { delay: 50 });
                        await page.waitForTimeout(1500);
                        await page.keyboard.press('Enter');
                        await page.waitForTimeout(2000);
                        
                        // Xóa thanh tìm kiếm
                        const search3 = await page.$('#contact-search-input');
                        if (search3) {
                            await search3.click({ clickCount: 3 });
                            await page.keyboard.press('Backspace');
                        }
                        console.log(`✅ Đã quay lại ${SOURCE_GROUP}\n`);
                    }
                }
                await page.keyboard.press('Backspace');
                console.log(`✅ Đã quay lại ${SOURCE_GROUP}\n`);
            }
        } catch (error) {
            console.error("❌ Lỗi:", error.message);
        }
    }, CHECK_INTERVAL);
}

runBot();