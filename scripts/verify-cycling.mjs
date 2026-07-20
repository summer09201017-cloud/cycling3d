// cycling3d 端到端驗證(Playwright):
// ①單人競速 kids:真按鍵(A/D 交替踩踏+W 傾身)騎幾秒 → 速度應起來 → 傳到終點前衝線=應獲勝
// ②單人競速 normal:騎幾秒+彎道傾身截圖(側面視角看騎士/自行車/踩踏姿)
// ③雙人同機:P1(A/D)+P2(←/→)同時踩 → 各自有速度 → P1 先衝線=overlay 應報「P1(紅)獲勝」
// ④練習場:無對手、踉蹌測試(連按同側=掉速不摔)
// 全程 0 pageerror 才綠;截圖存 <outDir>/。
// 用法:node scripts/verify-cycling.mjs <url> <outDir>
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const [url, outDir] = process.argv.slice(2);
if (!url || !outDir) {
  console.error("用法:node scripts/verify-cycling.mjs <url> <outDir>");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
const EXE = process.env.CHROME_EXE ||
  "C:/Users/HFP/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe";
const errors = [];
const results = {};
const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console.error: " + m.text()); });

await page.goto(url, { waitUntil: "load", timeout: 25000 });
await page.bringToFront();
await page.waitForTimeout(1500);

const G = "__cycling3d";

const openMode = async (mode, difficulty) => {
  await page.evaluate(() => {
    const home = document.querySelector("#homeScreen");
    if (!home.classList.contains("visible")) document.querySelector("#overlayMenuButton")?.click();
  });
  await page.waitForTimeout(300);
  if (difficulty) await page.selectOption("#menuDifficultySelect", difficulty);
  await page.click(`.mode-card[data-mode="${mode}"]`);
  await page.click("#startMatchButton");
  await page.waitForTimeout(400);
};

// 真按鍵左右交替踩踏(P1=A/D);同拍可帶 P2(←/→)
const pedalTaps = async (taps, gapMs, withP2 = false) => {
  for (let i = 0; i < taps; i += 1) {
    await page.keyboard.press(i % 2 === 0 ? "KeyA" : "KeyD");
    if (withP2) await page.keyboard.press(i % 2 === 0 ? "ArrowLeft" : "ArrowRight");
    await page.waitForTimeout(gapMs);
  }
};

const snap = (r) => page.evaluate((g) => {
  const game = window[g];
  return {
    phase: game.phase,
    p1: { dist: Math.round(game.p1.dist * 10) / 10, speed: Math.round(game.p1.speed * 100) / 100, lap: game.p1.lap, rhythm: Math.round(game.p1.rhythm01 * 100) / 100 },
    opp: { dist: Math.round(game.opp.dist * 10) / 10, speed: Math.round(game.opp.speed * 100) / 100, visible: game.opp.figure.group.visible },
    overlay: { visible: game.overlay.visible, title: game.overlay.title, eyebrow: game.overlay.eyebrow },
  };
}, [G][r ? 0 : 0]);

// —— 首頁選單截圖 ——
await page.screenshot({ path: outDir + "/cy-menu.png" });

// —— ①單人競速 kids:出發→真按鍵踩踏→速度應起來→衝線獲勝 ——
await openMode("race", "kids");
await page.keyboard.press("Space"); // 出發
await page.waitForTimeout(200);
await pedalTaps(14, 400);
results.kidsSkating = await snap();
await page.screenshot({ path: outDir + "/cy-race-kids.png" });
// 傳到終點前(留 12m),邊傾身邊踩到衝線
await page.evaluate((g) => { const game = window[g]; game.p1.dist = game.finishDist - 12; }, G);
await page.keyboard.down("KeyW");
for (let i = 0; i < 20; i += 1) {
  await page.keyboard.press(i % 2 === 0 ? "KeyA" : "KeyD");
  await page.waitForTimeout(380);
  const s = await page.evaluate((g) => window[g].phase, G);
  if (s === "ended") break;
}
await page.keyboard.up("KeyW");
await page.waitForTimeout(600);
results.kidsFinish = await snap();
await page.screenshot({ path: outDir + "/cy-race-kids-finish.png" });

// —— ②單人競速 normal:騎幾秒+進彎傾身截圖(側面視角看踩踏姿/自行車) ——
await openMode("race", "normal");
await page.keyboard.press("Space");
await page.waitForTimeout(200);
await pedalTaps(12, 350);
results.normalSkating = await snap();
await page.screenshot({ path: outDir + "/cy-race-normal.png" });
// 傳到彎道入口,按住傾身截圖(傾身=彎道不減速)
await page.evaluate((g) => { const game = window[g]; game.p1.dist = 56; game.opp.dist = 50; }, G);
await page.keyboard.down("KeyW");
await pedalTaps(6, 350);
const bendState = await page.evaluate((g) => {
  const game = window[g];
  return { lean: game.p1.leanHeld, speed: Math.round(game.p1.speed * 100) / 100 };
}, G);
results.bendLean = bendState;
await page.screenshot({ path: outDir + "/cy-bend-lean.png" });
await page.keyboard.up("KeyW");
// 側面轉播視角看騎士(臉/安全帽/踩踏姿/自行車)
await page.keyboard.press("KeyV");
await page.waitForTimeout(900);
await page.screenshot({ path: outDir + "/cy-side-figure.png" });

// —— ③雙人同機:P1+P2 都踩,各自有速度;P1 先衝線=P1 獲勝 ——
await openMode("duel2p");
await page.keyboard.press("Space");
await page.waitForTimeout(200);
await pedalTaps(12, 360, true);
results.duelSkating = await snap();
await page.screenshot({ path: outDir + "/cy-duel.png" });
await page.evaluate((g) => { const game = window[g]; game.p1.dist = game.finishDist - 10; game.opp.dist = game.finishDist - 60; }, G);
for (let i = 0; i < 16; i += 1) {
  await page.keyboard.press(i % 2 === 0 ? "KeyA" : "KeyD");
  await page.waitForTimeout(380);
  const s = await page.evaluate((g) => window[g].phase, G);
  if (s === "ended") break;
}
await page.waitForTimeout(600);
results.duelFinish = await snap();
await page.screenshot({ path: outDir + "/cy-duel-finish.png" });

// —— ④練習場:無對手;踉蹌測試(連按同側=掉速+不摔、phase 不變) ——
await openMode("practice");
await page.keyboard.press("Space");
await page.waitForTimeout(200);
await pedalTaps(10, 380);
const beforeStumble = await page.evaluate((g) => window[g].p1.speed, G);
await page.keyboard.press("KeyA");
await page.waitForTimeout(120);
await page.keyboard.press("KeyA"); // 連按同側=踉蹌
await page.waitForTimeout(300);
const afterStumble = await page.evaluate((g) => ({ speed: window[g].p1.speed, stumble: window[g].p1.stumbleT > 0, phase: window[g].phase }), G);
results.practiceStumble = { before: Math.round(beforeStumble * 100) / 100, after: Math.round(afterStumble.speed * 100) / 100, stumbled: afterStumble.stumble, phase: afterStumble.phase };
await page.screenshot({ path: outDir + "/cy-practice.png" });

// —— 驗收判定 ——
const checks = {
  kidsSpeedUp: results.kidsSkating.p1.speed > 3,
  kidsWin: results.kidsFinish.phase === "ended" && /第一個衝線|勝利/.test(results.kidsFinish.overlay.title + results.kidsFinish.overlay.eyebrow),
  normalSpeedUp: results.normalSkating.p1.speed > 3,
  aiMoves: results.normalSkating.opp.speed > 2,
  bendLeanHeld: results.bendLean.lean === true,
  duelBothMove: results.duelSkating.p1.speed > 3 && results.duelSkating.opp.speed > 3,
  duelP1Win: results.duelFinish.phase === "ended" && results.duelFinish.overlay.title.includes("P1"),
  practiceNoOpp: (await page.evaluate((g) => !window[g].opp.figure.group.visible, G)) === true,
  stumbleSlows: results.practiceStumble.after < results.practiceStumble.before && results.practiceStumble.stumbled && results.practiceStumble.phase === "skating",
  zeroPageErrors: errors.length === 0,
};
const allGreen = Object.values(checks).every(Boolean);
console.log(JSON.stringify({ checks, results, errors, allGreen }, null, 2));
await browser.close();
process.exit(allGreen ? 0 : 1);
