// 鍵位(duel-2p-kit §3):P1 左手區=A/D 交替蹬+W 傾身;P2 右手區=←/→ 交替蹬+↑ 傾身。
// 單人模式的 solo 別名(P2 鍵仍有效、不變死鍵)在 game.js 路由層做,這裡只發動作名。
const KEY_BINDINGS = {
  KeyA: "p1left",
  KeyD: "p1right",
  KeyW: "p1lean",
  ArrowLeft: "p2left",
  ArrowRight: "p2right",
  ArrowUp: "p2lean",
  Space: "shoot",
  KeyV: "camera",
  Escape: "pause",
  KeyP: "pause",
};

const PREVENT_DEFAULT = new Set(["Space", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Tab"]);

export class InputManager {
  constructor() {
    this.held = new Set();
    this.pressed = new Set();
    this.released = new Set();

    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.onWindowBlur = this.onWindowBlur.bind(this);

    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onWindowBlur);
  }

  bindTouchButtons(root) {
    if (!root) {
      return;
    }

    for (const button of root.querySelectorAll("[data-action]")) {
      const action = button.dataset.action;

      const press = (event) => {
        event.preventDefault();
        if (!this.held.has(action)) {
          this.pressed.add(action);
        }
        this.held.add(action);
        button.classList.add("active");
      };

      const release = (event) => {
        event.preventDefault();
        if (this.held.has(action)) {
          this.released.add(action);
        }
        this.held.delete(action);
        button.classList.remove("active");
      };

      button.addEventListener("pointerdown", press);
      button.addEventListener("pointerup", release);
      button.addEventListener("pointerleave", release);
      button.addEventListener("pointercancel", release);
      button.addEventListener("contextmenu", (event) => event.preventDefault());
    }
  }

  onKeyDown(event) {
    // 輸入框防吞(duel-2p-kit §6)
    if (["INPUT", "SELECT", "TEXTAREA"].includes(event.target?.tagName)) {
      return;
    }
    const action = KEY_BINDINGS[event.code];
    if (!action) {
      return;
    }

    if (PREVENT_DEFAULT.has(event.code)) {
      event.preventDefault();
    }

    if (!event.repeat) {
      this.pressed.add(action);
    }

    this.held.add(action);
  }

  onKeyUp(event) {
    const action = KEY_BINDINGS[event.code];
    if (!action) {
      return;
    }

    if (this.held.has(action)) {
      this.released.add(action);
    }
    this.held.delete(action);
  }

  onWindowBlur() {
    // blur 全清(duel-2p-kit §6):切視窗回來不會「鬼按住」
    this.held.clear();
    this.pressed.clear();
    this.released.clear();
  }

  isDown(action) {
    return this.held.has(action);
  }

  consumePress(action) {
    const pressed = this.pressed.has(action);
    if (pressed) {
      this.pressed.delete(action);
    }
    return pressed;
  }

  consumeRelease(action) {
    const released = this.released.has(action);
    if (released) {
      this.released.delete(action);
    }
    return released;
  }

  endFrame() {
    this.pressed.clear();
    this.released.clear();
  }
}
