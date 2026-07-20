// idle-life.js — 3D 人物「idle 生動」drop-in 輔助(零相依 ES module)
// ---------------------------------------------------------------------------
// 用途:讓靜止/比賽中的 3D 人物不死板——主角偶爾平滑轉頭看一下+咧嘴微笑;
//       觀眾舉手歡呼+左右看,相位錯開成「人浪」。純吃 time(不用 Math.random,
//       故決定性、可重播),只讀寫既有物件的 rotation/scale/position。
//
// THREE 由呼叫端自己建幾何(本檔不 import three,也不需要)——這幾支函式只操作
// 呼叫端傳進來的既有 Object3D/Mesh(headGroup.rotation.y、smile.scale、
// arm.pivot.rotation…),所以任何 three 版本都能用。
//
// ★整合者要自己做的一件事:把「頭+臉」群組成一個 headGroup(樞紐=頭中心),
//   這樣轉頭時整顆頭連臉一起轉(而不是只轉頭球、五官不跟)。因遊戲的人物工廠
//   而異,故不代勞。最小範例(座標僅示意,照你的人物尺寸調):
//
//     const headGroup = new THREE.Group();
//     headGroup.position.set(0, HEAD_CENTER_Y, 0); // 樞紐放在頭中心
//     torso.add(headGroup);                          // 掛在會前傾的軀幹樞紐上
//     const H = (y) => y - HEAD_CENTER_Y;            // 原立姿 y → headGroup 局部
//     head.position.y  = H(HEAD_CENTER_Y);           // 頭球
//     eyeL.position.y  = H(EYE_Y);   eyeR.position.y = H(EYE_Y);   // 眼(含瞳)
//     browL.position.y = H(BROW_Y);  browR.position.y = H(BROW_Y); // 眉
//     smile.position.y = H(MOUTH_Y);                 // 嘴(idle 會放大它)
//     earL/earR/hairCap/hairBack …                   // 耳、髮/帽後緣一併收進 headGroup
//     headGroup.add(head, eyeL, eyeR, pupilL, pupilR, browL, browR, smile, earL, earR, hairCap, hairBack);
//   ——H(y)+HEAD_CENTER_Y = y,所以群組化前後視覺位置逐一相同(不會位移)。
//   髮/帽後緣的 phi 用下方 EAR_SAFE_PHI(耳前無髮鐵律)。
// ---------------------------------------------------------------------------

// 耳前無髮鐵律:髮片/帽後緣的 SphereGeometry 只覆蓋「耳後」半球——
// phiStart=1.06π、phiLength=(1.94−1.06)π=0.88π,兩側前緣一律留在耳朵之後(z<0),
// 露出臉頰與耳前緣。用法:new THREE.SphereGeometry(r, w, h, EAR_SAFE_PHI.start, EAR_SAFE_PHI.end - EAR_SAFE_PHI.start, thetaStart, thetaLength)
export const EAR_SAFE_PHI = { start: 1.06 * Math.PI, end: 1.94 * Math.PI };

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
// smoothstep 梯形:t 在 [0,hold] 內用 ramp 秒緩起、中段停留=1、ramp 秒緩收 → 0,其餘為 0
function trapezoid(t, hold, ramp) {
  if (t < 0 || t >= hold) return 0;
  const r = Math.min(ramp, hold / 2); // hold 很短時不讓 rise/fall 重疊
  let raw = 1;
  if (t < r) raw = t / r;
  else if (t > hold - r) raw = (hold - t) / r;
  raw = clamp01(raw);
  return raw * raw * (3 - 2 * raw); // smoothstep
}

// animateIdleHead:每幀呼叫。讓整顆頭(headGroup)每隔 period 秒,平滑往一側「看一下」
//   (rotation.y → yaw)+ 嘴角笑弧短暫放大(smileMesh.scale → smile),再平滑回正。
//   平滑靠 lerp(絕不瞬跳);各角色傳不同 phase/period 就會錯開、不整齊劃一。
//   headGroup / smileMesh 缺任一都安全略過。
//   opts:phase 相位偏移(秒,各角色錯開)、period 週期(秒)、hold 看的視窗長度(秒,
//         含緩起緩收)、yaw 轉頭幅度(rad,可大如 0.6)、smile 微笑放大倍率(如 1.4)。
export function animateIdleHead(headGroup, smileMesh, time, opts = {}) {
  if (!headGroup) return;
  const { phase = 0, period = 5.6, hold = 1.6, yaw = 0.6, smile = 1.4 } = opts;
  const t = ((time + phase) % period + period) % period; // 保險:負 time 也落在 [0,period)
  const k = trapezoid(t, hold, 0.3);
  const targetYaw = yaw * k;
  headGroup.rotation.y += (targetYaw - headGroup.rotation.y) * 0.15; // lerp 回正,不瞬跳
  if (smileMesh) {
    const targetS = 1 + (smile - 1) * k;
    smileMesh.scale.x += (targetS - smileMesh.scale.x) * 0.15;
    smileMesh.scale.y += (targetS - smileMesh.scale.y) * 0.15;
  }
}

// animateCrowdCheer:每幀呼叫。驅動一整排觀眾:雙臂由放下(armDown)→高舉過頭(armUp)
//   循環歡呼、頭左右緩擺看比賽(headSwing)、隨歡呼微微踮起(hopUp);各人用自己的
//   phase 錯開 → 此起彼落的人浪(不整齊劃一)。只改 rotation/position,不建新幾何。
//   crowdFigs:[{ fig, phase, rigY }] —— fig=人偶(需有 headGroup / leftArm / rightArm / rig,
//     缺哪個就略過哪段);phase=相位偏移;rigY=該人偶 rig 的基準 y(踮起以它為基準疊加)。
//   opts:armDown/armUp 手臂放下/高舉的 pivot.rotation.x(rad,越負舉越高)、
//         headSwing 頭左右擺幅(rad)、hopUp 踮起最大位移(m)。
export function animateCrowdCheer(crowdFigs, time, opts = {}) {
  if (!crowdFigs) return;
  const { armDown = -0.5, armUp = -2.9, headSwing = 0.42, hopUp = 0.06 } = opts;
  const span = armDown - armUp; // 手臂擺動幅度(armDown 較大、armUp 較負)
  for (const c of crowdFigs) {
    const f = c && c.fig;
    if (!f) continue;
    const ph = c.phase || 0;
    if (f.headGroup) f.headGroup.rotation.y = Math.sin(time * 0.9 + ph) * headSwing; // 慢頻:左右看
    const raise = Math.sin(time * 2.4 + ph) * 0.5 + 0.5; // 0(放下)→1(高舉),快頻
    const lift = armDown - raise * span; // armDown → armUp
    if (f.leftArm) { f.leftArm.pivot.rotation.x = lift; f.leftArm.pivot.rotation.z = 0.22; f.leftArm.joint.rotation.x = -0.12; }
    if (f.rightArm) { f.rightArm.pivot.rotation.x = lift; f.rightArm.pivot.rotation.z = -0.22; f.rightArm.joint.rotation.x = -0.12; }
    if (f.rig) f.rig.position.y = (c.rigY || 0) + raise * hopUp; // 舉高時微微踮起
  }
}
