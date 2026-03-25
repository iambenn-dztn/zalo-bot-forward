# Zalo Bot Forward - Desktop App

Ứng dụng desktop để tự động forward tin nhắn từ nhóm Zalo này sang nhóm Zalo khác.

## Tính năng

- ✅ Giao diện desktop đẹp mắt, dễ sử dụng
- ✅ Tự động đăng nhập Zalo qua QR code
- ✅ **Chế độ ẩn (headless)**: Sau khi login lần đầu, bot chạy ngầm không hiện cửa sổ
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
4. (Tùy chọn) Điều chỉnh thời gian quét (mặc định: 3000ms = 3 giây)
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
├── zalo_session/     # Thư mục lưu session Zalo
└── dist/             # Thư mục chứa file build (sau khi chạy npm run build)
```

## Lưu ý

- **Lần đầu chạy**: Cần quét QR code để đăng nhập Zalo. Sau đó cửa sổ Chrome sẽ tự động đóng lại.
- **Các lần sau**: Bot chạy ở chế độ ẩn (headless), không hiển thị cửa sổ Chrome
- **Session được lưu**: Không cần quét QR mỗi lần chạy
- **Đổi tài khoản**: Xóa thư mục `zalo_session/` để đăng nhập tài khoản khác
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

## License

MIT
