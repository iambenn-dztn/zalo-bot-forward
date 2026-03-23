const puppeteer = require('puppeteer');

// --- CẤU HÌNH ---
const SOURCE_GROUP = "Nhóm 1";
const TARGET_GROUP = "Nhóm 2";
const CHECK_INTERVAL = 3000; // Kiểm tra mỗi 3 giây

async function runBot() {
    // Khởi tạo trình duyệt với thư mục lưu session để không phải quét QR lại
    const browser = await puppeteer.launch({
        headless: false, // Hiện trình duyệt để bạn quét mã QR
        userDataDir: './zalo_session',
        args: ['--start-maximized']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });
    await page.goto('https://chat.zalo.me/', { waitUntil: 'networkidle2' });

    console.log("Vui lòng đăng nhập Zalo Web...");

    // Chờ cho đến khi thanh tìm kiếm xuất hiện (đã đăng nhập thành công)
    await page.waitForSelector('#contact-search-input', { timeout: 0 });
    console.log("Đăng nhập thành công!");

    // Vào Nhóm 1 một lần duy nhất
    console.log(`🔍 Đang tìm và truy cập ${SOURCE_GROUP}...`);
    await page.type('#contact-search-input', SOURCE_GROUP);
    await new Promise(resolve => setTimeout(resolve, 1500));
    await page.keyboard.press('Enter');
    await new Promise(resolve => setTimeout(resolve, 2500));
    
    // Xóa thanh tìm kiếm
    const searchInput = await page.$('#contact-search-input');
    await searchInput.click({ clickCount: 3 });
    await page.keyboard.press('Backspace');
    await new Promise(resolve => setTimeout(resolve, 500));
    
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
                console.log(`🔄 Đang chuyển sang ${TARGET_GROUP}...`);
                const search = await page.$('#contact-search-input');
                await search.click({ clickCount: 3 });
                await page.keyboard.press('Backspace');
                await page.type('#contact-search-input', TARGET_GROUP);
                await new Promise(resolve => setTimeout(resolve, 1500));
                await page.keyboard.press('Enter');
                await new Promise(resolve => setTimeout(resolve, 2000));

                // 4. Gửi tin nhắn
                await page.type('#rich-input', `${currentMsg}`);
                await page.keyboard.press('Enter');
                await new Promise(resolve => setTimeout(resolve, 1000));
                console.log(`✅ Đã forward sang ${TARGET_GROUP}`);

                // 5. Quay lại Nhóm 1
                console.log(`🔙 Quay lại ${SOURCE_GROUP}...`);
                const search2 = await page.$('#contact-search-input');
                await search2.click({ clickCount: 3 });
                await page.keyboard.press('Backspace');
                await page.type('#contact-search-input', SOURCE_GROUP);
                await new Promise(resolve => setTimeout(resolve, 1500));
                await page.keyboard.press('Enter');
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                // Xóa thanh tìm kiếm
                const search3 = await page.$('#contact-search-input');
                await search3.click({ clickCount: 3 });
                await page.keyboard.press('Backspace');
                console.log(`✅ Đã quay lại ${SOURCE_GROUP}\n`);
            }
        } catch (error) {
            console.error("❌ Lỗi:", error.message);
        }
    }, CHECK_INTERVAL);
}

runBot();