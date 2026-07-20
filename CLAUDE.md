# CLAUDE.md — cycling3d(3D 自行車競速,夏季戶外皮)

> 2026-07-20 建站:fork 自 speedskating3d(換皮:速滑→自行車競速)。核心手感沿用
> 左右交替節奏(蹬冰→踩踏板)+彎道傾身;同機雙人照 duel-2p-kit §7C 競速型。
> 尚未部署;上架時走 CF Pages(/ship-cf,2026-07-19 鐵則:新站一律 Cloudflare)。

## 引擎核心(換皮時別動的)

- 賽道=解析式 stadium:`ovalPoint(dist, laneOffset)`(兩直道 55m+兩個 180° 彎 R22,
  周長 ≈248m),一切以「里程 dist」為域;`inBendAt(dist)` 驅動彎道機制。分道=法線偏移
  (內道 −1.9 / 外道 +1.9)。柏油路面(灰),場心/場外=草地(夏季戶外)。
- 節奏踩踏:`tapPush(racer, side)`——連按同側=踉蹌(×0.8+短暫無力);gap<0.14s=太急;
  否則 `q = 1 - |gap - ideal|/tol`,`applyPush` 收斂到 maxSpeed。左右鍵=左右腳交替踩踏板。
- 彎道:沒傾身 drag 0.5(溫柔減速)、傾身/直道 drag 0.1(騎行慣性=「踩一下衝出去」)。
- racer 結構 P1/P2/AI 統一(duel-2p-kit §7C):AI=節拍器輸入,`_isHuman()` 單閘門;
  solo 時 P2 鍵(方向鍵)別名回 P1,不變死鍵。
- `makeCyclist`:上半身收進 `torso` 樞紐(腰)→ 前傾趴握把姿只轉 torso.rotation.x;
  `helmet:true`=安全帽(否則髮=觀眾);`bike:true`=掛一台自行車(車架/兩輪/握把/坐墊/曲柄踏板),
  回傳 `{frontWheel, rearWheel, crank}` 給動畫轉。自行車掛在 `group`(和車手一起轉向/傾身,
  但不吃 rig 蹲姿 y 位移);車輪 disc.rotation.y=π/2 立起→spin=w.rotation.x(輪軸=X)。
  臉部鐵則(眼耳嘴眉)不動。
- 踩踏動畫 `poseCyclist`:曲柄角=`strideT*2π`;每次有效踩踏 `strideT += 0.5`(半圈動力衝程)
  +update 連續遞增 → 曲柄平順轉、每踩一下有 kick 下壓;雙腿 L/R 差 π 交替(sin/cos 屈伸)。
- 傾身 roll:此參數化下「內側=局部 +x」→ 內傾=**負** rotation.z(placeRacer)。自行車過彎傾身很合理。
- `this.running` 只給 RAF(fork 血緣沿用的撞名事故鐵則——絕不再宣告同名狀態)。
- 內部 phase token 仍叫 `"skating"`(不改字面以免全檔連動;使用者看不到)。
- P1 紅衣、P2 藍衣、AI 綠衣(任務拍板;duel-2p-kit 的 P1 藍在本作讓位給任務規格)。

## 本機地雷

- vite preview 接 `| head` 會被 SIGPIPE 收掉——背景跑不要接管線。
- 貼地面片要 `rotation.order="YXZ"` 先 yaw 再倒平(XYZ 會鋸齒)。
- `.bat` 純 ASCII+CRLF(PowerShell 寫);run.bat 用 port 5220 避撞。
- msedge-tts 這台偶爾一句就死:gen-voice.mjs 逐句落盤,重跑到「新產 0」即完成
  (本次 14 句一次全過)。
- 溝通一律繁體中文。

## 驗證

`npm run build`(檢查 dist/ 有真產物)→ `npx vite preview --port 4173` →
`node scripts/verify-cycling.mjs http://localhost:4173 scripts/shots`
(單人 kids/normal、雙人、練習、彎道傾身,全程 0 pageerror 才綠;本次 10/10 全綠)。

## 部署

尚未部署(主線接手)。beacon 雙平台版已鋪(index.html `window.psPing`,只擋 localhost;
id=cycling3d,-start/-done 帶 t 秒)。sw.js CACHE_NAME=cycling3d-nf1,改版要 bump。
