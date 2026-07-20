#!/usr/bin/env node
// pre-scripture-cuv-hook.mjs — push 前偵測「改到經文/題庫檔」就提醒先用 cuv 查驗 + 牧者審。
// 直擊本系列第一鐵則:經文寧可查 cuv 也不憑記憶;寧可說「沒有」也不給孩子錯經文。
// 掛在遊戲 repo 的 .claude/settings.json 的 PreToolUse(Bash);只在偵測到 `git push` 且
// 「已 commit 未推 + 工作區(新檔/暫存/修改)」碰到經文/題庫/內容檔時印提醒。
// 提醒、不硬擋(exit 0):合法的非經文小改不該被擋。零相依、Windows 友善、fail-safe(壞了就放行)。
//
// 命中的檔名樣式(本系列經文/題庫/內容慣例):
//   content.js / scripture.js / *scripture* / quiz* / *quiz* / cards*.js / journey*.json /
//   verses.json / *-設計.md(站點/題庫設計) —— 含路徑任一段命中即算。
//
// 想改成「硬擋」(改了經文沒查過不准 push):把結尾 process.exit(0) 改 process.exit(2)。
// 預設只提醒,因為改文案/排版未必動到經文,硬擋會擾民。和 pre-push-guard(push 前 npm test)、
// pre-deploy-overflow(地圖溢出)互補,三個都可掛 PreToolUse(Bash)。

import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const PATTERNS = [
  /content\.js$/i, /scripture/i, /quiz/i, /cards.*\.js$/i,
  /journey.*\.json$/i, /verses\.json$/i, /設計\.md$/,
]
const hit = (f) => PATTERNS.some((re) => re.test(f))

function readStdin() {
  try { return readFileSync(0, 'utf8') } catch { return '' }
}

function main() {
  let raw = ''
  try { raw = readStdin() } catch {}
  let cmd = ''
  try { cmd = (JSON.parse(raw || '{}').tool_input || {}).command || '' } catch { cmd = raw }
  // 不是 git push 一律安靜放行
  if (!/\bgit\s+push\b/.test(cmd)) return done()

  // 兩條查詢各自獨立、各自 fail-safe:沒 upstream 也要照樣看工作區。
  // a = 已 commit 未推(對 upstream;沒 upstream 就空)、b = 工作區 staged/unstaged/untracked
  const a = run('git diff --name-only @{u}..').split(/\r?\n/).filter(Boolean)
  // -uall:列出未追蹤目錄底下的「個別檔案」(預設會摺疊成 `js/`,漏掉 js/content.js)
  const b = run('git status --porcelain -uall')
    .split(/\r?\n/).map((l) => l.slice(3).replace(/^"|"$/g, '').trim()).filter(Boolean)
  const files = [...new Set([...a, ...b])]
  if (!files.length) return done() // 非 git / 全空 → 放行

  const flagged = files.filter(hit)
  if (flagged.length) {
    console.log('\n📖 經文/題庫把關提醒(push 前)')
    console.log('   這次要推的變更碰到經文/題庫/內容檔:')
    for (const f of flagged.slice(0, 12)) console.log('     · ' + f)
    if (flagged.length > 12) console.log(`     …(共 ${flagged.length} 個)`)
    console.log('   ① 先 /cuv-check(或 cuv-scripture-mcp lookup)逐字核對和合本——寧可說「沒有」也不給孩子錯經文。')
    console.log('   ② red/yellow 題與教導文案:pastor-review 打包送牧者審,審過才上線。')
    console.log('   (提醒、不擋;非經文小改可直接推)\n')
  }
  done()
}

function run(c) {
  try { return execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return '' }
}
function done() { process.exit(0) }

main()
