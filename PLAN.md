# Plan: Refactor Zalo Bot Forward

## Mục tiêu

Đơn giản hóa kiến trúc bot, tách riêng việc **lắng nghe tin nhắn** (nhiều nhóm nguồn) và **forward tin nhắn** (1 tab duy nhất) qua file JSON trung gian.

---

## Hiện trạng (Current)

- `bot.js` (~1800 dòng): 1 class `Bot` làm tất cả — lắng nghe + forward trong cùng 1 tab, phải navigate qua lại giữa nhóm nguồn/đích.
- `main.js`: Electron main process, hỗ trợ multi-session (xóa session theo sessionId, quản lý nhiều folder session/state/images).
- `renderer.js` + `index.html`: UI nhập 1 nhóm nguồn, 1 nhóm đích.
- `index.js`: File standalone cũ (không dùng Electron).
- `util.js`: `transformText()` + `replaceSpecialLinks()` — **giữ nguyên**.
- Session management phức tạp: `zalo_session_{id}`, `bot_state_{id}.json`, `images_{id}`, `group_link_saved_{id}.flag`.

## Yêu cầu thay đổi

1. **Xóa multi-session** — chỉ 1 session duy nhất, code tối giản.
2. **Nhiều nhóm nguồn** — mỗi nhóm mở 1 tab Chrome riêng để lắng nghe, message mới → ghi vào file JSON (append only).
3. **1 tab forward** — đọc file JSON theo interval, forward tin nhắn, xong thì xóa khỏi JSON.
4. **Giữ nguyên** logic `transformText`, forward text/ảnh/album/caption.

---

## Kiến trúc mới

```
┌─────────────────────────────────────────────────────┐
│                  1 Browser Instance                  │
│                  (1 session duy nhất)                │
│                                                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐             │
│  │ Tab 1    │ │ Tab 2    │ │ Tab N    │  ← Listener │
│  │ Nhóm A   │ │ Nhóm B   │ │ Nhóm N   │    tabs     │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘             │
│       │             │            │                    │
│       └─────────────┼────────────┘                   │
│                     ▼                                │
│             messages.json  (append only)             │
│                     │                                │
│                     ▼                                │
│            ┌────────────────┐                        │
│            │ Tab Forward    │  ← 1 tab duy nhất      │
│            │ (Nhóm đích)   │    đọc JSON & gửi      │
│            └────────────────┘                        │
└─────────────────────────────────────────────────────┘
```

### File `messages.json` (queue trung gian)

```json
[
  {
    "id": "1713700000000_0",
    "sourceGroup": "Nhóm A",
    "type": "text",
    "content": "Hello world",
    "timestamp": 1713700000000
  },
  {
    "id": "1713700001000_0",
    "sourceGroup": "Nhóm B",
    "type": "image",
    "filePath": "./images/image_1713700001000.jpg",
    "timestamp": 1713700001000
  },
  {
    "id": "1713700002000_0",
    "sourceGroup": "Nhóm A",
    "type": "images_with_text",
    "filePaths": ["./images/img1.jpg", "./images/img2.jpg"],
    "caption": "Check this out",
    "count": 2,
    "timestamp": 1713700002000
  }
]
```

---

## Chi tiết thay đổi từng file

### 1. `bot.js` — Viết lại, tách thành 3 phần rõ ràng

**Xóa:**

- Toàn bộ multi-session logic (`sessionId`, `sessionPath` tạo từ group names, `stateFilePath`, `groupLinkFlagFile`).
- Logic navigate qua lại giữa nhóm nguồn ↔ đích trong cùng 1 tab (`navigateBackToSource`, `sendPendingMessages` navigate).
- Debounce timer (không cần nữa vì tách listener/forwarder).
- `extractGroupLink()`, `saveGroupLinkToAPI()`, `isGroupLinkSaved()`, `markGroupLinkSaved()` — logic lưu group link qua API.
- `downloadImage()` giữ nguyên nhưng đường dẫn images cố định (`./images/`).

**Giữ nguyên:**

- Logic scan tin nhắn trong `startScanning()` → `page.evaluate(...)` (phần đọc DOM message-frame).
- Logic forward: gửi text, image, images, image_with_text, images_with_text (drag & drop, type, Enter).
- `transformText()` call trước khi gửi.
- Puppeteer launch config, stealth plugin.

**Cấu trúc mới của `bot.js`:**

```javascript
class Bot extends EventEmitter {
  constructor(config) {
    // config: { sourceGroups: string[], targetGroup: string, checkInterval, forwardInterval }
    // Paths cố định: ./zalo_session, ./images, ./messages.json, ./bot_state.json
  }

  async start() {
    // 1. Launch 1 browser (headless nếu có session, hiện UI nếu cần QR)
    // 2. Mở N tab cho N nhóm nguồn → mỗi tab navigate vào 1 nhóm
    // 3. Mở 1 tab cho nhóm đích (forward tab)
    // 4. Start listener trên từng tab nguồn
    // 5. Start forwarder trên tab đích
  }

  // --- LISTENER ---
  async setupListenerTab(page, groupName) {
    // Navigate vào nhóm, bắt đầu quét
    // Khi có message mới → appendMessage(message)
  }

  startListening(page, groupName) {
    // setInterval quét DOM, detect message mới
    // Gọi appendMessage() khi có message mới
  }

  appendMessage(message) {
    // Đọc messages.json → push message → ghi lại
    // Append only, thread-safe (đọc-ghi atomic)
  }

  // --- FORWARDER ---
  async setupForwarderTab(page) {
    // Navigate vào nhóm đích
  }

  startForwarding(page) {
    // setInterval đọc messages.json
    // Nếu có messages → forward từng cái → xóa khỏi JSON
  }

  async forwardMessage(page, message) {
    // Giữ nguyên logic gửi text/image/images/caption hiện tại
    // transformText() trước khi gửi
  }

  // --- UTILS ---
  async downloadImage(page, blobUrl, fileName) {
    /* giữ nguyên */
  }
  readQueue() {
    /* đọc messages.json */
  }
  writeQueue(messages) {
    /* ghi messages.json */
  }
  removeFromQueue(messageIds) {
    /* xóa messages đã forward */
  }

  async stop() {
    // Dừng tất cả interval, đóng browser
  }
}
```

### 2. `main.js` — Đơn giản hóa

**Xóa:**

- `clear-session-by-id` IPC handler (multi-session).
- Logic xóa nhiều session folders/state files/images folders/flag files.

**Giữ:**

- `createWindow()`, `start-bot`, `stop-bot` IPC handlers.
- `clear-session` đơn giản: chỉ xóa `./zalo_session`, `./bot_state.json`, `./images`, `./messages.json`.

**Sửa:**

- `start-bot` handler nhận config mới: `{ sourceGroups: [...], targetGroup, checkInterval, forwardInterval }`.

### 3. `index.html` — Sửa UI

**Xóa:**

- Input đơn lẻ `sourceGroup`.

**Thêm:**

- Textarea hoặc dynamic input list cho nhiều nhóm nguồn (mỗi dòng 1 nhóm, hoặc nút "Thêm nhóm").
- Input `forwardInterval` (interval đọc JSON và forward, mặc định 5000ms).

**Giữ:**

- Input `targetGroup`, `checkInterval`.
- Nút Start/Stop, log section, status section.

### 4. `renderer.js` — Sửa theo UI mới

**Sửa:**

- Đọc danh sách nhóm nguồn từ textarea/input list → gửi dưới dạng array.
- Gửi `forwardInterval` trong config.

### 5. `util.js` — Không thay đổi

### 6. `index.js` — Xóa

File standalone cũ, không cần thiết.

### 7. Files mới / cố định

| File/Folder        | Mục đích                     |
| ------------------ | ---------------------------- |
| `./zalo_session/`  | Session Chrome duy nhất      |
| `./bot_state.json` | State: lastMessage per group |
| `./messages.json`  | Queue tin nhắn chờ forward   |
| `./images/`        | Ảnh tạm download             |

---

## Thứ tự thực hiện

| #   | Task                                                            | File(s)       |
| --- | --------------------------------------------------------------- | ------------- |
| 1   | Viết lại `bot.js` với kiến trúc listener/forwarder + JSON queue | `bot.js`      |
| 2   | Đơn giản hóa `main.js` (bỏ multi-session, sửa IPC)              | `main.js`     |
| 3   | Sửa `index.html` (UI nhiều nhóm nguồn + forwardInterval)        | `index.html`  |
| 4   | Sửa `renderer.js` (gửi config mới)                              | `renderer.js` |
| 5   | Xóa `index.js`                                                  | `index.js`    |
| 6   | Test end-to-end                                                 | —             |

---

## Lưu ý

- **JSON file locking**: Vì nhiều tab listener ghi cùng lúc, cần đọc → ghi atomic (hoặc dùng lockfile). Cách đơn giản: dùng `fs.writeFileSync` + try/catch retry.
- **Message dedup**: Mỗi listener tab cần lưu `lastMessage` riêng (trong `bot_state.json` theo key group name) để không ghi trùng.
- **Forward tab không navigate**: Tab forward đã ở nhóm đích sẵn, chỉ cần type & send, không cần navigate qua lại.
- **Ảnh download**: Blob URL chỉ valid trong context của tab đã tạo nó → `downloadImage` phải chạy trên đúng listener tab (không phải forwarder tab). Ảnh lưu vào `./images/`, forwarder tab đọc file từ disk.
