#!/usr/bin/env node
// pre-deploy-overflow-hook.mjs — 大富翁/有大地圖的 repo 專用 PreToolUse(Bash) hook。
// 只在「偵測到 git push」且「這次改動碰到地圖/棋盤/版面檔」時,提醒先跑 /map-fit-check。
// 直擊本系列最痛、繞了 6 個 PR 還復發的「一載入就整頁變藍」(高地圖在寬視窗溢出視窗)。
//
// 設計:**提醒、不硬擋**(exit 0)——避免合法的小改也被擋住惹人煩;真要硬擋改 exit 2。
// 非 git push 一律安靜放行(fail-safe)。零相依、Windows 友善(不用 jq)。
//
// 接法:貼進「有大地圖的 repo」(hfpc-paul-game / hfpc-ruth-game)的 .claude/settings.json,
//       並把本檔複製到該 repo 的 scripts/。見 references/hooks-片段.md #6。

import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

// 1) 讀 stdin 的工具輸入(Claude Code PreToolUse 會把 JSON 從 stdin 餵進來)
let raw = ''
try { raw = readFileSync(0, 'utf8') } catch {}
let cmd = ''
try { cmd = (JSON.parse(raw || '{}').tool_input || {}).command || '' } catch {}

// 2) 不是 git push 就安靜放行
if (!/\bgit\s+push\b/.test(cmd)) process.exit(0)

// 3) 看這次改了哪些檔(已提交未推 + 工作區),命中地圖/棋盤/版面就提醒
const PAT = /(MapBackground|Board|board|styles|\.css|gen-map|map\.|journey)/i
const q = { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] } // 吞掉 git 的 stderr,保持安靜
const run = (c) => { try { return execSync(c, q) } catch { return '' } }
// 收集這次「會被 push 出去 / 還沒收乾淨」的檔:已 commit 未 push + 工作區所有變動(staged/unstaged/untracked)。
// 非 git repo / 無 upstream 都安靜回空(fail-safe)。
const pushed = run('git diff --name-only @{push}..HEAD')               // 已 commit 但未推
const status = run('git status --porcelain -uall')                      // 工作區:含新檔(逐檔,不收成資料夾)/暫存/修改/改名
const fromStatus = status.split(/\r?\n/).filter(Boolean).map((l) => {
  const p = l.slice(3).trim()                                           // 去掉前 3 欄狀態碼
  return p.includes(' -> ') ? p.split(' -> ')[1] : p                    // 改名取新名
})
const files = [...new Set([...pushed.split(/\r?\n/), ...fromStatus].filter(Boolean))]

const hit = files.filter((f) => PAT.test(f))
if (!hit.length) process.exit(0) // 沒碰地圖/版面,放行

console.log(
  '🗺️ 地圖/版面改動偵測(push 前提醒)\n' +
  '   這次碰到:' + hit.slice(0, 8).join(', ') + (hit.length > 8 ? ' …' : '') + '\n' +
  '   ① 先跑 /map-fit-check —— 量每條旅程在桌機寬視窗會不會溢出變藍(高地圖如彼得/paul2/但以理最會中)。\n' +
  '   ② 整頁變藍先問:有沒有在拖曳?沒拖曳就藍=版面溢出(skill board-fit-letterbox);只有拖曳才藍=GPU(skill gpu-safe-rendering)。\n' +
  '   ③ 別在「大地圖 vs 不溢出」二選一:letterbox 填滿高度=仍大 + 可縮放。'
)
process.exit(0) // 提醒完放行;要硬擋改成 process.exit(2)
