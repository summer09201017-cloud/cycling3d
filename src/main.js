import "./styles.css";
import { CyclingGame, GAME_MODES } from "./game.js";
import { AudioManager } from "./audio.js";
import { speakLine, setVoiceEnabled } from "./voice.js";
import { hasSavedGame, loadSettings, saveSettings } from "./storage.js";

const ui = {
  canvas: document.querySelector("#gameCanvas"),
  cameraButton: document.querySelector("#cameraButton"),
  rankLabel: document.querySelector("#rankLabel"),
  speedTopLabel: document.querySelector("#speedTopLabel"),
  modeCode: document.querySelector("#modeCode"),
  lapLabel: document.querySelector("#lapLabel"),
  timeLabel: document.querySelector("#timeLabel"),
  rhythmTopLabel: document.querySelector("#rhythmTopLabel"),
  phaseLabel: document.querySelector("#phaseLabel"),
  statusMessage: document.querySelector("#statusMessage"),
  modeLabel: document.querySelector("#modeLabel"),
  difficultyLabel: document.querySelector("#difficultyLabel"),
  gapLabel: document.querySelector("#gapLabel"),
  lapSideLabel: document.querySelector("#lapSideLabel"),
  speedLabel: document.querySelector("#speedLabel"),
  audioStatus: document.querySelector("#audioStatus"),
  saveStatus: document.querySelector("#saveStatus"),
  installButton: document.querySelector("#installButton"),
  installHint: document.querySelector("#installHint"),
  loadButton: document.querySelector("#loadButton"),
  menuButton: document.querySelector("#menuButton"),
  audioButton: document.querySelector("#audioButton"),
  pauseButton: document.querySelector("#pauseButton"),
  touchControls: document.querySelector("#touchControls"),
  speedMeterFill: document.querySelector("#speedMeterFill"),
  speedMeterText: document.querySelector("#speedMeterText"),
  rhythmFill: document.querySelector("#rhythmFill"),
  rhythmValue: document.querySelector("#rhythmValue"),
  bendFill: document.querySelector("#bendFill"),
  bendValue: document.querySelector("#bendValue"),
  staminaFill: document.querySelector("#staminaFill"),
  staminaValue: document.querySelector("#staminaValue"),
  p2StaminaRow: document.querySelector("#p2StaminaRow"),
  p2StaminaTrack: document.querySelector("#p2StaminaTrack"),
  p2StaminaFill: document.querySelector("#p2StaminaFill"),
  p2StaminaValue: document.querySelector("#p2StaminaValue"),
  speedLines: document.querySelector("#speedLines"),
  helmetSelect: document.querySelector("#helmetSelect"),
  matchOverlay: document.querySelector("#matchOverlay"),
  overlayEyebrow: document.querySelector("#overlayEyebrow"),
  overlayTitle: document.querySelector("#overlayTitle"),
  overlayText: document.querySelector("#overlayText"),
  resumeButton: document.querySelector("#resumeButton"),
  overlayMenuButton: document.querySelector("#overlayMenuButton"),
  homeScreen: document.querySelector("#homeScreen"),
  modeCardGrid: document.querySelector("#modeCardGrid"),
  modeDescription: document.querySelector("#modeDescription"),
  menuDifficultySelect: document.querySelector("#menuDifficultySelect"),
  audioSelect: document.querySelector("#audioSelect"),
  modeMetaTitle: document.querySelector("#modeMetaTitle"),
  modeMetaGoal: document.querySelector("#modeMetaGoal"),
  startMatchButton: document.querySelector("#startMatchButton"),
  commentaryBar: document.querySelector("#commentaryBar"),
  continueSavedButton: document.querySelector("#continueSavedButton"),
};

const settings = loadSettings();
const audio = new AudioManager();
audio.setEnabled(settings.audioEnabled !== false);

const game = new CyclingGame({
  canvas: ui.canvas,
  touchRoot: ui.touchControls,
});
window.__cycling3d = game; // dev hook:Playwright 驗證用
window.__game = game; // /smoke3d 通用鉤子

let selectedModeId = game.modeId;
let selectedDifficulty = game.difficulty;
let audioEnabled = settings.audioEnabled !== false;

function persistSettings() {
  saveSettings({
    difficulty: selectedDifficulty,
    modeId: selectedModeId,
    audioEnabled,
  });
}

function setMeterFill(element, value) {
  element.style.transform = `scaleX(${Math.max(0, Math.min(1, value))})`;
}

function setAudioState(enabled) {
  audioEnabled = enabled;
  audio.setEnabled(enabled);
  setVoiceEnabled(enabled);
  ui.audioStatus.textContent = enabled ? "開啟" : "靜音";
  ui.audioButton.textContent = enabled ? "音效開啟" : "音效靜音";
  ui.audioSelect.value = enabled ? "on" : "off";
  persistSettings();
}

function syncMenuCards() {
  for (const button of ui.modeCardGrid.querySelectorAll(".mode-card")) {
    button.classList.toggle("selected", button.dataset.mode === selectedModeId);
  }
  const mode = GAME_MODES[selectedModeId];
  ui.modeDescription.textContent = mode.description;
  ui.modeMetaTitle.textContent = mode.label;
  ui.modeMetaGoal.textContent = mode.goal;
}

function syncMenuControls() {
  ui.menuDifficultySelect.value = selectedDifficulty;
  ui.helmetSelect.value = game.helmet ? "on" : "off";
  syncMenuCards();
}

function syncGameConfigurationToMenu() {
  selectedModeId = game.modeId;
  selectedDifficulty = game.difficulty;
  syncMenuControls();
}

function syncOverlay(overlay) {
  ui.matchOverlay.classList.toggle("visible", overlay.visible);
  ui.overlayEyebrow.textContent = overlay.eyebrow;
  ui.overlayTitle.textContent = overlay.title;
  ui.overlayText.textContent = overlay.text;
  ui.resumeButton.hidden = !overlay.canResume;
}

function openHomeScreen() {
  game.openHomeMenu();
  audio.stopCrowd();
  syncGameConfigurationToMenu();
  ui.homeScreen.classList.add("visible");
}

function closeHomeScreen() {
  ui.homeScreen.classList.remove("visible");
}

function unlockAudio() {
  audio.unlock();
}

// —— 中文播報:畫面字幕條+預烤 mp3 人聲同步唸(人聲鐵律:沒烤過的句子只出字幕) ——
function pushCommentary(text, tone = "info", spoken = text) {
  const bar = ui.commentaryBar;
  if (!bar || !text) return;
  bar.hidden = false;
  bar.dataset.tone = tone;
  bar.textContent = text;
  bar.style.animation = "none";
  void bar.offsetWidth;
  bar.style.animation = "";
  speakLine(spoken);
}

function handleGameEvent(event) {
  switch (event.type) {
    case "match-start": {
      audio.whistle();
      audio.startCrowd(); // 賽場滿場觀眾——環境音照鐵則開
      audio.vibrate(18);
      pushCommentary("歡迎來到自行車競速!左右交替踩踏板,踩出全速!");
      window.psPing?.("-start");
      break;
    }
    case "gate": {
      audio.buzzer();
      audio.vibrate(14);
      pushCommentary("出發!左右交替踩踏板,節奏穩住!");
      break;
    }
    case "rhythm-good": {
      audio.scoreSting();
      pushCommentary("踏頻漂亮,越騎越快!", "hot");
      break;
    }
    case "bend-enter": {
      if (event.first) pushCommentary("進彎道了,按住傾身鍵!", "cool");
      break;
    }
    case "bend-exit-good": {
      audio.swish();
      pushCommentary("彎道傾身,漂亮地過彎!", "hot");
      break;
    }
    case "stumble": {
      audio.thud(0.6);
      audio.vibrate([40, 20, 40]);
      pushCommentary(`${event.who} 踉蹌了一下——穩住節奏!`, "cool", "哎呀,踉蹌了一下,穩住節奏再來!");
      break;
    }
    case "last-lap": {
      audio.buzzer();
      audio.crowdCheer(0.7);
      pushCommentary("最後一圈——衝啊!", "hot", "最後一圈,衝啊!");
      break;
    }
    case "lap": {
      audio.scoreSting();
      pushCommentary(`第 ${event.lap} 圈!`, "info", "又騎完一圈,節奏越來越穩!");
      break;
    }
    case "overtake": {
      audio.swish();
      audio.crowdCheer(event.ahead ? 0.7 : 0.3);
      pushCommentary(
        event.ahead ? "超越!衝到前面去了!" : "被追過了——加緊節奏!",
        event.ahead ? "hot" : "cool",
        event.ahead ? "超越了!衝到前面去了!" : "被追過了,加緊節奏追回來!",
      );
      break;
    }
    case "race-end": {
      try { if (!['localhost','127.0.0.1'].includes(location.hostname)) {   // -done:玩完一局(t=本局秒數,/stats 使用次數與平均停留吃這個)
        var __dt = Math.round((Date.now() - (window.__matchT0 || Date.now())) / 1000);
        navigator.sendBeacon?.('https://hfpc-play-stats.summer09201017.workers.dev/api/ping?g=cycling3d-done&t=' + __dt);
      } } catch (_) {}
      audio.horn();
      audio.crowdCheer(event.win ? 1 : 0.5);
      audio.vibrate([110, 50, 120]);
      pushCommentary(
        event.win ? "第一個衝線!" + event.elapsed.toFixed(1) + " 秒!" : "AI 先到了——再來一場!",
        event.win ? "hot" : "cool",
        event.win ? "衝線!你是第一名,全場歡呼!" : "衝過終點!對手先到,再來一場!",
      );
      ui.saveStatus.textContent = hasSavedGame() ? "已記錄" : "尚無";
      window.psPing?.("-done", event.elapsed);
      break;
    }
    case "duel-end": {
      audio.horn();
      audio.crowdCheer(1);
      audio.vibrate([110, 50, 120]);
      pushCommentary(
        event.winner === "p1" ? "P1(紅)獲勝!" : "P2(藍)獲勝!",
        "hot",
        event.winner === "p1" ? "紅衣車手獲勝,騎得漂亮!" : "藍衣車手獲勝,騎得漂亮!",
      );
      window.psPing?.("-done", event.elapsed);
      break;
    }
    default:
      break;
  }
}

game.onEvent = handleGameEvent;

game.onHudUpdate = (state) => {
  ui.rankLabel.textContent = state.rankText;
  ui.speedTopLabel.textContent = state.speedText;
  ui.modeCode.textContent = ({ 單人競速: "競速", 雙人同機: "雙人", 練習場: "練習" })[state.modeLabel] || state.modeLabel;
  ui.lapLabel.textContent = state.lapText;
  ui.timeLabel.textContent = state.timeText;
  ui.rhythmTopLabel.textContent =
    state.lastResult === null ? "—"
      : state.lastResult === "perfect" ? "完美!"
        : state.lastResult === "good" ? "好!"
          : state.lastResult === "fast" ? "太急"
            : "同側!";
  ui.phaseLabel.textContent = state.phaseLabel;
  ui.statusMessage.textContent = state.message;
  ui.modeLabel.textContent = state.modeLabel;
  ui.difficultyLabel.textContent = state.difficultyLabel;
  ui.gapLabel.textContent = state.gapText;
  ui.lapSideLabel.textContent = state.lapText;
  ui.speedLabel.textContent = state.speedText;
  ui.speedMeterText.textContent = state.speedText;
  setMeterFill(ui.speedMeterFill, state.speed01);
  setMeterFill(ui.rhythmFill, state.rhythm01);
  ui.rhythmValue.textContent = state.skating ? `${Math.round(state.rhythm01 * 100)}%(下一步:${state.nextSide})` : "—";
  // 彎道傾身指示
  setMeterFill(ui.bendFill, state.inBend ? 1 : 0);
  ui.bendValue.textContent = !state.skating ? "—" : state.inBend ? (state.leanOk ? "傾身中 ✓" : "進彎!按住傾身!") : "直道";
  // 衝刺體力條(P1;雙人另顯示 P2)——衝刺中發光脈動、低量轉紅、空了提示
  {
    const s = state.stamina01 ?? 1;
    setMeterFill(ui.staminaFill, s);
    ui.staminaFill.classList.toggle("active", !!state.p1Sprinting);
    ui.staminaFill.classList.toggle("low", s < 0.25);
    ui.staminaValue.textContent = !state.skating ? "滿" : state.p1Sprinting ? "衝刺中!" : s < 0.12 ? "沒力了" : `${Math.round(s * 100)}%`;
    const showP2 = state.duel;
    ui.p2StaminaRow.style.display = showP2 ? "flex" : "none"; // 行內樣式蓋過 .meter-copy 的 display:flex
    ui.p2StaminaTrack.style.display = showP2 ? "block" : "none";
    if (showP2) {
      const s2 = state.p2Stamina01 ?? 1;
      setMeterFill(ui.p2StaminaFill, s2);
      ui.p2StaminaFill.classList.toggle("active", !!state.p2Sprinting);
      ui.p2StaminaFill.classList.toggle("low", s2 < 0.25);
      ui.p2StaminaValue.textContent = state.p2Sprinting ? "衝刺中!" : s2 < 0.12 ? "沒力了" : `${Math.round(s2 * 100)}%`;
    }
  }
  // 衝刺速度線覆蓋層
  ui.speedLines.classList.toggle("on", !!state.sprinting);
  { // 中下方大節奏條:滑行中顯示;節奏>0.8=發光;進彎變傾身提示
    const bp = document.getElementById("bigPower"), bf = document.getElementById("bigPowerFill"), bl = document.getElementById("bigPowerLabel");
    if (bp) {
      bp.hidden = !state.skating;
      if (state.inBend) {
        bl.textContent = state.leanOk ? "彎道傾身中 ✓" : "進彎!按住 W 傾身!";
        bf.style.transform = "scaleX(1)";
        bf.classList.toggle("full", state.leanOk);
      } else {
        bl.textContent = `節奏(左右交替)下一步:${state.nextSide}`;
        bf.style.transform = `scaleX(${Math.min(1, state.rhythm01)})`;
        bf.classList.toggle("full", state.rhythm01 > 0.8);
      }
    }
  }
  // 競速小地圖:橢圓路線+終點+我(紅)+對手(藍)
  {
    const mm = document.getElementById("miniMap");
    const showMap = state.race && state.phaseLabel !== "主選單";
    mm.hidden = !showMap;
    if (showMap) {
      const ctx = mm.getContext("2d");
      const d = game.getMinimapData();
      ctx.clearRect(0, 0, mm.width, mm.height);
      const sx = (x) => ((x + 56) / 112) * mm.width;
      const sy = (z) => ((z + 31) / 62) * mm.height;
      ctx.strokeStyle = "rgba(255,255,255,.5)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      d.path.forEach(([x, z], i) => (i ? ctx.lineTo(sx(x), sy(z)) : ctx.moveTo(sx(x), sy(z))));
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = "#ffe9ad";
      ctx.fillRect(sx(d.finish[0]) - 2, sy(d.finish[1]) - 4, 4, 8);
      if (d.opp) {
        ctx.fillStyle = "#4d9fff";
        ctx.beginPath();
        ctx.arc(sx(d.opp[0]), sy(d.opp[1]), 5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "#ff5544";
      ctx.beginPath();
      ctx.arc(sx(d.me[0]), sy(d.me[1]), 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = "#ffe9ad";
      ctx.font = "bold 12px system-ui";
      ctx.fillText(state.gapText, 8, 16);
    }
  }
  syncOverlay(state.overlay);
};

syncGameConfigurationToMenu();
setAudioState(audioEnabled);
ui.saveStatus.textContent = hasSavedGame() ? "已記錄" : "尚無";

ui.modeCardGrid.addEventListener("click", (event) => {
  const button = event.target.closest(".mode-card");
  if (!button) return;
  unlockAudio();
  audio.uiTap();
  selectedModeId = button.dataset.mode;
  syncMenuCards();
  persistSettings();
});

ui.menuDifficultySelect.addEventListener("change", (event) => {
  selectedDifficulty = event.target.value;
  persistSettings();
});

ui.helmetSelect.addEventListener("change", (event) => {
  audio.uiTap();
  game.setHelmet(event.target.value === "on"); // 存檔+重建車手(戴/不戴)
});

ui.audioSelect.addEventListener("change", (event) => {
  unlockAudio();
  audio.uiTap();
  setAudioState(event.target.value === "on");
});

ui.startMatchButton.addEventListener("click", () => {
  window.__matchT0 = Date.now();   // -done beacon 用:本局開始時間
  unlockAudio();
  audio.uiTap();
  game.applyPresentation({
    difficulty: selectedDifficulty,
    modeId: selectedModeId,
  });
  game.startSelectedMatch();
  closeHomeScreen();
});

function loadIntoUi() {
  const loaded = game.loadGame();
  syncGameConfigurationToMenu();
  ui.saveStatus.textContent = loaded && hasSavedGame() ? "已記錄" : "尚無";
}

ui.continueSavedButton.addEventListener("click", () => {
  unlockAudio();
  audio.uiTap();
  loadIntoUi();
});

ui.loadButton.addEventListener("click", loadIntoUi);

ui.menuButton.addEventListener("click", () => {
  unlockAudio();
  audio.uiTap();
  openHomeScreen();
});

ui.overlayMenuButton.addEventListener("click", () => {
  unlockAudio();
  audio.uiTap();
  openHomeScreen();
});

ui.cameraButton.addEventListener("click", () => {
  game.cycleCameraView();
});

ui.audioButton.addEventListener("click", () => {
  unlockAudio();
  audio.uiTap();
  setAudioState(!audioEnabled);
});

ui.pauseButton.addEventListener("click", () => {
  unlockAudio();
  audio.uiTap();
  game.togglePause();
});

ui.resumeButton.addEventListener("click", () => {
  unlockAudio();
  audio.uiTap();
  game.resume();
});

window.addEventListener("pointerdown", unlockAudio, { passive: true });
window.addEventListener("keydown", unlockAudio, { passive: true });

let deferredInstallPrompt = null;

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  ui.installButton.hidden = false;
  ui.installHint.textContent = "已偵測到可安裝版本，點一下就能加入主畫面。";
});

ui.installButton.addEventListener("click", async () => {
  unlockAudio();
  audio.uiTap();
  if (!deferredInstallPrompt) {
    ui.installHint.textContent = "如果是 iPhone，請用分享選單的「加入主畫面」。";
    return;
  }
  deferredInstallPrompt.prompt();
  const outcome = await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  ui.installButton.hidden = true;
  ui.installHint.textContent =
    outcome.outcome === "accepted" ? "安裝要求已送出。" : "你可以之後再安裝。";
});

window.addEventListener("appinstalled", () => {
  ui.installButton.hidden = true;
  ui.installHint.textContent = "已安裝到裝置。";
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    game.saveGame(true);
  }
});

// dev(localhost)不註冊 SW——SW 快取會讓每次改動都吃到「上一版」(07-11 踩雷)
if ("serviceWorker" in navigator && !["localhost", "127.0.0.1"].includes(location.hostname)) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      ui.installHint.textContent = "Service Worker 註冊失敗，但仍可直接遊玩。";
    });
  });
}

game.start();
