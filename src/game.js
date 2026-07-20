import * as THREE from "three";
import { InputManager } from "./input.js";
import { loadSettings, saveSettings, loadSavedGame, saveGameState, loadHelmet, saveHelmet } from "./storage.js";

// —— 3D 自行車競速(cycling3d)——fork 自 speedskating3d(2026-07-20 換皮)。
// 賽道:自行車賽道橢圓(兩直道+兩個 180° 彎道)——沿用「一切以里程 dist 為域」的閉環範式,
//   解析式 stadium 幾何(ovalPoint/inBendAt),分道=沿法線偏移(內道/外道)。冰面→柏油賽道。
// 玩法核心(節奏踩踏,沿用速滑那套節奏判定):
//   ①左右交替按鍵踩節奏(P1=A/D)=左右腳交替踩踏板——交替且節奏穩=加速;連按同側/亂節奏=踉蹌掉速(溫柔,不摔倒)。
//   ②彎道傾身(P1=W 按住):進彎 HUD 提示,按住=內傾過彎不減速(自行車過彎本來就要傾身);沒按=彎道自然減速(不懲罰性)。
// 模式:單人對 AI 競速 / 雙人同機(duel-2p-kit §7C 競速型:racer 結構統一,只差輸入來源)/ 練習場。
// ★判定=畫面:踉蹌有動畫、傾身有側傾、踩對了看得出踩一下衝一下;★溫柔規則:永不摔倒、永遠騎得完。

// ---------- 可調量值 ----------
// push=踩踏增益比、ideal=理想踏頻(秒)、tol=節奏容錯窗、maxSpeed=速度上限(m/s,自行車比滑冰快)、
// laps=圈數、assist=幼兒輔助(往好節奏拉)、aiSkill=AI 節奏品質
export const DIFFICULTY_PRESETS = {
  kids: { push: 0.2, ideal: 0.46, tol: 0.62, maxSpeed: 10.0, laps: 2, assist: 0.55, aiSkill: 0.3, aiLean: 0.35 },
  child: { push: 0.19, ideal: 0.42, tol: 0.55, maxSpeed: 11.5, laps: 2, assist: 0.32, aiSkill: 0.46, aiLean: 0.55 },
  easy: { push: 0.18, ideal: 0.4, tol: 0.48, maxSpeed: 13.0, laps: 2, assist: 0.15, aiSkill: 0.58, aiLean: 0.72 },
  normal: { push: 0.17, ideal: 0.37, tol: 0.42, maxSpeed: 15.0, laps: 3, assist: 0, aiSkill: 0.66, aiLean: 0.86 },
  hard: { push: 0.165, ideal: 0.33, tol: 0.34, maxSpeed: 17.5, laps: 3, assist: 0, aiSkill: 0.8, aiLean: 1 },
};

export const DIFFICULTY_LABELS = {
  kids: "幼兒(超簡單)",
  child: "兒童(簡單)",
  easy: "入門",
  normal: "標準",
  hard: "職業",
};

export const GAME_MODES = {
  race: {
    label: "單人競速",
    race: true,
    description: "跟 AI 車手內外道對決——左右交替踩踏板、彎道按住傾身,先騎完全部圈數的贏!",
    goal: "先衝線者勝",
  },
  duel2p: {
    label: "雙人同機",
    race: true,
    duel: true,
    description: "一台鍵盤兩位車手:P1(紅)=A/D 交替踩+W 傾身;P2(藍)=←/→ 交替踩+↑ 傾身。內外道各一人!",
    goal: "先衝線者勝",
  },
  practice: {
    label: "練習場",
    endless: true,
    description: "沒有對手、無限圈數——自由練左右踩踏節奏與彎道傾身的手感。",
    goal: "純練手感,不計勝負",
  },
};

export function getModeConfig(modeId) {
  return GAME_MODES[modeId] || GAME_MODES.race;
}

// 車手車衣(P1 紅、P2 藍=系列題目拍板;AI 其他色)
export const SUITS = {
  p1: { label: "紅衣車手", suit: 0xc63c34, trim: 0xf2e9d8 },
  p2: { label: "藍衣車手", suit: 0x2f6fd8, trim: 0xf2e9d8 },
  ai: { label: "綠衣車手", suit: 0x3f9b5a, trim: 0xf6d743 },
};

// ---------- 賽道常數(解析式 stadium:兩直道+兩個 180° 彎;柏油自行車賽道) ----------
const STRAIGHT_LEN = 55; // 直道長(m)
const BEND_R = 22; // 彎道中線半徑(m)
const TRACK_PERIM = 2 * STRAIGHT_LEN + 2 * Math.PI * BEND_R; // ≈248.3m
const ICE_HALF_W = 5.2; // 賽道半寬(路面)
const LANE_LINE_OFF = 3.8; // 內外標線偏移
const LANE_IN = -1.9; // 內道(P1)
const LANE_OUT = 1.9; // 外道(P2/AI)
const TAP_TOO_FAST = 0.14; // 比這更快的連打=踏頻打結(踩空)
const STUMBLE_DUR = 0.9; // 踉蹌恢復秒數
const BEND_DRAG_NOLEAN = 0.5; // 彎道沒傾身的自然減速(溫柔)
const BASE_DRAG = 0.1; // 直道滑行衰減(有「踩一下衝出去」的慣性感)
// —— 衝刺(sprint):按住加速鍵→更高速度上限+踩踏增益;吃體力條 stamina,空了不能衝 ——
const SPRINT_SPEED_MULT = 1.34; // 衝刺時速度上限倍率(明顯更快)
const SPRINT_GAIN_MULT = 1.6; // 衝刺時每次踩踏增益倍率
const SPRINT_DRAIN = 0.42; // 衝刺每秒消耗體力(滿條約 2.4s 用完)
const SPRINT_RECOVER = 0.26; // 不衝時每秒回復體力(約 3.8s 回滿)
const SPRINT_MIN_START = 0.12; // 體力低於此不能「起衝」(避免空條亂點)

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// stadium 幾何:d=里程(m),off=沿「外側」法線的偏移(+外 −內)
function ovalPoint(d, off = 0) {
  const P = TRACK_PERIM;
  const L = STRAIGHT_LEN;
  const R = BEND_R;
  const m = ((d % P) + P) % P;
  let px;
  let pz;
  let tx;
  let tz;
  if (m < L) {
    px = -L / 2 + m;
    pz = R;
    tx = 1;
    tz = 0;
  } else if (m < L + Math.PI * R) {
    const a = (m - L) / R;
    px = L / 2 + R * Math.sin(a);
    pz = R * Math.cos(a);
    tx = Math.cos(a);
    tz = -Math.sin(a);
  } else if (m < 2 * L + Math.PI * R) {
    px = L / 2 - (m - L - Math.PI * R);
    pz = -R;
    tx = -1;
    tz = 0;
  } else {
    const a = (m - 2 * L - Math.PI * R) / R;
    px = -L / 2 - R * Math.sin(a);
    pz = -R * Math.cos(a);
    tx = -Math.cos(a);
    tz = Math.sin(a);
  }
  // 外側法線=切線的左法線(−tz, tx)(此參數化下指向遠離場心)
  return { x: px + -tz * off, z: pz + tx * off, tx, tz };
}

function inBendAt(d) {
  const P = TRACK_PERIM;
  const L = STRAIGHT_LEN;
  const m = ((d % P) + P) % P;
  return (m >= L && m < L + Math.PI * BEND_R) || m >= 2 * L + Math.PI * BEND_R;
}

// ---------- 人物(照 3d-figure-kit 鐵則:矩形身體/長腿/臉部眼耳嘴眉齊) ----------
function createLimb({ upperMaterial, lowerMaterial, endMaterial, upperLen, lowerLen, upperRadius, lowerRadius, end = "hand", thumbSide = 1 }) {
  const pivot = new THREE.Group();
  const upper = new THREE.Mesh(new THREE.CapsuleGeometry(upperRadius, upperLen, 4, 8), upperMaterial);
  upper.position.y = -upperLen / 2;
  pivot.add(upper);
  const joint = new THREE.Group();
  joint.position.y = -upperLen;
  pivot.add(joint);
  const lower = new THREE.Mesh(new THREE.CapsuleGeometry(lowerRadius, lowerLen, 4, 8), lowerMaterial);
  lower.position.y = -lowerLen / 2;
  joint.add(lower);
  let endMesh;
  if (end === "foot") {
    endMesh = new THREE.Mesh(new THREE.BoxGeometry(lowerRadius * 2.1, lowerRadius, lowerRadius * 3.4), endMaterial);
    endMesh.position.set(0, -lowerLen - lowerRadius * 0.4, lowerRadius * 0.9);
  } else {
    const r = lowerRadius;
    endMesh = new THREE.Group();
    endMesh.position.y = -lowerLen - r * 0.2;
    const palm = new THREE.Mesh(new THREE.BoxGeometry(r * 2.2, r * 1.7, r * 1.0), endMaterial);
    palm.position.y = -r * 0.85;
    endMesh.add(palm);
    for (let i = 0; i < 4; i += 1) {
      const finger = new THREE.Mesh(new THREE.BoxGeometry(r * 0.44, r * 1.25, r * 0.55), endMaterial);
      finger.position.set((i - 1.5) * r * 0.54, -r * 2.1, 0);
      finger.rotation.x = 0.14;
      endMesh.add(finger);
    }
    const thumb = new THREE.Mesh(new THREE.BoxGeometry(r * 0.5, r * 1.0, r * 0.55), endMaterial);
    thumb.position.set(thumbSide * r * 1.3, -r * 0.95, r * 0.1);
    thumb.rotation.z = thumbSide * -0.55;
    endMesh.add(thumb);
  }
  joint.add(endMesh);
  return { pivot, upper, joint, lower, end: endMesh };
}

const HAIR_COLORS = [0x2b2119, 0x4a3120, 0x151515, 0x5e4630, 0x7a5636, 0x3a3a45];

// makeCyclist:上半身收進 torso 樞紐(腰),前傾趴握把姿=torso.rotation.x;
// 車衣=上下同色;戴安全帽(helmet=true)或髮(觀眾);臉照鐵則(眼白+瞳孔/耳/眉/嘴)。
// bike=true 時附掛一台自行車(車架/兩輪/握把/坐墊/曲柄踏板),回傳輪子與曲柄給踩踏動畫轉。
function makeCyclist({ suit = 0x2f6f4e, trim = 0xf2e9d8, skin = 0xf3cca6, hair = 0x2b2119, helmet = true, bike = false, gender = "m", scale = 1 } = {}) {
  const group = new THREE.Group();
  const rig = new THREE.Group();
  group.add(rig);
  const suitMat = new THREE.MeshStandardMaterial({ color: suit, roughness: 0.62 });
  const pantsMat = suitMat; // 車衣:上下一體(連身車衣)
  const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.78, emissive: 0x8a7355, emissiveIntensity: 0.5 });

  // 腰樞紐:胸/頭/手臂全掛這裡 → 前傾蹲姿只轉一個角
  const torso = new THREE.Group();
  torso.position.y = 1.16;
  rig.add(torso);
  const T = (y) => y - 1.16; // 原立姿座標 → torso 局部

  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.76, 0.32), suitMat);
  chest.position.y = T(1.42);
  torso.add(chest);
  const upperChest = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.18, 0.3), suitMat);
  upperChest.position.y = T(1.7);
  torso.add(upperChest);
  for (const sx of [-1, 1]) {
    const deltoid = new THREE.Mesh(new THREE.SphereGeometry(0.088, 10, 8), suitMat);
    deltoid.position.set(sx * 0.37, T(1.73), 0);
    torso.add(deltoid);
  }
  // 胸前飾條(隊色滾邊,讓紅/藍衣一眼可辨)
  const trimMat = new THREE.MeshStandardMaterial({ color: trim, roughness: 0.6 });
  const chestStripe = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.72, 0.02), trimMat);
  chestStripe.position.set(0, T(1.44), 0.17);
  torso.add(chestStripe);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.2, 12), skinMat);
  neck.position.y = T(1.88);
  torso.add(neck);

  const waist = new THREE.Group();
  waist.position.y = 1.16;
  const belly = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.3, 0.27), suitMat);
  belly.position.y = -0.05;
  waist.add(belly);
  const hip = new THREE.Mesh(
    gender === "f" ? new THREE.BoxGeometry(0.48, 0.22, 0.3) : new THREE.BoxGeometry(0.42, 0.2, 0.27),
    pantsMat,
  );
  hip.position.y = -0.26;
  waist.add(hip);
  rig.add(waist);

  // 頭+臉群組:整顆頭(頭球/耳/帽或髮/眼/瞳/眉/嘴)全收進 headGroup,樞紐=頭中心 T(2.12),
  // 這樣 idle「偶爾往左看」時整顆頭連臉一起轉(舊版臉直接掛 torso → 只轉頭球臉不跟)。
  // H(y)=以頭中心為原點的局部座標(= 原立姿 y − 2.12);headGroup 坐在 torso 的 T(2.12),
  // 故 H(y)+T(2.12) = T(y) → 視覺位置與改動前逐一相同(戴帽/不戴帽兩態、露眼鐵則皆不變)。
  const headGroup = new THREE.Group();
  headGroup.position.set(0, T(2.12), 0);
  torso.add(headGroup);
  const H = (y) => y - 2.12;

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 18, 18), skinMat);
  head.position.y = H(2.12);
  headGroup.add(head);
  const earL = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 10), skinMat);
  earL.scale.set(0.45, 1, 0.8);
  earL.position.set(-0.245, H(2.11), 0);
  headGroup.add(earL);
  const earR = earL.clone();
  earR.position.x = 0.245;
  headGroup.add(earR);

  // 安全帽(車手,helmet=true)或頭髮(不戴/觀眾)——★臉部鐵則:兩者都只坐在「額頭上緣/頭頂」,
  // 帽緣/髮際線一律高於眉(brow T(2.26))與眼(eye T(2.18)),絕不往前壓臉(舊版帽殼半球會蓋住眼)。
  if (helmet) {
    // 空氣力學安全帽:淺帽殼坐頭頂(帽緣落在 T(2.28)≈額頭上緣)+ 後腦氣動尾 + 白通風條 + 眉上帽簷
    const shellMat = new THREE.MeshStandardMaterial({ color: suit, roughness: 0.32, metalness: 0.12 });
    // thetaLength 0.31π → 帽緣半徑 ≈0.22(略罩過頭 0.19),帽緣 y≈T(2.28) 高於眉毛 → 不遮眼/眉
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.272, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.31), shellMat);
    shell.position.y = H(2.13);
    headGroup.add(shell);
    // ★耳前無髮鐵律(戴帽同理):氣動尾只坐耳後(phi 1.06π~1.94π,前緣留在耳後 z<0),帽緣兩側不蓋耳前
    const shellBack = new THREE.Mesh(
      new THREE.SphereGeometry(0.258, 16, 12, Math.PI * 1.06, Math.PI * 0.88, Math.PI * 0.14, Math.PI * 0.5),
      shellMat,
    );
    shellBack.position.y = H(2.17);
    headGroup.add(shellBack);
    const ventMat = new THREE.MeshStandardMaterial({ color: trim, roughness: 0.5 });
    for (const dx of [-0.08, 0, 0.08]) {
      const vent = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.02, 0.22), ventMat);
      vent.position.set(dx, H(2.37), -0.03);
      headGroup.add(vent);
    }
    // 前緣帽簷:在眉毛之上、朝前上翹(遮陽不遮眼)
    const peak = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.028, 0.12), shellMat);
    peak.position.set(0, H(2.31), 0.2);
    peak.rotation.x = 0.34;
    headGroup.add(peak);
  } else {
    // 不戴:露出頭髮——★耳前無髮鐵律:髮片只從額頭上緣(髮際線高於眉)→頭頂/後腦披,
    // 兩鬢與耳朵前方一律留空(髮片下緣是水平圈,落在眉上 y≈0.16,遠高於耳 y≈-0.01)。
    const capMat = new THREE.MeshStandardMaterial({ color: hair, roughness: 0.85 });
    // 頭頂瓜皮帽:全周向淺帽,下緣圈落在額頭上緣(theta 0.32π → 下緣 y≈0.16,高於眉/眼/耳)→ 不碰兩鬢與耳
    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.265, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.32), capMat);
    hairCap.position.y = H(2.14);
    headGroup.add(hairCap);
    // 後腦頭髮:只披「耳後」半球(phi 1.06π~1.94π,兩側前緣一律留在耳朵之後 z<0),
    // 絕不繞到耳前的臉頰/兩鬢;順著後上方披下蓋住後腦與後頸。
    const hairBack = new THREE.Mesh(
      new THREE.SphereGeometry(0.258, 16, 12, Math.PI * 1.06, Math.PI * 0.88, Math.PI * 0.12, Math.PI * 0.62),
      capMat,
    );
    hairBack.position.y = H(2.13);
    headGroup.add(hairBack);
  }

  const faceDark = new THREE.MeshBasicMaterial({ color: 0x25201a });
  const faceWhite = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 10), faceWhite);
  eyeL.position.set(-0.09, H(2.18), 0.21);
  headGroup.add(eyeL);
  const eyeR = eyeL.clone();
  eyeR.position.x = 0.09;
  headGroup.add(eyeR);
  const pupilL = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 8), faceDark);
  pupilL.position.set(-0.09, H(2.18), 0.25);
  headGroup.add(pupilL);
  const pupilR = pupilL.clone();
  pupilR.position.x = 0.09;
  headGroup.add(pupilR);
  const browL = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.02, 0.02), faceDark);
  browL.position.set(-0.09, H(2.26), 0.22);
  browL.rotation.z = 0.16;
  headGroup.add(browL);
  const browR = browL.clone();
  browR.position.x = 0.09;
  browR.rotation.z = -0.16;
  headGroup.add(browR);
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.014, 8, 14, Math.PI), faceDark);
  smile.position.set(0, H(2.04), 0.21);
  smile.rotation.z = Math.PI;
  headGroup.add(smile);

  const bootMat = new THREE.MeshStandardMaterial({ color: 0x241c14, roughness: 0.55 }); // 卡鞋(深色)
  const mkArm = (x) => {
    const arm = createLimb({
      upperMaterial: suitMat, lowerMaterial: suitMat, endMaterial: skinMat,
      upperLen: 0.27, lowerLen: 0.26, upperRadius: 0.07, lowerRadius: 0.058,
      end: "hand", thumbSide: x < 0 ? 1 : -1,
    });
    arm.pivot.position.set(x, T(1.72), 0);
    arm.joint.rotation.x = -0.18;
    const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), suitMat);
    elbow.position.set(0, -0.27, 0);
    arm.pivot.add(elbow);
    torso.add(arm.pivot);
    return arm;
  };
  const leftArm = mkArm(-0.4);
  const rightArm = mkArm(0.4);
  const mkLeg = (x) => {
    const leg = createLimb({
      upperMaterial: pantsMat, lowerMaterial: pantsMat, endMaterial: bootMat,
      upperLen: 0.40, lowerLen: 0.38, upperRadius: 0.09, lowerRadius: 0.072, // 長腿 v2:腿明顯長於身
      end: "foot",
    });
    leg.pivot.position.set(x, 1.0, 0);
    const knee = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 8), pantsMat);
    knee.position.set(0, -0.4, 0);
    leg.pivot.add(knee);
    // (自行車版:腳踩踏板,無冰刀)
    rig.add(leg.pivot);
    return leg;
  };
  const leftLeg = mkLeg(-0.15);
  const rightLeg = mkLeg(0.15);

  // ---------- 自行車(掛在 group 上,和車手一起轉向/傾身,但不吃 rig 的蹲姿 y 位移) ----------
  let bikeParts = null;
  if (bike) {
    const bikeGroup = new THREE.Group();
    const frameMat = new THREE.MeshStandardMaterial({ color: suit, roughness: 0.42, metalness: 0.3 }); // 車架=隊色
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.4, metalness: 0.6 });
    const tyreMat = new THREE.MeshStandardMaterial({ color: 0x18181c, roughness: 0.75 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xcfd6dd, roughness: 0.3, metalness: 0.7 });
    // 公路/場地車比例:更大輪(WR 0.34→0.40)、更長軸距(1.10→1.32)、更高車架(座墊/握把 +0.12)
    const WR = 0.40; // 700c 大輪
    const REAR = [0, WR, -0.60];
    const FRONT = [0, WR, 0.72]; // 軸距 = 1.32m(前後輪距拉長)
    const BB = [0, 0.39, -0.02]; // 五通(曲柄軸心)——抬高 0.12 讓騎士坐姿隨之抬高(腿到踏板距離不變)
    const SEAT = [0, 0.98, -0.30]; // 座管頂(座墊抬高 → 坐上去更挺)
    const HEADT = [0, 1.04, 0.50]; // 頭管頂(握把處,抬高+略前=公路車伸展)
    const HEADB = [0, 0.54, 0.48]; // 前叉冠

    // 車輪:disc 在局部 XY 平面,disc.rotation.y=π/2 把輪面轉成垂直前後向;spin=w.rotation.x(輪軸=X)
    const mkWheel = (z) => {
      const w = new THREE.Group();
      w.position.set(0, WR, z);
      const disc = new THREE.Group();
      disc.rotation.y = Math.PI / 2;
      disc.add(new THREE.Mesh(new THREE.TorusGeometry(WR, 0.035, 10, 28), tyreMat));
      disc.add(new THREE.Mesh(new THREE.TorusGeometry(WR - 0.045, 0.014, 8, 28), rimMat));
      for (let i = 0; i < 6; i += 1) {
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.012, WR * 1.86, 0.012), rimMat);
        spoke.rotation.z = (i / 6) * Math.PI;
        disc.add(spoke);
      }
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.09, 10), rimMat);
      hub.rotation.x = Math.PI / 2; // 輪轂軸→局部 Z,經 disc.rotation.y 後對齊 X(輪軸)
      disc.add(hub);
      w.add(disc);
      bikeGroup.add(w);
      return w;
    };
    const rearWheel = mkWheel(REAR[2]);
    const frontWheel = mkWheel(FRONT[2]);

    const mkTube = (a, b, r, mat) => {
      const va = new THREE.Vector3(a[0], a[1], a[2]);
      const vb = new THREE.Vector3(b[0], b[1], b[2]);
      const len = va.distanceTo(vb);
      const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8), mat);
      t.position.copy(va).add(vb).multiplyScalar(0.5);
      t.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
      bikeGroup.add(t);
    };
    mkTube(REAR, BB, 0.028, metalMat); // 後下叉
    mkTube(REAR, SEAT, 0.024, metalMat); // 後上叉
    mkTube(BB, SEAT, 0.032, frameMat); // 座管
    mkTube(BB, HEADB, 0.036, frameMat); // 下管
    mkTube(SEAT, HEADT, 0.03, frameMat); // 上管
    mkTube(HEADB, HEADT, 0.03, frameMat); // 頭管
    mkTube(HEADB, FRONT, 0.024, metalMat); // 前叉

    const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.28), metalMat);
    saddle.position.set(0, 1.01, -0.30);
    bikeGroup.add(saddle);
    const seatpost = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.16, 8), metalMat);
    seatpost.position.set(0, 0.95, -0.30);
    bikeGroup.add(seatpost);

    // 下彎握把(bar 橫向沿 X;兩端小握把把手)
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.42, 8), metalMat);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, 1.06, 0.52);
    bikeGroup.add(bar);
    for (const sx of [-1, 1]) {
      const drop = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.13, 6), metalMat);
      drop.rotation.x = Math.PI / 2;
      drop.position.set(sx * 0.2, 1.05, 0.58);
      bikeGroup.add(drop);
    }

    // 曲柄+踏板(繞輪軸 X 旋轉;兩臂差 π,踏板分左右)
    const crank = new THREE.Group();
    crank.position.set(BB[0], BB[1], BB[2]);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.012, 8, 20), rimMat);
    ring.rotation.y = Math.PI / 2;
    crank.add(ring);
    for (const [ph, pedalX] of [[0, 0.075], [Math.PI, -0.075]]) {
      const armG = new THREE.Group();
      armG.rotation.x = ph;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.17, 0.02), metalMat);
      arm.position.y = -0.085;
      armG.add(arm);
      const pedal = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 0.06), metalMat);
      pedal.position.set(pedalX, -0.17, 0);
      armG.add(pedal);
      crank.add(armG);
    }
    bikeGroup.add(crank);

    group.add(bikeGroup);
    bikeParts = { group: bikeGroup, frontWheel, rearWheel, crank };
  }

  group.scale.setScalar(scale);
  return { group, rig, torso, head, headGroup, waist, leftArm, rightArm, leftLeg, rightLeg, smile, bike: bikeParts };
}

// 自行車坐姿基準:前傾趴握把+屈膝踩踏板;踩踏動畫在 poseCyclist 疊加
function poseCyclistIdle(f) {
  f.torso.rotation.x = 0.72; // 前傾趴低握把
  f.rig.position.y = -0.05; // 坐上(抬高後的)坐墊、屈膝——與 BB 同步抬高 0.12,腿到踏板距離不變
  for (const leg of [f.leftLeg, f.rightLeg]) {
    leg.pivot.rotation.x = -0.85;
    leg.pivot.rotation.z = 0;
    leg.joint.rotation.x = 1.15;
  }
  for (const arm of [f.leftArm, f.rightArm]) {
    arm.pivot.rotation.x = -1.15; // 向前下伸握把
    arm.pivot.rotation.z = 0;
    arm.joint.rotation.x = -0.25;
  }
}

export class CyclingGame {
  constructor({ canvas, touchRoot }) {
    this.canvas = canvas;
    this.touchRoot = touchRoot;

    const settings = loadSettings();
    this.difficulty = DIFFICULTY_PRESETS[settings.difficulty] ? settings.difficulty : "normal";
    this.modeId = GAME_MODES[settings.modeId] ? settings.modeId : "race";
    this.mode = getModeConfig(this.modeId);
    this.helmet = loadHelmet(); // 安全帽開關(戴/不戴,預設戴)——setupScene 建車手時用

    this.input = new InputManager();
    this.input.bindTouchButtons(this.touchRoot);

    this.onHudUpdate = null;
    this.onEvent = null;

    this.running = false; // ★只給主迴圈 RAF 用(athletics this.running 撞名事故鐵則——絕不再宣告同名狀態)
    this.time = 0;
    this.phase = "menu"; // menu | gate | skating | ended
    this.message = "在首頁選擇模式與難度後開始。";
    this.cameraView = 0; // 0 跟隨 1 側面轉播(右) 2 高空 3 貼地 4 側面轉播(左) —— 共 5 視角
    this.autoSaveTimer = 0;
    this.elapsed = 0;
    this.overlay = { visible: false, eyebrow: "", title: "", text: "", canResume: false };

    // ---- three ----
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.04;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x8ec6ef); // 夏日晴空
    this.scene.fog = new THREE.Fog(0x8ec6ef, 150, 560);

    this.camera = new THREE.PerspectiveCamera(52, 1, 0.1, 1200);
    this.camPos = new THREE.Vector3(0, 8, -20);
    this.camLook = new THREE.Vector3(0, 1.2, 0);
    this.camera.position.copy(this.camPos);

    this.clock = new THREE.Clock();

    this.setupScene();
    this.resetRacers();
    this.setupInput();

    window.addEventListener("resize", () => this.resize());
    this.resize();
    this.pushHud();
  }

  emitEvent(type, payload = {}) {
    if (this.onEvent) this.onEvent({ type, ...payload });
  }

  // ---------- 場景:自行車競速橢圓賽道(夏季戶外) ----------
  setupScene() {
    const sun = new THREE.HemisphereLight(0xffffff, 0x7f9a5f, 1.2);
    this.scene.add(sun);
    const key = new THREE.DirectionalLight(0xfff4dd, 1.7);
    key.position.set(35, 55, -25);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xbfe0ff, 0.6);
    rim.position.set(-25, 30, 25);
    this.scene.add(rim);

    // 草地地面(場外)
    const grass = new THREE.Mesh(
      new THREE.PlaneGeometry(560, 560),
      new THREE.MeshStandardMaterial({ color: 0x5a9e4c, roughness: 1 }),
    );
    grass.rotation.x = -Math.PI / 2;
    grass.position.y = -0.03;
    this.scene.add(grass);

    // 柏油賽道帶狀網格:深灰瀝青(微微色差做出鋪面紋理)
    const SEG = 220;
    const pos = [];
    const col = [];
    const idx = [];
    for (let i = 0; i <= SEG; i += 1) {
      const d = (i / SEG) * TRACK_PERIM;
      const a = ovalPoint(d, ICE_HALF_W);
      const b = ovalPoint(d, -ICE_HALF_W);
      pos.push(a.x, 0.02, a.z, b.x, 0.02, b.z);
      const tint = 0.29 + Math.sin(i * 1.7) * 0.02; // 瀝青鋪面微色差
      col.push(tint, tint, tint * 1.04, tint, tint, tint * 1.04);
      if (i < SEG) {
        const q = i * 2;
        idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3);
      }
    }
    const roadGeo = new THREE.BufferGeometry();
    roadGeo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    roadGeo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    roadGeo.setIndex(idx);
    roadGeo.computeVertexNormals();
    this.scene.add(new THREE.Mesh(roadGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.02 })));

    // 場心草皮內場(oval 內圈補地)
    const infield = new THREE.Mesh(
      new THREE.PlaneGeometry(STRAIGHT_LEN + BEND_R * 2 - ICE_HALF_W, (BEND_R - ICE_HALF_W) * 2),
      new THREE.MeshStandardMaterial({ color: 0x63a552, roughness: 1 }),
    );
    infield.rotation.x = -Math.PI / 2;
    infield.position.y = 0.005;
    this.scene.add(infield);

    // 分道線:內外藍線+中央紅色分道線(細長帶)
    const mkLaneRing = (off, colorHex, w = 0.14) => {
      const lp = [];
      const li = [];
      for (let i = 0; i <= SEG; i += 1) {
        const d = (i / SEG) * TRACK_PERIM;
        const a = ovalPoint(d, off + w / 2);
        const b = ovalPoint(d, off - w / 2);
        lp.push(a.x, 0.045, a.z, b.x, 0.045, b.z);
        if (i < SEG) {
          const q = i * 2;
          li.push(q, q + 2, q + 1, q + 1, q + 2, q + 3);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(lp, 3));
      g.setIndex(li);
      this.scene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: colorHex })));
    };
    mkLaneRing(-LANE_LINE_OFF, 0x2f6fd8);
    mkLaneRing(0, 0xd8433c);
    mkLaneRing(LANE_LINE_OFF, 0x2f6fd8);

    // 起終點線(黑白格紋帶,橫跨路面)+ 終點門
    const finishGroup = new THREE.Group();
    const cells = 10;
    for (let c = 0; c < cells; c += 1) {
      const off = -ICE_HALF_W + (c / cells) * ICE_HALF_W * 2;
      const cellW = (ICE_HALF_W * 2) / cells;
      const p1 = ovalPoint(0, off + cellW * 0.5);
      const t = ovalPoint(0, 0);
      const plate = new THREE.Mesh(
        new THREE.PlaneGeometry(0.8, cellW * 0.96),
        new THREE.MeshBasicMaterial({ color: c % 2 === 0 ? 0x1c1e24 : 0xf5f5f5 }),
      );
      plate.rotation.order = "YXZ"; // 先 yaw 對齊路徑方向,再倒平(XYZ 會鋸齒——equestrian 貼片鐵則)
      plate.rotation.y = Math.atan2(t.tx, t.tz);
      plate.rotation.x = -Math.PI / 2;
      plate.position.set(p1.x, 0.05, p1.z);
      finishGroup.add(plate);
    }
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.12, 4.2, 10),
        new THREE.MeshStandardMaterial({ color: 0xe9e2d2, roughness: 0.6 }),
      );
      const pp = ovalPoint(0, s * (ICE_HALF_W + 0.9));
      post.position.set(pp.x, 2.1, pp.z);
      finishGroup.add(post);
    }
    const bannerP = ovalPoint(0, 0);
    const bannerT = Math.atan2(bannerP.tx, bannerP.tz);
    const banner = new THREE.Mesh(
      new THREE.BoxGeometry(ICE_HALF_W * 2 + 1.8, 0.7, 0.08),
      new THREE.MeshStandardMaterial({ color: 0xd8433c, roughness: 0.7 }),
    );
    banner.rotation.y = bannerT;
    banner.position.set(bannerP.x, 4.0, bannerP.z);
    finishGroup.add(banner);
    this.scene.add(finishGroup);

    // 外圍防撞墊(彎道紅藍相間)+ 直道低圍欄 + 場外樹叢
    const padMatA = new THREE.MeshStandardMaterial({ color: 0xd8433c, roughness: 0.85 });
    const padMatB = new THREE.MeshStandardMaterial({ color: 0x2f6fd8, roughness: 0.85 });
    const railMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.7 });
    const bermMat = new THREE.MeshStandardMaterial({ color: 0x4f9a44, roughness: 1 });
    let padIdx = 0;
    for (let d = 0; d < TRACK_PERIM; d += 3) {
      const p = ovalPoint(d, ICE_HALF_W + 0.55);
      const yaw = Math.atan2(p.tx, p.tz);
      if (inBendAt(d)) {
        const pad = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.05, 2.9), padIdx % 2 === 0 ? padMatA : padMatB);
        pad.rotation.y = yaw;
        pad.position.set(p.x, 0.55, p.z);
        this.scene.add(pad);
      } else {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.75, 2.9), railMat);
        rail.rotation.y = yaw;
        rail.position.set(p.x, 0.4, p.z);
        this.scene.add(rail);
      }
      padIdx += 1;
      // 場外樹叢(更外圈,連綿矮灌木丘)
      if (padIdx % 2 === 0) {
        const b = ovalPoint(d, ICE_HALF_W + 2.6);
        const berm = new THREE.Mesh(new THREE.SphereGeometry(1.6, 10, 8), bermMat);
        berm.scale.set(1.6, 0.5, 1.3);
        berm.position.set(b.x, 0.12, b.z);
        this.scene.add(berm);
      }
    }

    // 兩側觀眾看台(直道外)+ 有臉觀眾(冬季厚外套色)
    const standMat = new THREE.MeshStandardMaterial({ color: 0x5f6d80, roughness: 0.85 });
    for (const side of [-1, 1]) {
      const stand = new THREE.Mesh(new THREE.BoxGeometry(58, 3.4, 5), standMat);
      stand.position.set(0, 1.7, side * (BEND_R + 10.5));
      this.scene.add(stand);
    }
    this.buildCrowd();

    // 場外樹(夏季賽場綠意:圓冠樹,無雪帽)
    const foliageMats = [
      new THREE.MeshStandardMaterial({ color: 0x3f8f4e, roughness: 1 }),
      new THREE.MeshStandardMaterial({ color: 0x4fa85c, roughness: 1 }),
      new THREE.MeshStandardMaterial({ color: 0x357a46, roughness: 1 }),
    ];
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.9 });
    let treeIdx = 0;
    for (const [x, z] of [[-62, 18], [-58, -20], [62, 22], [66, -12], [-34, 42], [30, 44], [0, -44], [44, -40], [-46, -40], [76, 4], [-76, -2]]) {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 1.8, 6), trunkMat);
      trunk.position.set(x, 0.9, z);
      this.scene.add(trunk);
      const fMat = foliageMats[treeIdx % foliageMats.length];
      const crown = new THREE.Mesh(new THREE.SphereGeometry(1.9, 10, 8), fMat);
      crown.scale.set(1, 0.92, 1);
      crown.position.set(x, 3.1, z);
      this.scene.add(crown);
      const crown2 = new THREE.Mesh(new THREE.SphereGeometry(1.3, 10, 8), fMat);
      crown2.position.set(x + 0.7, 3.7, z - 0.4);
      this.scene.add(crown2);
      treeIdx += 1;
    }

    // 車手(P1 紅=內道;對手 藍/綠=外道)——bike:true 各配一台自行車;安全帽依 this.helmet
    this.buildCyclists();
  }

  // 依 this.helmet 建/重建三位車手(戴帽切換時可重跑)——被 setupScene 與 setHelmet 共用
  buildCyclists() {
    for (const f of [this.p1Figure, this.p2Figure, this.aiFigure]) {
      if (f && f.group) this.scene.remove(f.group);
    }
    const h = this.helmet;
    this.p1Figure = makeCyclist({ suit: SUITS.p1.suit, trim: SUITS.p1.trim, bike: true, helmet: h });
    this.scene.add(this.p1Figure.group);
    this.p2Figure = makeCyclist({ suit: SUITS.p2.suit, trim: SUITS.p2.trim, bike: true, helmet: h });
    this.scene.add(this.p2Figure.group);
    this.aiFigure = makeCyclist({ suit: SUITS.ai.suit, trim: SUITS.ai.trim, skin: 0xe8b98a, bike: true, helmet: h });
    this.scene.add(this.aiFigure.group);
    poseCyclistIdle(this.p1Figure);
    poseCyclistIdle(this.p2Figure);
    poseCyclistIdle(this.aiFigure);
  }

  // 安全帽開關:存檔 → 重建車手 → 重指 racer.figure(只在選單/未賽中切換)
  setHelmet(on) {
    this.helmet = !!on;
    saveHelmet(this.helmet);
    this.buildCyclists();
    this.resetRacers(); // racer.figure 重新指向新 figure 並歸位擺好
    this.pushHud();
  }

  buildCrowd() {
    this.crowd = new THREE.Group();
    this.crowdFigures = []; // 收好每個觀眾人偶 + 決定性相位,供 animateCrowd 每幀驅動(舉手歡呼+左右看)
    const coats = [0xd98a3d, 0x3d78d9, 0xc94f8f, 0x4fae6a, 0xb0552f, 0x8a5ac0];
    for (const side of [-1, 1]) {
      for (let i = 0; i < 7; i += 1) {
        const p = makeCyclist({
          suit: coats[(i + (side > 0 ? 3 : 0)) % coats.length],
          trim: 0xf2e9d8,
          helmet: false,
          hair: HAIR_COLORS[(i * 2 + (side > 0 ? 1 : 0)) % HAIR_COLORS.length],
          gender: (i + (side > 0 ? 1 : 0)) % 2 === 0 ? "m" : "f",
          scale: 0.92,
        });
        p.torso.rotation.x = 0.05; // 觀眾站直(不擺蹲姿)
        p.rig.position.y = 0;
        for (const leg of [p.leftLeg, p.rightLeg]) {
          leg.pivot.rotation.x = -0.05;
          leg.joint.rotation.x = 0.1;
        }
        p.group.position.set(-27 + i * 9, 3.4, side * (BEND_R + 8.6));
        p.group.rotation.y = side > 0 ? Math.PI : 0;
        this.crowd.add(p.group);
        // 相位=座號×0.9 + 對側偏移(決定性!絕不用建構期 Math.random)→ 此起彼落的人浪,不整齊劃一
        this.crowdFigures.push({ f: p, phase: i * 0.9 + (side > 0 ? 1.7 : 0), rigY: p.rig.position.y });
      }
    }
    this.scene.add(this.crowd);
  }

  // 觀眾生動:每幀驅動(不論 phase 都跑)——舉手歡呼(雙臂上下循環)+ 頭左右緩慢擺看比賽,
  // 各人用自己的相位錯開形成人浪;只改 rotation/position,不建新幾何(人偶多也輕量)。
  animateCrowd() {
    if (!this.crowdFigures) return;
    const t = this.time;
    for (const c of this.crowdFigures) {
      const f = c.f;
      const ph = c.phase;
      // 頭(整顆 headGroup)左右緩慢擺看比賽(慢頻,±0.42 rad)
      if (f.headGroup) f.headGroup.rotation.y = Math.sin(t * 0.9 + ph) * 0.42;
      // 舉手歡呼:雙臂由放下(pivot.x≈-0.5)→高舉過頭(≈-2.9)循環,快頻;相位錯開=波浪
      const raise = Math.sin(t * 2.4 + ph) * 0.5 + 0.5; // 0(放下)→1(高舉)
      const lift = -0.5 - raise * 2.4;
      if (f.leftArm) { f.leftArm.pivot.rotation.x = lift; f.leftArm.pivot.rotation.z = 0.22; f.leftArm.joint.rotation.x = -0.12; }
      if (f.rightArm) { f.rightArm.pivot.rotation.x = lift; f.rightArm.pivot.rotation.z = -0.22; f.rightArm.joint.rotation.x = -0.12; }
      // 隨歡呼微微踮起(舉高時身體上抬一點點,增加雀躍感;不誇張)
      if (f.rig) f.rig.position.y = c.rigY + raise * 0.06;
    }
  }

  // ---------- racer 結構(duel-2p-kit §7C:P1/P2/AI 同一套,只差輸入來源) ----------
  mkRacer(figure, lane, label) {
    const isP1 = label === "P1";
    return {
      figure,
      lane,
      label,
      // idle 生動:偶爾往左看+微笑的節奏(用 label 錯開相位/週期,兩人不整齊劃一;絕不用建構期 Math.random)
      glancePhase: isP1 ? 0 : 2.9,
      glancePeriod: isP1 ? 5.4 : 6.3,
      dist: 0,
      speed: 0,
      strideT: 0,
      lastSide: null,
      lastTapAt: -9,
      rhythm01: 0,
      stumbleT: 0,
      kickT: 9,
      leanHeld: false,
      leanVis: 0,
      lap: 1,
      finished: false,
      finishTime: 0,
      aiTapTimer: 0,
      lastResult: null, // 'perfect' | 'good' | 'fast' | 'same' | null
      stamina: 1, // 衝刺體力條(0~1)
      sprintHeld: false, // 本幀是否按住衝刺鍵
      sprinting: false, // 實際生效中的衝刺(latch + 有體力 + 沒踉蹌)
      _sprintLatch: false, // 起衝閂鎖:要體力>SPRINT_MIN_START 才能點著,放開或耗盡才解
    };
  }

  _isHuman(who) {
    return who === "p1" || this.modeId === "duel2p";
  }

  resetRacers() {
    this.p1 = this.mkRacer(this.p1Figure, LANE_IN, "P1");
    const duel = this.modeId === "duel2p";
    this.opp = duel
      ? this.mkRacer(this.p2Figure, LANE_OUT, "P2")
      : this.mkRacer(this.aiFigure, LANE_OUT, "AI");
    this.p2Figure.group.visible = duel;
    this.aiFigure.group.visible = !duel && !!this.mode.race;
    this.p1.dist = 0;
    this.opp.dist = 0;
    this.lastGapSign = 0;
    this.bendWasIn = false;
    this.bendLeanOkStreak = 0;
    this.rhythmCheered = false;
    this.lastLapAnnounced = false;
    this.placeRacer(this.p1);
    this.placeRacer(this.opp);
  }

  // ---------- 輸入 ----------
  setupInput() {
    this.canvas.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      // 觸控/點畫面:出發;騎行中=自動左右交替踩(平板孩子單指也能玩)
      if (this.phase === "gate") {
        this.beginRace();
      } else if (this.phase === "skating") {
        const next = this.p1.lastSide === "L" ? "R" : "L";
        this.tapPush(this.p1, next);
      }
    });
    this.canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  }

  // ---------- 局面控制 ----------
  applyPresentation({ difficulty, modeId }) {
    if (difficulty && DIFFICULTY_PRESETS[difficulty]) this.difficulty = difficulty;
    if (modeId && GAME_MODES[modeId]) {
      this.modeId = modeId;
      this.mode = getModeConfig(modeId);
    }
    saveSettings({ difficulty: this.difficulty, modeId: this.modeId });
    this.message = `${this.mode.label} · ${DIFFICULTY_LABELS[this.difficulty]} 已設定。`;
    this.pushHud();
  }

  openHomeMenu() {
    this.phase = "menu";
    if (this.confetti) {
      for (const c of this.confetti) this.scene.remove(c.mesh);
      this.confetti = [];
    }
    this.message = "在首頁選擇模式與難度後開始。";
    this.overlay.visible = false;
    this.pushHud();
  }

  startSelectedMatch() {
    this.elapsed = 0;
    this.resetRacers();
    const preset = DIFFICULTY_PRESETS[this.difficulty];
    this.laps = this.mode.endless ? Infinity : preset.laps;
    this.finishDist = this.mode.endless ? Infinity : preset.laps * TRACK_PERIM;
    this.cameraView = 0; // 每場回到跟隨視角(雙人側面視角會被 P2 擋鏡頭)
    // 起跑鏡頭直接切到車手後方(joash 教訓:lerp 穿場=整幀糊掉)
    const p0 = ovalPoint(0, 0);
    this.camPos.set(p0.x - p0.tx * 9, 4.6, p0.z - p0.tz * 9);
    this.camLook.set(p0.x, 1.2, p0.z);
    this.phase = "gate";
    this.message = this.modeId === "duel2p"
      ? "按空白鍵(或點畫面)出發!P1=A/D 交替、W 傾身;P2=←/→ 交替、↑ 傾身!"
      : "按空白鍵(或點畫面)出發!A/D 左右交替踩節奏,進彎按住 W 傾身!";
    this.emitEvent("match-start", { mode: this.mode.label });
    this.pushHud();
  }

  beginRace() {
    if (this.phase !== "gate") return;
    this.phase = "skating";
    this.p1.speed = 2.2;
    this.opp.speed = 2.2;
    const preset = DIFFICULTY_PRESETS[this.difficulty];
    this.opp.aiTapTimer = preset.ideal * 0.6;
    this.message = "出發!左右交替踩踏板——節奏穩才快!";
    this.emitEvent("gate", {});
    this.pushHud();
  }

  // ---------- 節奏踩踏(節奏判定搬過來的自行車版:左右鍵=左右腳交替踩踏板) ----------
  tapPush(racer, side) {
    if (this.overlay.visible) return;
    if (this.phase === "gate") {
      this.beginRace();
      // 出發那一下也算第一步
    }
    if (this.phase !== "skating" || racer.finished) return;
    const preset = DIFFICULTY_PRESETS[this.difficulty];
    const now = this.time;
    const gap = now - racer.lastTapAt;
    racer.lastTapAt = now;

    // 連按同側=踉蹌(溫柔:掉速+短暫無力,不摔倒)
    if (racer.lastSide === side) {
      racer.lastSide = side;
      racer.speed *= 0.8;
      racer.stumbleT = STUMBLE_DUR;
      racer.rhythm01 *= 0.35;
      racer.lastResult = "same";
      if (racer === this.p1 || this.modeId === "duel2p") {
        this.message = `${this.racerName(racer)} 連踩同一腳——踉蹌了一下!左右交替才順!`;
        this.emitEvent("stumble", { who: racer.label });
      }
      this.pushHud();
      return;
    }
    racer.lastSide = side;

    // 亂節奏:連打太快=踏頻打結(踩空),小踉蹌
    if (gap < TAP_TOO_FAST) {
      racer.speed *= 0.9;
      racer.stumbleT = STUMBLE_DUR * 0.55;
      racer.rhythm01 *= 0.5;
      racer.lastResult = "fast";
      if (racer === this.p1 || this.modeId === "duel2p") {
        this.message = "太急了——踩一下、衝一下,跟著節奏!";
        this.emitEvent("stumble", { who: racer.label, soft: true });
      }
      this.pushHud();
      return;
    }

    let q = clamp(1 - Math.abs(gap - preset.ideal) / preset.tol, 0, 1);
    q = clamp(q + preset.assist * (1 - q), 0, 1); // 幼兒輔助:往好節奏拉
    this.applyPush(racer, q, side);
    racer.rhythm01 = racer.rhythm01 * 0.55 + q * 0.45;
    racer.lastResult = q >= 0.85 ? "perfect" : "good";
    if (racer === this.p1 && racer.rhythm01 > 0.8 && !this.rhythmCheered) {
      this.rhythmCheered = true;
      this.emitEvent("rhythm-good", {});
    }
  }

  applyPush(racer, q, side) {
    const preset = DIFFICULTY_PRESETS[this.difficulty];
    const weak = racer.stumbleT > 0 ? 0.45 : 1;
    // 衝刺:抬高速度上限 + 放大踩踏增益(明顯更快)
    const boost = racer.sprinting ? SPRINT_SPEED_MULT : 1;
    const spGain = racer.sprinting ? SPRINT_GAIN_MULT : 1;
    const cap = preset.maxSpeed * boost;
    const gain = (cap * 1.18 - racer.speed) * preset.push * spGain * (0.35 + 0.65 * q) * weak;
    racer.speed = Math.min(cap * 1.05, racer.speed + Math.max(0, gain));
    // 動畫:踩踏 kick(踩一下衝出去一下的推進感)
    racer.kickT = 0;
    racer.kickSide = side;
    // 每次有效踩踏推進曲柄半圈(左右腳交替的動力衝程);不硬設相位,曲柄靠連續遞增平順轉
    racer.strideT += 0.5;
  }

  racerName(racer) {
    if (this.modeId === "duel2p") return racer === this.p1 ? "P1(紅)" : "P2(藍)";
    return racer === this.p1 ? "你" : "AI";
  }

  // ---------- 完賽 ----------
  finishRace(firstRacer) {
    this.phase = "ended";
    const duel = this.modeId === "duel2p";
    const win = firstRacer === this.p1;
    const timeText = `${this.elapsed.toFixed(1)} 秒`;
    if (win) this.spawnConfetti();
    if (duel) {
      this.overlay = {
        visible: true,
        eyebrow: "衝線!",
        title: win ? "P1(紅)獲勝!" : "P2(藍)獲勝!",
        text: `${timeText} 先衝過終點!兩位車手都騎得漂亮——再來一場!`,
        canResume: false,
      };
      if (!win) this.spawnConfetti(); // 雙人:誰贏都慶祝
      this.emitEvent("duel-end", { winner: win ? "p1" : "p2", elapsed: this.elapsed });
      this.message = win ? "P1(紅)先衝線!" : "P2(藍)先衝線!";
    } else {
      this.overlay = {
        visible: true,
        eyebrow: win ? "勝利!" : "惜敗",
        title: win ? "第一個衝線!" : "AI 先到了……",
        text: win
          ? `${timeText} 衝過終點,把${SUITS.ai.label}甩在後面!踏頻就是速度!`
          : `差一點!穩住左右踩踏節奏、彎道記得傾身,再來一場追回來!(用時 ${timeText})`,
        canResume: false,
      };
      this.emitEvent("race-end", { win, elapsed: this.elapsed });
      this.message = win ? `勝利!${timeText} 先馳得點!` : "AI 先衝線——再來一場!";
    }
    this.saveGame(true);
    this.pushHud();
  }

  spawnConfetti() {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!this.confetti) this.confetti = [];
    const colors = [0xffd24a, 0xff6b81, 0x7de08c, 0x6ec6ff, 0xc890ff, 0xffa050, 0xf5f0e0];
    const p = ovalPoint(this.p1.dist, 0);
    for (let i = 0; i < 150; i += 1) {
      const kind = i % 3;
      const geo = kind === 0
        ? new THREE.PlaneGeometry(0.16, 0.16)
        : kind === 1
          ? new THREE.CircleGeometry(0.1, 6)
          : new THREE.PlaneGeometry(0.06, 0.5);
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: colors[i % colors.length], side: THREE.DoubleSide, transparent: true, opacity: 0.95,
      }));
      mesh.position.set(p.x + (Math.random() * 2 - 1) * 12, 7 + Math.random() * 6, p.z + (Math.random() * 2 - 1) * 12);
      mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      this.scene.add(mesh);
      this.confetti.push({
        mesh,
        vy: 1.2 + Math.random() * 1.6,
        swayA: Math.random() * Math.PI * 2,
        swayF: 1.5 + Math.random() * 2,
        spin: (Math.random() * 2 - 1) * 3,
        t: 0,
      });
    }
  }

  togglePause() {
    if (this.phase === "menu" || this.phase === "ended") return;
    if (this.overlay.visible) {
      this.resume();
    } else {
      this.overlay = { visible: true, eyebrow: "暫停中", title: "喘口氣", text: "腳踏車也歇一歇,準備好再繼續。", canResume: true };
      this.pushHud();
    }
  }

  resume() {
    if (!this.overlay.canResume) return;
    this.overlay.visible = false;
    this.pushHud();
  }

  cycleCameraView() {
    this.cameraView = (this.cameraView + 1) % 5;
    const names = ["跟隨視角", "側面轉播(右)", "高空俯瞰", "貼地視角", "側面轉播(左)"];
    this.message = `視角:${names[this.cameraView]}。`;
    this.pushHud();
  }

  // ---------- 主迴圈 ----------
  start() {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    const tick = () => {
      if (!this.running) return;
      const delta = Math.min(this.clock.getDelta(), 0.05);
      this.update(delta);
      this.render();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  resize() {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height || 1.6;
    this.camera.updateProjectionMatrix();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  update(delta) {
    this.time += delta;
    const paused = this.overlay.visible;
    const duel = this.modeId === "duel2p";
    const solo = !duel;

    this.handleKeys();

    if (!paused && this.phase === "skating") {
      this.elapsed += delta;
      const preset = DIFFICULTY_PRESETS[this.difficulty];

      // —— 玩家輸入:左右交替踩踏 + 傾身(solo 別名:單人時 P2 鍵仍有效,duel-2p-kit §3) ——
      if (this.input.consumePress("p1left")) this.tapPush(this.p1, "L");
      if (this.input.consumePress("p1right")) this.tapPush(this.p1, "R");
      if (this.input.consumePress("p2left")) this.tapPush(solo ? this.p1 : this.opp, "L");
      if (this.input.consumePress("p2right")) this.tapPush(solo ? this.p1 : this.opp, "R");
      this.p1.leanHeld = this.input.isDown("p1lean") || (solo && this.input.isDown("p2lean"));
      if (duel) this.opp.leanHeld = this.input.isDown("p2lean");
      // 衝刺鍵(按住):P1=ShiftLeft;P2=ShiftRight/Enter;solo 時 P2 衝刺鍵別名回 P1(和踩踏鍵一致)
      this.p1.sprintHeld = this.input.isDown("p1sprint") || (solo && this.input.isDown("p2sprint"));
      if (duel) this.opp.sprintHeld = this.input.isDown("p2sprint");

      // —— AI(單人競速):同一套 racer,輸入來源=節拍器(duel-2p-kit §7C) ——
      if (!this._isHuman("opp") && this.mode.race && !this.opp.finished) {
        this.opp.aiTapTimer -= delta;
        if (this.opp.aiTapTimer <= 0) {
          this.opp.aiTapTimer = preset.ideal * (0.92 + Math.random() * 0.18);
          const q = clamp(preset.aiSkill + (Math.random() * 2 - 1) * 0.16, 0, 1);
          const side = this.opp.lastSide === "L" ? "R" : "L";
          this.opp.lastSide = side;
          this.applyPush(this.opp, q, side);
          this.opp.rhythm01 = this.opp.rhythm01 * 0.55 + q * 0.45;
        }
        // AI 傾身:依難度機率記得傾身(幼兒檔 AI 常忘記=彎道是追過牠的機會)
        if (inBendAt(this.opp.dist)) {
          if (this.opp._leanRoll === undefined) this.opp._leanRoll = Math.random();
          this.opp.leanHeld = this.opp._leanRoll < preset.aiLean;
        } else {
          this.opp._leanRoll = undefined;
          this.opp.leanHeld = false;
        }
      }

      // —— 物理:騎行慣性衰減(直道慣性 vs 彎道沒傾身自然減速) ——
      for (const r of [this.p1, this.opp]) {
        if (!r.figure.group.visible && r !== this.p1) continue;
        // —— 衝刺體力:起衝需 stamina>SPRINT_MIN_START;衝刺中耗、否則回;耗盡/放開解閂(不能無限衝) ——
        if (r.sprintHeld && !r._sprintLatch && r.stamina > SPRINT_MIN_START) r._sprintLatch = true;
        if (!r.sprintHeld || r.stamina <= 0.01) r._sprintLatch = false;
        r.sprinting = r._sprintLatch && !r.finished && r.stumbleT <= 0 && r.stamina > 0.01;
        if (r.sprinting) r.stamina = Math.max(0, r.stamina - SPRINT_DRAIN * delta);
        else r.stamina = Math.min(1, r.stamina + SPRINT_RECOVER * delta);
        if (r.finished) {
          r.speed = Math.max(0, r.speed - delta * 3); // 衝線後滑行收速
        } else {
          const bend = inBendAt(r.dist);
          const drag = bend && !r.leanHeld ? BEND_DRAG_NOLEAN : BASE_DRAG;
          r.speed *= Math.max(0, 1 - drag * delta);
        }
        r.stumbleT = Math.max(0, r.stumbleT - delta);
        r.dist += r.speed * delta;
        r.strideT += delta * (0.35 + r.speed * 0.075);
        r.kickT = (r.kickT ?? 9) + delta;
        // 圈數
        const lap = Math.min(this.mode.endless ? Infinity : this.laps, Math.floor(r.dist / TRACK_PERIM) + 1);
        if (lap !== r.lap) {
          r.lap = lap;
          if (r === this.p1) {
            if (this.mode.endless) {
              this.emitEvent("lap", { lap });
              this.message = `第 ${lap} 圈——節奏越來越穩!`;
            } else if (lap === this.laps && !this.lastLapAnnounced) {
              this.lastLapAnnounced = true;
              this.emitEvent("last-lap", {});
              this.message = "最後一圈——衝啊!";
            }
          }
        }
        // 衝線
        if (!this.mode.endless && !r.finished && r.dist >= this.finishDist) {
          r.finished = true;
          r.finishTime = this.elapsed;
          if (this.phase !== "ended") this.finishRace(r);
        }
      }

      // —— 彎道進出提示(P1) ——
      const nowBend = inBendAt(this.p1.dist);
      if (nowBend && !this.bendWasIn) {
        this.emitEvent("bend-enter", { first: !this._bendEverEntered });
        this._bendEverEntered = true;
        if (!this.p1.leanHeld) this.message = "進彎道了——按住 W 傾身,不減速!";
      } else if (!nowBend && this.bendWasIn) {
        if (this._bendLeanGood) this.emitEvent("bend-exit-good", {});
        this._bendLeanGood = false;
      }
      if (nowBend && this.p1.leanHeld) this._bendLeanGood = true;
      this.bendWasIn = nowBend;

      // —— 超越偵測(競速) ——
      if (this.mode.race && this.phase === "skating") {
        const gapSign = Math.sign(this.p1.dist - this.opp.dist);
        if (gapSign !== 0 && this.lastGapSign !== 0 && gapSign !== this.lastGapSign && Math.abs(this.p1.dist - this.opp.dist) > 0.2) {
          this.emitEvent("overtake", { ahead: gapSign > 0 });
          this.message = gapSign > 0 ? "超越!衝到前面去了!" : "被追過了——加緊節奏追回來!";
        }
        if (gapSign !== 0) this.lastGapSign = gapSign;
      }
    } else if (!paused && this.phase === "gate") {
      if (this.input.consumePress("p1left") || this.input.consumePress("p1right")
        || this.input.consumePress("p2left") || this.input.consumePress("p2right")) {
        this.beginRace();
      }
    }

    // 彩花
    if (this.confetti && this.confetti.length) {
      for (const c of this.confetti) {
        c.t += delta;
        c.mesh.position.y -= c.vy * delta;
        c.mesh.position.x += Math.sin(c.swayA + c.t * c.swayF) * delta * 1.2;
        c.mesh.rotation.x += c.spin * delta;
        c.mesh.rotation.z += c.spin * 0.7 * delta;
        if (c.t > 5.5) c.mesh.material.opacity = Math.max(0, 0.95 * (1 - (c.t - 5.5) / 1.5));
      }
      this.confetti = this.confetti.filter((c) => {
        if (c.t >= 7 || c.mesh.position.y < -0.5) {
          this.scene.remove(c.mesh);
          return false;
        }
        return true;
      });
    }

    this.poseCyclist(this.p1);
    this.poseCyclist(this.opp);
    this.animateHead(this.p1); // idle 生動:偶爾往左看+微笑(P1 與對手都套,錯開相位)
    this.animateHead(this.opp);
    this.animateCrowd(); // 觀眾舉手歡呼+左右看(每幀,相位錯開的人浪)
    this.placeRacer(this.p1);
    this.placeRacer(this.opp);
    this.updateCamera(delta);

    this.autoSaveTimer += delta;
    if (this.autoSaveTimer > 5) {
      this.autoSaveTimer = 0;
      this.saveGame(true);
    }

    this.input.endFrame();
    this.pushHud();
  }

  handleKeys() {
    if (this.input.consumePress("camera")) this.cycleCameraView();
    if (this.input.consumePress("pause")) this.togglePause();
    if (this.overlay.visible) return;
    if (this.input.consumePress("shoot") && this.phase === "gate") this.beginRace();
  }

  // ---------- 擺位與動畫 ----------
  placeRacer(r) {
    const p = ovalPoint(r.dist, r.lane);
    r.figure.group.position.set(p.x, 0, p.z);
    r.figure.group.rotation.order = "YXZ";
    r.figure.group.rotation.y = Math.atan2(p.tx, p.tz);
    // 傾身:彎道內傾(inward=局部 +x → 負 roll);踉蹌時左右小晃
    const bend = inBendAt(r.dist);
    const leanTarget = bend ? (r.leanHeld ? -0.36 : -0.1) : 0;
    r.leanVis += (leanTarget - r.leanVis) * 0.12;
    let roll = r.leanVis;
    if (r.stumbleT > 0) roll += Math.sin(this.time * 22) * 0.09 * (r.stumbleT / STUMBLE_DUR);
    r.figure.group.rotation.z = roll;
  }

  poseCyclist(r) {
    const f = r.figure;
    if (!f.group.visible) return;
    if (this.phase === "menu" || this.phase === "gate" || (this.phase === "ended" && r.speed < 0.5)) {
      poseCyclistIdle(f);
      return;
    }
    const sp = r.speed;
    const fast = clamp(sp / 12, 0, 1);
    const sprintPush = r.sprinting ? 0.14 : 0; // 衝刺:踩踏幅度加大(用力猛踩)
    const crankAng = r.strideT * Math.PI * 2; // 曲柄角(strideT 隨速度連續遞增+每次踩踏 +0.5 圈)
    const kick = Math.max(0, 1 - (r.kickT ?? 9) / 0.34); // 踩踏瞬間的爆發相
    // 前傾趴握把:越快趴越低(踩一下衝一下的下壓);衝刺時再壓低一點(進攻姿)
    f.torso.rotation.x = 0.72 + fast * 0.16 + kick * 0.05 + (r.sprinting ? 0.06 : 0);
    f.rig.position.y = -0.05 - fast * 0.02;
    // 轉曲柄+輪子(判定=畫面:踩對了看得出踩一下衝一下)
    if (f.bike) {
      f.bike.crank.rotation.x = crankAng;
      const roll = r.dist / 0.40; // 輪子滾動角=里程/輪半徑(WR=0.40,越快轉越快)
      f.bike.frontWheel.rotation.x = roll;
      f.bike.rearWheel.rotation.x = roll;
    }
    // 左右腿交替踩踏板(大腿前後擺 + 膝蓋屈伸,L/R 差 π、和曲柄同相)
    const legs = [[f.leftLeg, 0], [f.rightLeg, Math.PI]];
    for (const [leg, ph] of legs) {
      const a = crankAng + ph;
      leg.pivot.rotation.x = -0.85 + Math.sin(a) * (0.4 + kick * 0.08 + sprintPush);
      leg.pivot.rotation.z = 0;
      leg.joint.rotation.x = 1.15 - Math.cos(a) * (0.4 + sprintPush);
    }
    // 手臂:握把上微微起伏(衝刺時低頭下壓)
    const barBob = Math.sin(crankAng) * 0.045;
    f.leftArm.pivot.rotation.x = -1.15 - fast * 0.05 + barBob;
    f.leftArm.pivot.rotation.z = -0.05;
    f.leftArm.joint.rotation.x = -0.25;
    f.rightArm.pivot.rotation.x = -1.15 - fast * 0.05 - barBob;
    f.rightArm.pivot.rotation.z = 0.05;
    f.rightArm.joint.rotation.x = -0.25;
    // 踉蹌:上身左右晃、手臂亂擺(不摔倒)
    if (r.stumbleT > 0) {
      const w = r.stumbleT / STUMBLE_DUR;
      f.leftArm.pivot.rotation.z = -0.4 * w + Math.sin(this.time * 18) * 0.25 * w;
      f.rightArm.pivot.rotation.z = 0.4 * w - Math.sin(this.time * 18) * 0.25 * w;
      f.torso.rotation.x = 0.6 + Math.sin(this.time * 15) * 0.06 * w;
    }
  }

  // idle 生動:每隔 ~5-6 秒,整顆頭(headGroup)平滑往騎士左手邊「明顯」瞥一下(+0.6 rad 維持 ~1s 再回正)
  // + 配合「明顯咧嘴」笑一下(smile torus 短暫放大到 1.4);比賽踩踏中也照跑但平滑不影響操作。
  // 用 racer 自己的相位/週期錯開(不整齊劃一),不在建構期用被禁的 Math.random。
  animateHead(r) {
    const f = r && r.figure;
    if (!f || !f.headGroup) return;
    const period = r.glancePeriod || 5.4;
    const glance = 1.6; // 一次往左看的視窗長度(rise 0.3 + hold ~1.0 + fall 0.3,停留略長)
    const t = (this.time + (r.glancePhase || 0)) % period;
    // k:0→1→0 的緩起緩收(smoothstep 梯形),full=1 段=「看著左邊」的停留
    let k = 0;
    if (t < glance) {
      const ramp = 0.3;
      let raw = 1;
      if (t < ramp) raw = t / ramp;
      else if (t > glance - ramp) raw = (glance - t) / ramp;
      k = raw * raw * (3 - 2 * raw); // smoothstep
    }
    // 頭平滑轉到左邊(+0.6 rad = 明顯往騎士左手邊看),lerp 回正,絕不瞬跳
    const targetYaw = 0.6 * k;
    f.headGroup.rotation.y += (targetYaw - f.headGroup.rotation.y) * 0.15;
    // 微笑一下:smile 短暫放大到 ~1.4(明顯咧嘴笑),再平滑回復
    if (f.smile) {
      const targetS = 1 + 0.4 * k;
      f.smile.scale.x += (targetS - f.smile.scale.x) * 0.15;
      f.smile.scale.y += (targetS - f.smile.scale.y) * 0.15;
    }
  }

  updateCamera(delta) {
    if (this.freeCam) return; // 驗證用:凍結自動運鏡,讓外部自由擺鏡頭(拍正面臉)
    const r = this.p1;
    const p = ovalPoint(r.dist, r.lane);
    const duel = this.modeId === "duel2p";
    let desiredPos;
    let desiredLook;
    if (this.phase === "menu") {
      const a = this.time * 0.07;
      desiredPos = new THREE.Vector3(Math.cos(a) * 52, 15, Math.sin(a) * 40);
      desiredLook = new THREE.Vector3(0, 1, 0);
    } else if (this.cameraView === 0) {
      // 跟隨:雙人時拉遠、看兩人中點(duel-2p-kit:跟單人會把 P2 甩出畫面)
      let cx = p.x;
      let cz = p.z;
      let back = 8.8;
      let up = 4.3;
      if (duel || (this.mode.race && this.opp.figure.group.visible)) {
        const q = ovalPoint(this.opp.dist, this.opp.lane);
        const gap = Math.min(26, Math.hypot(p.x - q.x, p.z - q.z));
        if (duel) {
          cx = (p.x + q.x) / 2;
          cz = (p.z + q.z) / 2;
        }
        back = 8.8 + gap * 0.42;
        up = 4.3 + gap * 0.2;
      }
      desiredPos = new THREE.Vector3(cx - p.tx * back, up, cz - p.tz * back);
      desiredLook = new THREE.Vector3(cx + p.tx * 7, 1.2, cz + p.tz * 7);
    } else if (this.cameraView === 1) {
      const out = ovalPoint(r.dist, r.lane + 13);
      desiredPos = new THREE.Vector3(out.x, 4.2, out.z);
      desiredLook = new THREE.Vector3(p.x, 1.1, p.z);
    } else if (this.cameraView === 2) {
      desiredPos = new THREE.Vector3(p.x + 3, 30, p.z + 3);
      desiredLook = new THREE.Vector3(p.x + p.tx * 6, 0.5, p.z + p.tz * 6);
    } else if (this.cameraView === 3) {
      desiredPos = new THREE.Vector3(p.x - p.tx * 1.2, 1.5, p.z - p.tz * 1.2);
      desiredLook = new THREE.Vector3(p.x + p.tx * 12, 1.0, p.z + p.tz * 12);
    } else {
      // 4 側面轉播(左):view 1(右,外側 lane+13)的鏡像——從賽道另一側(內側 lane-13)同高度看選手,拍到相反的一隻手
      const other = ovalPoint(r.dist, r.lane - 13);
      desiredPos = new THREE.Vector3(other.x, 4.2, other.z);
      desiredLook = new THREE.Vector3(p.x, 1.1, p.z);
    }
    const k = 1 - Math.exp(-delta * 3.4);
    this.camPos.lerp(desiredPos, k);
    this.camLook.lerp(desiredLook, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    // 衝刺鏡頭:P1(duel 時任一人)衝刺 → FOV 微張(速度線般的推進感);放開平滑復位到 52
    const sprintOn = this.p1.sprinting || (duel && this.opp.sprinting);
    this._sprintCam = (this._sprintCam ?? 0) + ((sprintOn ? 1 : 0) - (this._sprintCam ?? 0)) * (1 - Math.exp(-delta * 6));
    const fov = 52 + this._sprintCam * 7;
    if (Math.abs(this.camera.fov - fov) > 0.02) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  // 小地圖資料(路線+雙車手)
  getMinimapData() {
    if (!this._miniPath) {
      this._miniPath = [];
      for (let i = 0; i <= 100; i += 1) {
        const p = ovalPoint((TRACK_PERIM * i) / 100, 0);
        this._miniPath.push([p.x, p.z]);
      }
    }
    const me = ovalPoint(this.p1.dist, this.p1.lane);
    const opp = this.opp.figure.group.visible ? ovalPoint(this.opp.dist, this.opp.lane) : null;
    const fin = ovalPoint(0, 0);
    return {
      path: this._miniPath,
      me: [me.x, me.z],
      opp: opp ? [opp.x, opp.z] : null,
      finish: [fin.x, fin.z],
    };
  }

  // ---------- HUD ----------
  pushHud() {
    if (!this.onHudUpdate) return;
    const preset = DIFFICULTY_PRESETS[this.difficulty];
    const duel = this.modeId === "duel2p";
    const phaseLabels = { menu: "主選單", gate: "出發線", skating: "騎行", ended: "完賽" };
    const mins = Math.floor(this.elapsed / 60);
    const secs = (this.elapsed % 60).toFixed(1).padStart(4, "0");
    const bend = inBendAt(this.p1.dist);
    const racing = this.mode.race && (this.phase === "skating" || this.phase === "ended");
    let rankText = "—";
    if (racing) {
      const lead = this.p1.dist >= this.opp.dist;
      rankText = duel ? (lead ? "P1 領先" : "P2 領先") : lead ? "第 1 位" : "第 2 位";
    } else if (this.mode.endless && this.phase === "skating") {
      rankText = `第 ${this.p1.lap} 圈`;
    }
    const nextSide = this.p1.lastSide === "L" ? "右 D▶" : this.p1.lastSide === "R" ? "左 ◀A" : "任一側";
    this.onHudUpdate({
      rankText,
      lapText: this.mode.endless ? `${this.p1.lap}` : `${Math.min(this.p1.lap, this.laps || preset.laps)}/${this.laps === Infinity ? "∞" : (this.laps || preset.laps)}`,
      timeText: `${mins}:${secs}`,
      modeLabel: this.mode.label,
      difficultyLabel: DIFFICULTY_LABELS[this.difficulty],
      phaseLabel: phaseLabels[this.phase] || "",
      message: this.message,
      speed01: clamp(this.p1.speed / preset.maxSpeed, 0, 1),
      speedText: `${(this.p1.speed * 3.6).toFixed(0)} km/h`,
      rhythm01: this.p1.rhythm01,
      nextSide,
      lastResult: this.p1.lastResult,
      inBend: bend,
      leanOk: bend && this.p1.leanHeld,
      stumble: this.p1.stumbleT > 0,
      skating: this.phase === "skating",
      duel,
      race: !!this.mode.race,
      gapText: racing
        ? (this.p1.dist >= this.opp.dist
          ? `領先 ${(this.p1.dist - this.opp.dist).toFixed(0)} m`
          : `落後 ${(this.opp.dist - this.p1.dist).toFixed(0)} m`)
        : "—",
      p2SpeedText: duel ? `${(this.opp.speed * 3.6).toFixed(0)} km/h` : null,
      // 衝刺體力(P1 一律有;P2 只在雙人)
      stamina01: clamp(this.p1.stamina, 0, 1),
      p1Sprinting: this.p1.sprinting,
      p2Stamina01: duel ? clamp(this.opp.stamina, 0, 1) : null,
      p2Sprinting: duel ? this.opp.sprinting : false,
      sprinting: this.p1.sprinting || (duel && this.opp.sprinting), // 速度線用
      overlay: { ...this.overlay },
    });
  }

  // ---------- 存讀檔(記最佳成績,不存賽中進度) ----------
  saveGame(silent = false) {
    const prev = loadSavedGame() || {};
    const snapshot = { difficulty: this.difficulty, modeId: this.modeId, bestTime: prev.bestTime, bestWin: prev.bestWin };
    if (this.phase === "ended" && !this.mode.endless && this.p1.finished) {
      const better = prev.bestTime === undefined || this.p1.finishTime < prev.bestTime;
      if (better) {
        snapshot.bestTime = this.p1.finishTime;
        snapshot.bestWin = true;
      }
    }
    saveGameState(snapshot);
    if (!silent) {
      this.message = "已存檔。";
      this.pushHud();
    }
  }

  loadGame() {
    const snap = loadSavedGame();
    if (!snap) return false;
    if (DIFFICULTY_PRESETS[snap.difficulty]) this.difficulty = snap.difficulty;
    if (GAME_MODES[snap.modeId]) {
      this.modeId = snap.modeId;
      this.mode = getModeConfig(snap.modeId);
    }
    this.openHomeMenu();
    this.message = snap.bestTime !== undefined
      ? `最佳成績:${snap.bestTime.toFixed(1)} 秒衝線——挑戰它!`
      : "尚無最佳成績,先滑一場吧!";
    this.pushHud();
    return true;
  }
}
