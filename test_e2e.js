/**
 * E2E test script - chay Bot truc tiep (khong can Electron)
 * Buoc 1: Chay app Electron de login truoc (tao zalo_session/)
 * Buoc 2: Chay script nay: node test_e2e.js
 *
 * Flow:  Lang nghe "Nhom 1" trong 30s → forward toi "Nhom 2" va "Nhom 3"
 */
const Bot = require("./bot");

const bot = new Bot({
  sourceGroup: "Nhóm 1",
  targetGroups: ["Nhóm 2", "Nhóm 3"],
  forwardInterval: 30000,  // 30s (ngan hon mac dinh de test nhanh)
  checkInterval: 3000,
});

const logs = [];
const errors = [];

bot.on("status", (msg) => {
  const ts = new Date().toLocaleTimeString("vi-VN");
  console.log(`[${ts}] [STATUS] ${msg}`);
});

bot.on("log", (msg) => {
  const ts = new Date().toLocaleTimeString("vi-VN");
  console.log(`[${ts}] [LOG]    ${msg}`);
  logs.push({ ts, msg });
});

bot.on("error", (msg) => {
  const ts = new Date().toLocaleTimeString("vi-VN");
  console.error(`[${ts}] [ERROR]  ${msg}`);
  errors.push({ ts, msg });
});

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n--- Dang dung bot... ---");
  await bot.stop();
  printSummary();
  process.exit(0);
});

function printSummary() {
  console.log("\n========== E2E TEST SUMMARY ==========");
  console.log(`Total logs:   ${logs.length}`);
  console.log(`Total errors: ${errors.length}`);

  // Kiem tra cac milestone trong flow
  const milestones = [
    { name: "Bot started",          pattern: /Bot dang chay/ },
    { name: "Config correct",       pattern: /Lang nghe.*Nhóm 1.*forward toi 2 nhom dich/ },
    { name: "Enter source group",   pattern: /\[Listener\] Vao nhom nguon/ },
    { name: "Listening started",    pattern: /\[Listener\] Lang nghe/ },
    { name: "Init source group",    pattern: /Khoi tao.*tin nhan hien co/ },
    { name: "Scan cycle",           pattern: /Khong co tin nhan moi|tin nhan moi/ },
    { name: "Forward phase",        pattern: /\[Forwarder\]|\[Listener\] Khong co tin nhan moi/ },
    { name: "Forward to target 1",  pattern: /\[Forwarder 1\/2\].*Nhóm 2/ },
    { name: "Forward to target 2",  pattern: /\[Forwarder 2\/2\].*Nhóm 3/ },
    { name: "Queue cleared",        pattern: /da xoa queue/ },
  ];

  console.log("\n--- Milestones ---");
  for (const m of milestones) {
    const found = logs.some((l) => m.pattern.test(l.msg));
    console.log(`  ${found ? "PASS" : "----"} ${m.name}`);
  }

  if (errors.length > 0) {
    console.log("\n--- Errors ---");
    for (const e of errors) {
      console.log(`  [${e.ts}] ${e.msg}`);
    }
  }
  console.log("=======================================\n");
}

console.log("=== E2E Test: 1 nguon -> 2 dich ===");
console.log("Source:  Nhóm 1");
console.log("Targets: Nhóm 2, Nhóm 3");
console.log("Listen:  30s | Check: 3s");
console.log("Nhan Ctrl+C de dung va xem ket qua\n");

bot.start().catch((err) => {
  console.error("FATAL:", err.message);
  printSummary();
  process.exit(1);
});
