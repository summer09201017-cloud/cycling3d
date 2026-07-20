// 播報詞庫(固定句,全部預烤 mp3)+key 函式——scripts/gen-voice.mjs 與 runtime voice.js 共用。
// ★字幕可以帶秒數等動態字,「唸出來的」一律用這裡的固定句(人聲鐵律:不用 Web Speech 機器聲)。
// ⚠ edge-tts 雷:太短的句子會斷流——句子保持完整、以驚嘆/句號收尾。
export function voiceKey(text) {
  const s = String(text).replace(/\s+/g, "");
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(36);
}

export const PHRASES = [
  // 開賽/出發
  "歡迎來到自行車競速!左右交替踩踏板,踩出全速!",
  "出發!左右交替踩踏板,節奏穩住!",
  // 節奏/彎道
  "踏頻漂亮,越騎越快!",
  "進彎道了,按住傾身鍵!",
  "彎道傾身,漂亮地過彎!",
  "哎呀,踉蹌了一下,穩住節奏再來!",
  // 賽況
  "最後一圈,衝啊!",
  "超越了!衝到前面去了!",
  "被追過了,加緊節奏追回來!",
  "又騎完一圈,節奏越來越穩!",
  // 終場
  "衝線!你是第一名,全場歡呼!",
  "衝過終點!對手先到,再來一場!",
  "紅衣車手獲勝,騎得漂亮!",
  "藍衣車手獲勝,騎得漂亮!",
];

// 自行車競速=奧運皮,無經文(聖經皮換皮時再加)
export const SCRIPTURES = [];
