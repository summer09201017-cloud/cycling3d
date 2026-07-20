#!/usr/bin/env node
// pre-push-cuv-gate-hook.mjs — push 前「經文存在性」硬閘(★★★★★)。
// 直擊本系列第一鐵則:寧可說「沒有」也不給孩子錯經文。比 pre-scripture-cuv(只提醒)更強:
// 這支會「真的查」——抽出這次要推的經文 ref,逐節對本機 CUV 資料驗「這一節到底存不存在」,
// 查無此節 / 章節越界(最傷、老師會教錯出處)就 **exit 2 擋下 push**。
//
// 設計鐵則(務必守):
//  · 只擋「確定查得出是錯的」(ref 在資料集裡查無)。引文字面對不對(打錯字)不在這支管轄——
//    那要 /cuv-check（AI 逐字比對）或 pastor-review；本閘只做「確定性、零誤判」的存在性檢查。
//  · fail-safe:沒接 CUV 資料(CUV_DATA_DIR 沒設或讀不到)→ 退化成「提醒、放行(exit 0)」,絕不憑空擋人。
//  · 只在偵測到 `git push` 時動作;非 push 一律安靜放行。零相依、Windows 友善。
//
// 掛法(遊戲 repo 的 .claude/settings.json,PreToolUse→Bash;見 hooks-片段.md #9):
//   { "hooks": { "PreToolUse": [ { "matcher": "Bash", "hooks": [
//     { "type": "command", "command": "node scripts/pre-push-cuv-gate-hook.mjs" } ] } ] } }
// 並設環境變數 CUV_DATA_DIR 指向本機和合本資料夾(同 cuv MCP 那份,見 skill cuv-scripture-mcp)。
//   想「只提醒不硬擋」:設 CUV_GATE_SOFT=1(查無此節只印警告、exit 0)。
//   測試:設 CUV_GATE_FILES="a.js,b.js" 直接指定要掃的檔(略過 git),方便單元驗證。

import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

// ── 命中「經文/題庫/內容檔」的樣式(與 pre-scripture-cuv 一致) ──
const FILE_PATTERNS = [
  /content\.js$/i, /scripture/i, /quiz/i, /cards.*\.js$/i,
  /journey.*\.json$/i, /verse.*\.js(on)?$/i, /設計\.md$/, /specs?\.js$/i, /scenes\.js$/i,
]
const fileHit = (f) => FILE_PATTERNS.some((re) => re.test(f))

// ── 66 卷:全名 → 書號(與 unv.json 等資料檔的數字鍵一致) ──
const BOOKNO = {
  創世記: 1, 出埃及記: 2, 利未記: 3, 民數記: 4, 申命記: 5, 約書亞記: 6, 士師記: 7, 路得記: 8,
  撒母耳記上: 9, 撒母耳記下: 10, 列王紀上: 11, 列王紀下: 12, 歷代志上: 13, 歷代志下: 14,
  以斯拉記: 15, 尼希米記: 16, 以斯帖記: 17, 約伯記: 18, 詩篇: 19, 箴言: 20, 傳道書: 21, 雅歌: 22,
  以賽亞書: 23, 耶利米書: 24, 耶利米哀歌: 25, 以西結書: 26, 但以理書: 27, 何西阿書: 28, 約珥書: 29,
  阿摩司書: 30, 俄巴底亞書: 31, 約拿書: 32, 彌迦書: 33, 那鴻書: 34, 哈巴谷書: 35, 西番雅書: 36,
  哈該書: 37, 撒迦利亞書: 38, 瑪拉基書: 39, 馬太福音: 40, 馬可福音: 41, 路加福音: 42, 約翰福音: 43,
  使徒行傳: 44, 羅馬書: 45, 哥林多前書: 46, 哥林多後書: 47, 加拉太書: 48, 以弗所書: 49, 腓立比書: 50,
  歌羅西書: 51, 帖撒羅尼迦前書: 52, 帖撒羅尼迦後書: 53, 提摩太前書: 54, 提摩太後書: 55, 提多書: 56,
  腓利門書: 57, 希伯來書: 58, 雅各書: 59, 彼得前書: 60, 彼得後書: 61, 約翰一書: 62, 約翰二書: 63,
  約翰三書: 64, 猶大書: 65, 啟示錄: 66,
}
// ── 簡稱別名(與 cuv-mcp server 同一份;讓「王上 19:4」「路5:1」「約一2:1」都認得) ──
const ALIAS = {
  創: '創世記', 出: '出埃及記', 利: '利未記', 民: '民數記', 申: '申命記', 書: '約書亞記', 士: '士師記', 得: '路得記',
  撒上: '撒母耳記上', 撒下: '撒母耳記下', 王上: '列王紀上', 王下: '列王紀下', 代上: '歷代志上', 代下: '歷代志下',
  拉: '以斯拉記', 尼: '尼希米記', 斯: '以斯帖記', 伯: '約伯記', 詩: '詩篇', 箴: '箴言', 傳: '傳道書', 歌: '雅歌',
  賽: '以賽亞書', 耶: '耶利米書', 哀: '耶利米哀歌', 結: '以西結書', 但: '但以理書', 何: '何西阿書', 珥: '約珥書',
  摩: '阿摩司書', 俄: '俄巴底亞書', 拿: '約拿書', 彌: '彌迦書', 鴻: '那鴻書', 哈: '哈巴谷書', 番: '西番雅書',
  該: '哈該書', 亞: '撒迦利亞書', 瑪: '瑪拉基書', 太: '馬太福音', 可: '馬可福音', 路: '路加福音', 約: '約翰福音',
  徒: '使徒行傳', 羅: '羅馬書', 林前: '哥林多前書', 林後: '哥林多後書', 加: '加拉太書', 弗: '以弗所書', 腓: '腓立比書',
  西: '歌羅西書', 帖前: '帖撒羅尼迦前書', 帖後: '帖撒羅尼迦後書', 提前: '提摩太前書', 提後: '提摩太後書', 多: '提多書',
  門: '腓利門書', 來: '希伯來書', 雅: '雅各書', 彼前: '彼得前書', 彼後: '彼得後書', 約一: '約翰一書', 約二: '約翰二書',
  約三: '約翰三書', 猶: '猶大書', 啟: '啟示錄',
}
// 別名要先試長的(林前 before 林、撒上 before 撒、約一 before 約),否則「林前」會被「林」搶走
const BOOK_TOKENS = [...Object.keys(BOOKNO), ...Object.keys(ALIAS)].sort((a, b) => b.length - a.length)
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// ref 樣式 (a) 字串:<書名/簡稱>[空白]<章>:<節>[-<迄節>]  (章節用半形或全形冒號都接)
const REF_RE = new RegExp(`(${BOOK_TOKENS.map(reEsc).join('|')})\\s{0,2}(\\d{1,3})\\s*[:：]\\s*(\\d{1,3})(?:\\s*[-—~]\\s*(\\d{1,3}))?`, 'g')
// ref 樣式 (b) 物件:{ book:'羅馬書', chapter:5, verse:8 }(欄位順序固定 book→chapter→verse,間隔有界以免跨物件誤連)
const OBJ_RE = /book\s*:\s*['"]([^'"]{1,8})['"][^}]{0,80}?chapter\s*:\s*(\d{1,3})[^}]{0,40}?verse\s*:\s*(\d{1,3})/g

function resolveBookNo(token) {
  const name = ALIAS[token] || token
  return BOOKNO[name] ? { no: BOOKNO[name], name } : null
}

// ── 載入本機 CUV 資料(預設版本 unv);讀不到回 null → fail-safe ──
function loadDataset() {
  const dir = process.env.CUV_DATA_DIR
  const single = process.env.CUV_DATA_PATH
  const ver = process.env.CUV_DEFAULT_VERSION || 'unv'
  try {
    if (dir) {
      const abs = path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir)
      return JSON.parse(fs.readFileSync(path.join(abs, ver + '.json'), 'utf8'))
    }
    if (single) {
      const abs = path.isAbsolute(single) ? single : path.join(process.cwd(), single)
      return JSON.parse(fs.readFileSync(abs, 'utf8'))
    }
  } catch { return null }
  return null
}

// 這一節在資料集裡存不存在?(相容數字書號鍵與名稱鍵兩種格式)
function verseExists(data, bookNo, bookName, chapter, verse) {
  const bk = data[String(bookNo)] || data[bookName]
  if (!bk) return false
  const chap = bk[String(chapter)]
  if (!chap) return false
  return chap[String(verse)] != null
}

// ── 收集這次要推的檔案 ──
function changedFiles() {
  if (process.env.CUV_GATE_FILES) return process.env.CUV_GATE_FILES.split(',').map((s) => s.trim()).filter(Boolean)
  const run = (c) => { try { return execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return '' } }
  const a = run('git diff --name-only @{u}..').split(/\r?\n/).filter(Boolean)
  const b = run('git status --porcelain -uall').split(/\r?\n/).map((l) => l.slice(3).replace(/^"|"$/g, '').trim()).filter(Boolean)
  return [...new Set([...a, ...b])]
}

function readStdin() { try { return fs.readFileSync(0, 'utf8') } catch { return '' } }
const done = (code = 0) => process.exit(code)

function main() {
  // CUV_GATE_FILES(測試用)直接指定要掃的檔,略過 stdin / git;否則才讀 stdin 判斷是不是 git push。
  if (!process.env.CUV_GATE_FILES) {
    let cmd = ''
    try { cmd = (JSON.parse(readStdin() || '{}').tool_input || {}).command || '' } catch {}
    if (!/\bgit\s+push\b/.test(cmd)) return done(0) // 非 push 安靜放行
  }

  const files = changedFiles().filter(fileHit)
  if (!files.length) return done(0)

  // 抽出所有 ref(去重),記下來自哪個檔
  const refs = new Map() // key: name|chap:verse → {token,name,chap,verse,files:Set}
  for (const f of files) {
    let txt = ''
    try { txt = fs.readFileSync(f, 'utf8') } catch { continue }
    const add = (token, chap, v0, v1) => {
      const b = resolveBookNo(token)
      if (!b) return
      for (let v = v0; v <= v1 && v - v0 < 50; v++) {
        const key = `${b.name} ${chap}:${v}`
        if (!refs.has(key)) refs.set(key, { ...b, chap, verse: v, files: new Set() })
        refs.get(key).files.add(f)
      }
    }
    for (const m of txt.matchAll(REF_RE)) add(m[1], +m[2], +m[3], m[4] ? +m[4] : +m[3])
    for (const m of txt.matchAll(OBJ_RE)) add(m[1], +m[2], +m[3], +m[3])
  }
  if (!refs.size) return done(0) // 經文檔但沒抓到 ref → 放行(交給 pre-scripture-cuv 提醒)

  const data = loadDataset()
  if (!data) {
    // fail-safe:沒資料就退化成提醒(別憑空擋)
    console.log('\n📖 經文把關(push 前)— 偵測到 ' + refs.size + ' 處經文引用,但本機未接 CUV 資料,無法自動驗存在性。')
    console.log('   先 /cuv-check 或接好 cuv-scripture-mcp(設 CUV_DATA_DIR)再推。寧可說「沒有」也不給孩子錯經文。\n')
    return done(0)
  }

  const missing = []
  for (const [key, r] of refs) {
    if (!verseExists(data, r.no, r.name, r.chap, r.verse)) missing.push({ key, files: [...r.files] })
  }

  if (!missing.length) {
    console.log(`📖 經文把關:本次 ${refs.size} 處經文 ref 在和合本資料集都查得到(存在性 OK)。引文字面對不對仍建議 /cuv-check。`)
    return done(0)
  }

  const soft = process.env.CUV_GATE_SOFT === '1'
  console.log('\n🔴 經文把關' + (soft ? '(警告)' : '【擋下 push】') + ' — 下列 ref 在和合本資料集查無此節(章節標錯或不存在):')
  for (const m of missing.slice(0, 20)) console.log(`   · ${m.key}   ←  ${m.files.join(', ')}`)
  if (missing.length > 20) console.log(`   …(共 ${missing.length} 處)`)
  console.log('   老師會照著教錯出處。請改正章節,或用 /cuv-check 逐處確認;查不到就說「沒有」,別臆造。')
  if (soft) { console.log('   (CUV_GATE_SOFT=1:僅警告、放行)\n'); return done(0) }
  console.log('   (要暫時放行:本次改用一般 shell 推,或設 CUV_GATE_SOFT=1)\n')
  return done(2)
}

try { main() } catch (e) { process.stderr.write('[cuv-gate] ' + e.message + '\n'); done(0) /* 壞了也放行 */ }
