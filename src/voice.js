// 人聲播報 runtime——mp3(雲哲神經語音預烤)優先;缺檔=靜默只出字幕。
// ★人聲鐵則(2026-07-10 使用者點名「太機器聲」):不用 Web Speech 機器聲 fallback。
import { voiceKey } from "./voicePhrases.js";

let manifest = null;
let current = null;
let enabled = true;

async function loadManifest() {
  if (manifest) return manifest;
  try {
    const res = await fetch("./voice/manifest.json");
    manifest = res.ok ? await res.json() : {};
  } catch {
    manifest = {};
  }
  return manifest;
}
loadManifest();

export function setVoiceEnabled(v) {
  enabled = v;
  if (!v && current) {
    current.pause();
    current = null;
  }
}

export function speakLine(text) {
  if (!enabled || !text || !manifest) return;
  const path = manifest[voiceKey(text)];
  if (!path) return; // 沒烤過的句子=只出字幕,不用機器聲
  try {
    // 單一 Audio 元素重用:每句 new Audio 會累積 WebMediaPlayer,長場次被 Chrome 封鎖
    if (!current) {
      current = new Audio();
      current.volume = 0.95;
    }
    current.pause();
    current.src = "./" + path;
    current.play().catch(() => {});
  } catch {
    // ignore
  }
}
