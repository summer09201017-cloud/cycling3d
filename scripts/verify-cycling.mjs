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
results.practiceNoOpp = await page.evaluate((g) => !window[g].opp.figure.group.visible, G); // 此刻抓(後續情境會切回 race)
await pedalTaps(10, 380);
const beforeStumble = await page.evaluate((g) => window[g].p1.speed, G);
await page.keyboard.press("KeyA");
await page.waitForTimeout(120);
await page.keyboard.press("KeyA"); // 連按同側=踉蹌
await page.waitForTimeout(300);
const afterStumble = await page.evaluate((g) => ({ speed: window[g].p1.speed, stumble: window[g].p1.stumbleT > 0, phase: window[g].phase }), G);
results.practiceStumble = { before: Math.round(beforeStumble * 100) / 100, after: Math.round(afterStumble.speed * 100) / 100, stumbled: afterStumble.stumble, phase: afterStumble.phase };
await page.screenshot({ path: outDir + "/cy-practice.png" });

// —— ⑤安全帽 戴/不戴:各截正面+側面(freeCam 對準臉,確認露眼) ——
// 對準騎士頭部擺鏡頭(正面=前方回看、側面=側邊看);helmet 由 game.setHelmet 切換並重建車手
const faceShots = async (tag) => {
  // 正面
  await page.evaluate((g) => {
    const game = window[g];
    game.freeCam = true;
    const V = game.camera.position.constructor; // THREE.Vector3
    const grp = game.p1.figure.group;
    const hp = game.p1.figure.head.getWorldPosition(new V());
    const fx = Math.sin(grp.rotation.y);
    const fz = Math.cos(grp.rotation.y);
    game.camera.position.set(hp.x + fx * 1.85, hp.y + 0.05, hp.z + fz * 1.85);
    game.camera.lookAt(hp.x, hp.y, hp.z);
    game.camera.fov = 36;
    game.camera.updateProjectionMatrix();
  }, G);
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${outDir}/cy-helmet-${tag}-front.png` });
  // 側面
  await page.evaluate((g) => {
    const game = window[g];
    const V = game.camera.position.constructor;
    const grp = game.p1.figure.group;
    const hp = game.p1.figure.head.getWorldPosition(new V());
    const fx = Math.sin(grp.rotation.y);
    const fz = Math.cos(grp.rotation.y);
    game.camera.position.set(hp.x + fz * 1.85, hp.y + 0.04, hp.z - fx * 1.85);
    game.camera.lookAt(hp.x, hp.y, hp.z);
    game.camera.fov = 36;
    game.camera.updateProjectionMatrix();
  }, G);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${outDir}/cy-helmet-${tag}-side.png` });
};

await openMode("race", "normal");
await page.evaluate((g) => window[g].setHelmet(true), G); // 戴帽
await page.waitForTimeout(300);
await faceShots("on");
await page.evaluate((g) => window[g].setHelmet(false), G); // 不戴(露髮)
await page.waitForTimeout(300);
await faceShots("off");
await page.evaluate((g) => { window[g].freeCam = false; window[g].setHelmet(true); }, G); // 復原

// —— ⑥衝刺+體力條:按住 Shift 踩踏→速度升+體力降;放開→體力回復 ——
await openMode("race", "normal");
await page.keyboard.press("Space");
await page.waitForTimeout(200);
await pedalTaps(8, 360);
const spBase = await page.evaluate((g) => ({ speed: Math.round(window[g].p1.speed * 100) / 100, stamina: Math.round(window[g].p1.stamina * 100) / 100 }), G);
await page.keyboard.down("ShiftLeft"); // 按住衝刺
await pedalTaps(6, 300);
const spDuring = await page.evaluate((g) => ({ speed: Math.round(window[g].p1.speed * 100) / 100, stamina: Math.round(window[g].p1.stamina * 100) / 100, sprinting: window[g].p1.sprinting }), G);
await page.screenshot({ path: outDir + "/cy-sprint.png" });
await page.keyboard.up("ShiftLeft"); // 放開
await page.waitForTimeout(1900);
const spAfter = await page.evaluate((g) => ({ stamina: Math.round(window[g].p1.stamina * 100) / 100 }), G);
results.sprint = { base: spBase, during: spDuring, after: spAfter };

// —— ⑦單人 normal:高手 bot(穩定節奏 340ms + 全程傾身 + 有體力就衝)能贏 AI ——
await openMode("race", "normal");
await page.keyboard.press("Space");
await page.waitForTimeout(150);
await page.keyboard.down("KeyW"); // 全程按住傾身(直道無害、彎道不減速)
let botSprinting = false;
let botEnded = false;
for (let i = 0; i < 260; i += 1) {
  await page.keyboard.press(i % 2 === 0 ? "KeyA" : "KeyD");
  const st = await page.evaluate((g) => ({ phase: window[g].phase, stamina: window[g].p1.stamina }), G);
  if (st.phase === "ended") { botEnded = true; break; }
  if (!botSprinting && st.stamina > 0.55) { await page.keyboard.down("ShiftLeft"); botSprinting = true; }
  else if (botSprinting && st.stamina < 0.15) { await page.keyboard.up("ShiftLeft"); botSprinting = false; }
  await page.waitForTimeout(340);
}
if (botSprinting) await page.keyboard.up("ShiftLeft");
await page.keyboard.up("KeyW");
await page.waitForTimeout(500);
results.normalWin = await snap();
await page.screenshot({ path: outDir + "/cy-normal-win.png" });

// —— ⑧ idle 生動:頭+臉群組往左看到峰值 + 微笑,截圖證明「整顆頭連臉一起轉、眼睛還在」——
// 手法:把 P1 的 glancePhase 對到「停留看左」視窗中段(k=1),讓 animateHead 自然把 headGroup.rotation.y
// 平滑 lerp 到 +0.35 峰值並停住(不瞬跳);再 freeCam 從正面拍 → 臉明顯轉向一側但眼睛/瞳孔仍露。
const pinGlance = (g) => {
  const game = window[g];
  const r = game.p1;
  const period = r.glancePeriod || 5.4;
  r.glancePhase = 0.45 - (game.time % period); // t≈0.45 落在停留視窗(ramp 0.3~1.1)中段
};
await openMode("race", "normal");
await page.waitForTimeout(250);
await page.evaluate(pinGlance, G);
await page.waitForTimeout(450); // 每幀 lerp 0.15 → ~0.3s 收斂到 +0.35 峰值
const glance = await page.evaluate((g) => {
  const game = window[g];
  const f = game.p1.figure;
  return {
    yaw: Math.round(f.headGroup.rotation.y * 1000) / 1000,
    smileScale: Math.round(f.smile.scale.x * 1000) / 1000,
  };
}, G);
results.glance = glance;
await page.evaluate((g) => {
  const game = window[g];
  const r = game.p1;
  const period = r.glancePeriod || 5.4;
  r.glancePhase = 0.45 - (game.time % period); // 抵銷等待推進的 time,重新對到停留中段
  game.freeCam = true;
  const V = game.camera.position.constructor;
  const grp = game.p1.figure.group;
  const hp = game.p1.figure.head.getWorldPosition(new V());
  const fx = Math.sin(grp.rotation.y);
  const fz = Math.cos(grp.rotation.y);
  game.camera.position.set(hp.x + fx * 1.9, hp.y + 0.06, hp.z + fz * 1.9);
  game.camera.lookAt(hp.x, hp.y, hp.z);
  game.camera.fov = 34;
  game.camera.updateProjectionMatrix();
}, G);
await page.waitForTimeout(200);
await page.screenshot({ path: outDir + "/cy-glance-left.png" });
await page.evaluate((g) => { window[g].freeCam = false; }, G);

// —— 驗收判定 ——
const checks = {
  kidsSpeedUp: results.kidsSkating.p1.speed > 3,
  kidsWin: results.kidsFinish.phase === "ended" && /第一個衝線|勝利/.test(results.kidsFinish.overlay.title + results.kidsFinish.overlay.eyebrow),
  normalSpeedUp: results.normalSkating.p1.speed > 3,
  aiMoves: results.normalSkating.opp.speed > 2,
  bendLeanHeld: results.bendLean.lean === true,
  duelBothMove: results.duelSkating.p1.speed > 3 && results.duelSkating.opp.speed > 3,
  duelP1Win: results.duelFinish.phase === "ended" && results.duelFinish.overlay.title.includes("P1"),
  practiceNoOpp: results.practiceNoOpp === true,
  stumbleSlows: results.practiceStumble.after < results.practiceStumble.before && results.practiceStumble.stumbled && results.practiceStumble.phase === "skating",
  sprintSpeedUp: results.sprint.during.speed > results.sprint.base.speed && results.sprint.during.sprinting === true,
  sprintDrains: results.sprint.during.stamina < results.sprint.base.stamina,
  sprintRecovers: results.sprint.after.stamina > results.sprint.during.stamina,
  normalWinWithSprint: results.normalWin.phase === "ended" && /第一個衝線|勝利/.test(results.normalWin.overlay.title + results.normalWin.overlay.eyebrow),
  glanceHeadTurns: results.glance.yaw > 0.25, // 頭+臉群組真的轉到左邊峰值(證明群組化生效)
  glanceSmiles: results.glance.smileScale > 1.15, // 微笑 torus 短暫更彎/更明顯
  zeroPageErrors: errors.length === 0,
};
const allGreen = Object.values(checks).every(Boolean);
console.log(JSON.stringify({ checks, results, errors, allGreen }, null, 2));
await browser.close();
process.exit(allGreen ? 0 : 1);
