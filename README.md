# Zalo Bot Forward - Desktop App

Ứng dụng desktop để tự động forward tin nhắn từ nhóm Zalo này sang nhóm Zalo khác.

## Tính năng

- ✅ Giao diện desktop đẹp mắt, dễ sử dụng
- ✅ Tự động đăng nhập Zalo qua QR code
- ✅ **Chế độ ẩn (headless)**: Sau khi login lần đầu, bot chạy ngầm không hiện cửa sổ
- ✅ **Debounce 5 giây**: Batch tin nhắn lại, chỉ gửi khi không có tin mới trong 5 giây
- ✅ **Hỗ trợ tin nhắn nhiều dòng**: Forward đầy đủ tin nhắn dài, giữ nguyên format xuống dòng
- ✅ **Nhớ tin nhắn cuối**: Khi dừng và start lại, bot không gửi lại tin nhắn đã forward
- ✅ Tự động quét và forward tin nhắn giữa các nhóm
- ✅ Hiển thị log hoạt động realtime
- ✅ Có thể build thành file .exe để chạy độc lập

## Cài đặt

```bash
npm install
```

## Chạy ứng dụng

```bash
npm start
```

## Build thành file .exe

### Build cho Windows:

```bash
npm run build:win
```

File .exe sẽ được tạo trong thư mục `dist/`

## Hướng dẫn sử dụng

1. Mở ứng dụng
2. Nhập tên **Nhóm nguồn** (nhóm cần lấy tin nhắn)
3. Nhập tên **Nhóm đích** (nhóm cần gửi tin nhắn đến)
4. (Tùy chọn) Điều chỉnh thời gian quét (mặc định: 1000ms = 3 giây)
5. Nhấn nút **"Bắt đầu"**

### Lần đầu tiên chạy (chưa có session):

- Một cửa sổ Chrome sẽ mở ra để quét QR code
- Sau khi đăng nhập thành công, cửa sổ Chrome sẽ **tự động đóng lại**
- Bot sẽ khởi động lại ở **chế độ ẩn** (headless) và bắt đầu forward tin nhắn
- Các lần chạy sau sẽ không cần quét QR nữa

### Các lần chạy sau (đã có session):

- Bot sẽ tự động chạy ở **chế độ ẩn** ngay từ đầu
- Không hiển thị cửa sổ Chrome ra ngoài
- Chỉ forward tin nhắn ngầm và ghi log trong ứng dụng

6. Theo dõi hoạt động qua phần "Nhật ký hoạt động"
7. Nhấn **"Dừng lại"** để dừng bot

## Cấu trúc dự án

```
zalo-bot-forward/
├── main.js           # Electron main process
├── bot.js            # Bot logic module
├── renderer.js       # UI logic (IPC với main process)
├── index.html        # Giao diện UI
├── styles.css        # CSS styling
├── package.json      # Config & dependencies
├── bot_state.json    # Lưu tin nhắn cuối (auto-generated)
├── zalo_session/     # Thư mục lưu session Zalo
└── dist/             # Thư mục chứa file build (sau khi chạy npm run build)
```

## Lưu ý

- **Lần đầu chạy**: Cần quét QR code để đăng nhập Zalo. Sau đó cửa sổ Chrome sẽ tự động đóng lại.
- **Các lần sau**: Bot chạy ở chế độ ẩn (headless), không hiển thị cửa sổ Chrome
- **Session được lưu**: Không cần quét QR mỗi lần chạy
- **Debounce mechanism**: Bot **không gửi ngay lập tức**. Thay vào đó:
  - Khi có tin nhắn mới → thêm vào queue
  - Đợi 5 giây không có tin mới → gửi tất cả tin trong queue
  - **Lợi ích**: Nếu có nhiều tin liên tiếp trong 5s, bot sẽ batch lại và gửi 1 lần thay vì gửi từng tin
- **Nhớ tin nhắn cuối**: Bot lưu tin nhắn cuối vào `bot_state.json`. Khi dừng và start lại, bot sẽ không gửi lại tin nhắn đã forward
- **Đổi tài khoản**: Xóa thư mục `zalo_session/` để đăng nhập tài khoản khác
- **Reset bot**: Xóa `bot_state.json` để xóa tin nhắn cuối đã lưu
- **Thời gian quét**: Nên >= 2000ms để tránh bị Zalo chặn
- **Chạy ngầm**: Sau khi login, bot sẽ forward tin nhắn ngầm ở background mà không hiển thị trình duyệt

## Troubleshooting

### Lỗi "Chrome đã mở"

```bash
pkill -9 -f Chrome && rm -f zalo_session/SingletonLock
```

### Reset hoàn toàn (xóa session)

```bash
pkill -9 -f Chrome && rm -rf zalo_session
```

### Reset tin nhắn cuối (gửi lại từ đầu)

```bash
rm -f bot_state.json
```

### Reset tất cả (session + state)

```bash
pkill -9 -f Chrome && rm -rf zalo_session && rm -f bot_state.json
```

## License

MIT
