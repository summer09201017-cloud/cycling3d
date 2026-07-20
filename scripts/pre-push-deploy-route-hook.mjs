#!/usr/bin/env node
// pre-push-deploy-route-hook.mjs — push 前提醒「這個 repo 走哪條部署路」。
// 直擊本系列最大、最常重犯的坑:改了、push 了,但 Netlify 沒變(搞錯 A 站 / B 站)。
//   A 站(push 自動上線):paul / jonah / samson / bible-games / ruth / peter-prison …
//   B 站(netlify CLI 手動,且須先 bump sw.js 的 CACHE 版本):peter-sea / paul-silas / psalm150 / war-games …
// 掛在遊戲 repo 的 .claude/settings.json 的 PreToolUse(Bash);只在偵測到 `git push` 時提醒。
// 提醒、不硬擋(exit 0):零相依、Windows 友善、fail-safe(任何錯就安靜放行)。
// 想硬擋(B 站沒 bump sw.js 不准 push)把結尾相應 process.exit(0) 改 process.exit(2)。
//
// 判 A/B:先用 package.json 的 name,再退而求其次用資料夾名,比對下面兩張表。
// 判不出來 → 給「請查 deploy-aware / 直接 /deploy」的中性提醒(絕不亂猜上線方式)。
//
// 和 #6 pre-deploy-overflow(地圖溢出)、#7 pre-scripture-cuv(經文沒查)、pre-push-guard(測試壞)
// 互補;四個都可同掛 PreToolUse(Bash),各司其職。

import { execSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'

// ★ 維護點:新 repo 上線時把它加進對應陣列(B 站尤其重要,漏了就會「改了沒上線」)。
const A_SITES = ['hfpc-paul-game', 'hfpc-jonah-game', 'hfpc-samson-game', 'hfpc-bible-games', 'hfpc-ruth-game', 'hfpc-peter-prison-game']
const B_SITES = ['hfpc-peter-sea-game', 'hfpc-paul-silas-game', 'hfpc-psalm150-game', 'hfpc-war-games']

function repoName() {
  try {
    if (existsSync('package.json')) {
      const n = JSON.parse(readFileSync('package.json', 'utf8')).name
      if (n) return String(n)
    }
  } catch {}
  try { return process.cwd().split(/[\\/]/).filter(Boolean).pop() || '' } catch { return '' }
}

function run(c) {
  try { return execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return '' }
}

function changedFiles() {
  // a = 已 commit 未推(沒 upstream 就空);b = 工作區 staged/unstaged/untracked(-uall 列個別檔)
  const a = run('git diff --name-only @{u}..').split(/\r?\n/).filter(Boolean)
  const b = run('git status --porcelain -uall')
    .split(/\r?\n/).map((l) => l.slice(3).replace(/^"|"$/g, '').trim()).filter(Boolean)
  return [...new Set([...a, ...b])]
}

function main() {
  let raw = ''
  try { raw = readFileSync(0, 'utf8') } catch {}
  let cmd = ''
  try { cmd = (JSON.parse(raw || '{}').tool_input || {}).command || '' } catch { cmd = raw }
  if (!/\bgit\s+push\b/.test(cmd)) return done() // 非 git push 一律安靜放行

  const name = repoName()
  const isA = A_SITES.some((s) => name.includes(s))
  const isB = B_SITES.some((s) => name.includes(s))

  if (isB) {
    const swTouched = changedFiles().some((f) => /(^|\/)sw\.js$/i.test(f))
    console.log('\n🚦 部署路線提醒(push 前)— 這是【B 站:netlify CLI 手動部署】')
    console.log(`   repo:${name}`)
    console.log('   ⚠ git push 「不會」自動上線!上線要三步:')
    console.log('     ① bump sw.js 的 CACHE 版本號 +1(不 bump,舊裝置 cache-first 看不到新版)')
    console.log('     ② npm run build')
    console.log('     ③ netlify deploy --prod --dir site --site <id/name> --no-build(或直接 /deploy)')
    if (!swTouched) console.log('   ❗ 這次變更裡「沒看到 sw.js」——若內容有改,先 bump sw.js 再部署,否則上線了也看不到新版。')
    else console.log('   ✓ 這次有改到 sw.js(很好,記得是「版本號 +1」而非只改內容)。')
    console.log('   細節見 skill deploy-aware /（直接跑）/deploy。(提醒、不擋)\n')
    return done() // 想硬擋(B 站沒改 sw.js 不准 push):把這行改 process.exit(swTouched ? 0 : 2)
  }

  if (isA) {
    console.log('\n🚦 部署路線提醒(push 前)— 這是【A 站:push 自動上線】')
    console.log(`   repo:${name}　push 到 main → Netlify 自動 build 部署,等 1–2 分鐘即可。`)
    console.log('   (不用 netlify CLI;上線後可 /ship-check 驗真內容)\n')
    return done()
  }

  // 判不出來:中性提醒,絕不亂猜
  console.log('\n🚦 部署路線提醒(push 前)')
  console.log(`   認不出這個 repo(${name || '未知'})走 A 還是 B —— 上線前先讀 skill deploy-aware 或直接 /deploy,`)
  console.log('   別假設「push 了就會上線」(本系列最常見的坑)。若是新 repo,記得把它登記進本 hook 的 A_SITES/B_SITES。\n')
  done()
}

function done() { process.exit(0) }
main()
