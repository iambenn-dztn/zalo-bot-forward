# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Electron desktop app that automatically forwards messages from multiple Zalo source groups to a single target Zalo group. Uses Puppeteer (with stealth plugin) to automate Zalo Web — one browser tab per source group (listeners) plus one tab for the target group (forwarder), communicating via a JSON file queue (`messages.json`).

UI and comments are in Vietnamese.

## Commands

```bash
npm install          # Install dependencies
npm start            # Run in dev mode (Electron)
npm run build:win    # Build Windows .exe installer (output in dist/)
```

No test suite or linter is configured.

## Architecture

**Electron IPC flow:** `index.html` + `renderer.js` (UI) → IPC → `main.js` (Electron main process) → `Bot` class in `bot.js`

### Bot class (`bot.js`) — extends EventEmitter

`start()` flow:
1. Launches Puppeteer browser — headless if `zalo_session/` exists (reuses login), visible if first run (shows QR code). After QR login, closes browser and relaunches headless.
2. Opens N listener tabs — each navigates to a source group on `chat.zalo.me`
3. Opens 1 forwarder tab — navigates to the target group
4. Starts `setInterval` loops for both listening and forwarding

**Listener** (`_startListening`): Polls Zalo DOM at `checkInterval` (default 1s) via `page.evaluate()`. Scans message frames from bottom up (newest first), skips own messages (`.me` class), extracts text and/or blob image URLs. Downloads images from blob URLs to `./images/` on the listener tab's page context (blob URLs are tab-scoped). Appends structured messages to `messages.json`.

**Forwarder** (`_startForwarding`): Polls `messages.json` at `forwardInterval` (default 5s). For each message: types text into `#richInput` (using Shift+Enter for newlines), or drag-and-drops image files via simulated DragEvent. Removes successfully forwarded messages from queue. Deletes temp image files after sending.

**Message types:** `text`, `image`, `images`, `image_with_text`, `images_with_text`

### Text transformation (`util.js`)

`transformText()` calls an external API (`jtik-server.onrender.com`) to transform text before forwarding. `replaceSpecialLinks()` rewrites specific URL patterns (shopee, facebook links). Falls back to link replacement only if the API is unreachable.

### Dedup and state (`bot_state.json`)

Each listener stores its last-seen message (per group name key) in `bot_state.json`. On restart, the listener compares the current latest message against saved state to avoid re-forwarding.

### Queue concurrency

Multiple listener tabs write to `messages.json` concurrently. `appendMessage()` uses a retry loop (up to 5 attempts with busy-wait) to handle file contention.

## Key State Files (runtime, gitignored)

| File/Folder | Purpose |
|---|---|
| `./zalo_session/` | Chrome user data dir (persists Zalo login) |
| `./messages.json` | Pending message queue (listener → forwarder) |
| `./bot_state.json` | Per-group last-forwarded message tracking |
| `./images/` | Temp image storage (deleted after forwarding) |

## Known Issues

- Chrome executable path is hardcoded to `C:\Program Files\Google\Chrome\Application\chrome.exe` in the headless relaunch — only works on Windows with Chrome in the default location.
- `bot.js` has dead/duplicate code after line ~685 (`module.exports = Bot`) — leftover from the old implementation that should be cleaned up.
- Electron uses `contextIsolation: false` and `nodeIntegration: true` — required for the current IPC pattern but not security-best-practice.
- `PLAN.md` documents the refactoring from the old multi-session/single-tab architecture to the current listener/forwarder pattern. The refactoring is complete but cleanup (dead code, `bot.js.bak`) remains.
