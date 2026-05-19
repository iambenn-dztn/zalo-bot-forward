# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Electron desktop app that automatically forwards Zalo messages from **one source group** to **multiple target groups**. Uses Puppeteer (with stealth plugin) to drive Zalo Web in a single browser tab — the same tab alternates between listening on the source and forwarding to each target. Communicates between Electron renderer and main process via IPC.

UI strings, log messages, and most comments are in Vietnamese.

## Commands

```bash
npm install          # Install dependencies
npm start            # Run in dev mode (Electron)
npm run build:win    # Build Windows .exe installer (output in dist/)
```

No test suite or linter is configured. There is a `.claude/skills/build-check/` skill that wraps the Windows build + output verification.

## Architecture

**IPC flow:** `index.html` + `renderer.js` → `ipcRenderer.send` → `main.js` (Electron main) → `Bot` class in `bot.js` (EventEmitter — emits `status`, `log`, `error` back to the renderer).

### Single-tab phased loop (`bot.js`)

`Bot.start()` opens **one** browser tab. First run launches non-headless so the user can scan the Zalo QR; once `#contact-search-input` appears, the browser is closed and relaunched with `headless: "new"` reusing `./zalo_session/`. The same tab is then used for everything.

`_mainLoop()` alternates two phases forever:

1. **Listen phase** — navigate to `sourceGroup`, scan its DOM every `checkInterval` ms (default 3000) for up to `forwardInterval` ms (default 60000). New messages get queued.
2. **Forward phase** — for each `targetGroup` in order: navigate to it, replay the entire queue (text via `_typeMultiline`, images via simulated `DragEvent` on `.dragOverlayInputbox` / `#richInput`). After the last target, clear the queue and delete temp image files.

This means a message is delivered to every target with at most `forwardInterval` + (N × forward time) latency.

### Message detection (`_scanGroup`)

Runs `page.evaluate()` to read `[id^="message-frame_"], .message-frame, .message-non-frame` from the DOM, skipping `.me` (own messages). Tracks seen frame IDs in an in-memory `Set` per group (`seenFrameIds[groupName]`), capped at 500 entries. The first scan after entering a group seeds the set without queueing (so old messages aren't re-forwarded). If a later scan finds zero overlap with seen IDs, it's treated as a page refresh and the set is reseeded.

**Message types:** `text`, `image`, `images`, `image_with_text`, `images_with_text`. Image extraction reads `img[src^="blob:"]` from various container selectors (`.chatImageMessage--audit`, `.img-msg-v2.photo-message-v2`, `.album`, `[id^="album-container"]`) and skips images inside `.link-message`. Blob URLs are downloaded immediately (via in-page `fetch` → base64 → `fs.writeFileSync`) because they're tab-scoped and become invalid the moment the tab navigates away.

### Queue (`messageQueue`)

In-memory array, mutated under a Promise-chain async lock (`_withQueueLock`). Flushed to `messages.json` on every append and on shutdown — the file is **recovery state**, not a cross-process queue. Loaded at construction; **cleared in `start()`** so only messages observed during the current session are forwarded. Messages older than 30 minutes are silently dropped during the forward phase.

### Text transformation (`util.js`)

`transformText()` POSTs to `https://jtik-server.onrender.com/api/shopee/transform-text` with `x-api-key` (env `API_TRANSFORM_TEXT_API_KEY`, falls back to a hardcoded default). On failure, falls back to `replaceSpecialLinks()` which rewrites `miki.shpee.cc` and `facebook.com` URLs to fixed replacements. Called for both plain text messages and image captions before sending.

### Config shape (renderer → main → Bot)

```
{ sourceGroup: string,
  targetGroups: string[],     // one per line in the UI textarea
  forwardInterval: number,    // listen window in ms, min 10000
  chromePath?: string }       // optional, falls back to Puppeteer's bundled Chrome
```

`renderer.js` parses the targets textarea by splitting on newlines. The UI enforces `forwardInterval >= 10000`.

### Session reset

The renderer's "Xóa session" button sends `clear-session`, which `main.js` handles by deleting `zalo_session/`, `bot_state.json`, `messages.json`, and `images/` in one shot. Equivalent to the manual `rm -rf` commands in `README.md`.

## Key State Files (runtime, gitignored)

| File/Folder | Purpose |
|---|---|
| `./zalo_session/` | Chrome user data dir (Puppeteer `userDataDir`) — persists Zalo login |
| `./messages.json` | Persisted queue for crash recovery (cleared on next `start()`) |
| `./bot_state.json` | Last forwarded frame ID per group (written but not currently read at startup) |
| `./images/` | Temp image storage; files deleted after a successful forward cycle |

## Gotchas

- **`forwardInterval` is a listen window, not a polling interval.** Lowering it makes the bot cycle through targets more frequently but also means each target gets visited more often — useful for low-latency forwarding, costly if you have many targets.
- **Queue is cleared on `start()`.** Messages observed before the bot was running are not backfilled, even if they're sitting in `messages.json`.
- **Image blob URLs are tab-scoped.** `_downloadImage` must run while the tab is still on the source group. Moving the download to the forward phase will break.
- **`PLAN.md` describes a different (older) architecture** — N source listener tabs + 1 forwarder tab + busy-wait file lock. It does not match `bot.js` and should not be used as a reference.
- **Electron uses `contextIsolation: false` and `nodeIntegration: true`** — required for the current `ipcRenderer` pattern in `renderer.js`.
- **No test suite, no linter.** Verify behavior changes by running `npm start` and watching the in-app log.
