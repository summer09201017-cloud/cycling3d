const SETTINGS_KEY = "cycling3d-settings-v1";
const SAVE_KEY = "cycling3d-save-v1";
const HELMET_KEY = "cycling3d-helmet";

const defaultSettings = {
  difficulty: "normal",
  modeId: "race",
  audioEnabled: true,
};

function parseValue(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

export function loadSettings() {
  return {
    ...defaultSettings,
    ...parseValue(localStorage.getItem(SETTINGS_KEY), {}),
  };
}

export function saveSettings(settings) {
  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({
      ...defaultSettings,
      ...settings,
    }),
  );
}

export function loadSavedGame() {
  return parseValue(localStorage.getItem(SAVE_KEY), null);
}

export function saveGameState(snapshot) {
  localStorage.setItem(SAVE_KEY, JSON.stringify(snapshot));
}

export function hasSavedGame() {
  return localStorage.getItem(SAVE_KEY) !== null;
}

// 安全帽開關(獨立鍵,預設「戴」)——makeCyclist 依此決定畫不畫帽殼
export function loadHelmet() {
  try {
    const v = localStorage.getItem(HELMET_KEY);
    return v === null ? true : v === "1";
  } catch {
    return true;
  }
}

export function saveHelmet(on) {
  try {
    localStorage.setItem(HELMET_KEY, on ? "1" : "0");
  } catch {
    /* Safari 私密模式:忽略 */
  }
}
