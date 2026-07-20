// gen-voice.mjs —— 把播報詞庫用 edge-tts 預烤成 mp3(分聲,samson 範式):
//   PHRASES    → zh-TW-YunJheNeural (雲哲,男聲旁白/轉播感)
//   SCRIPTURES → zh-TW-HsiaoChenNeural(曉臻,柔和女聲唸和合本經文)
// 產出 public/voice/<key>.mp3 + public/voice/manifest.json;runtime src/voice.js mp3 優先、缺檔=只出字幕不唸
// (★人聲鐵則:不用 Web Speech 機器聲 fallback)。
// 用法:node scripts/gen-voice.mjs(需網路;產物進 git,離線可玩)。
// 新增播報詞:加進 PHRASES/SCRIPTURES 再重跑(累加式,已有的檔跳過)。
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, renameSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { voiceKey, PHRASES, SCRIPTURES } from "../src/voicePhrases.js";

// msedge-tts 內部的非同步清理會在我們搬走檔案後再 unlink 一次→吞掉這個特定錯誤,別讓它炸掉整批
process.on("uncaughtException", (e) => {
  if (e && e.code === "ENOENT" && e.syscall === "unlink") return;
  console.error(e);
  process.exit(1);
});

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "public", "voice");
mkdirSync(OUT, { recursive: true });

const manifestPath = join(OUT, "manifest.json");
let manifest = {};
try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")); } catch { /* 第一次 */ }
const saveManifest = () => writeFileSync(manifestPath, JSON.stringify(manifest, null, 1) + "\n", "utf8");

const NARRATOR = "zh-TW-YunJheNeural"; // 雲哲(男聲,旁白)
const SCRIPTURE_VOICE = "zh-TW-HsiaoChenNeural"; // 曉臻(柔和女聲,經文)

let made = 0, skipped = 0, failed = 0;
async function bake(text, voice) {
  const key = voiceKey(text);
  const file = `${key}.mp3`;
  const fp = join(OUT, file);
  if (existsSync(fp)) { manifest[key] = `voice/${file}`; saveManifest(); skipped++; return; }
  const tmpDir = join(OUT, `_tmp_${key}`);
  try {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    mkdirSync(tmpDir, { recursive: true });
    const { audioFilePath } = await tts.toFile(tmpDir, text);
    const { copyFileSync } = await import("node:fs");
    copyFileSync(audioFilePath, fp); // copy 不 rename:留原檔給 lib 自己清,避免它 unlink 撲空
    void renameSync;
    try { tts.close && tts.close(); } catch { /* socket 已關 */ }
    manifest[key] = `voice/${file}`;
    saveManifest(); // 逐句落盤:中途死也不丟已完成的
    made++;
    console.log("✓", voice === SCRIPTURE_VOICE ? "[經文]" : "[旁白]", text.slice(0, 30));
  } catch (err) {
    failed++;
    console.error("✗", text, String(err).slice(0, 120));
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  }
}

for (const text of PHRASES) await bake(text, NARRATOR);
for (const text of SCRIPTURES) await bake(text, SCRIPTURE_VOICE);

console.log(`done: made ${made}, skipped ${skipped}, failed ${failed}, total ${readdirSync(OUT).filter((f) => f.endsWith(".mp3")).length} mp3`);
process.exit(failed ? 1 : 0); // 明確收尾(lib 的 WebSocket 會讓 process 掛著)
