// post-build-size-guard-hook.mjs — push/deploy 前檢查 build 產物大小有沒有「暴增或暴縮」。
// 暴增=不小心把大圖/大檔捆進去(對「零美術檔、可離線」的系列尤其致命,PWA 會叫舊裝置整包重抓);
// 暴縮=build 很可能不完整(Node 24 vite 無聲死的親戚:產物空了還照樣部署)。
// PreToolUse(Bash|PowerShell)用;只在 git push / netlify deploy / wrangler deploy 時檢查。
// 基準檔:repo 根 .build-size.json(第一次自動建立;建議加進 .gitignore,各機各自量)。
// 逃生口:BUILD_SIZE_SKIP=1 跳過;BUILD_SIZE_ACCEPT=1 接受這次大小並更新基準。
// 可調:BUILD_SIZE_DIR=產物資料夾(預設自找 dist/site/build/out)、BUILD_SIZE_MAX_GROWTH(預設 1.5)。
// fail-safe:找不到產物資料夾/不在 repo → 一律放行,絕不憑空擋人。
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ask = (reason) => {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: {
    hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: reason } }))
  process.exit(0)
}

let input = {}
try { input = JSON.parse(readFileSync(0, 'utf8')) } catch { process.exit(0) }
const cmd = String(input?.tool_input?.command || '')
if (!/git\s+push|netlify\s+deploy|wrangler\s+(pages\s+)?deploy/.test(cmd)) process.exit(0)
if (process.env.BUILD_SIZE_SKIP === '1') process.exit(0)

const cwd = process.cwd()
const dir = process.env.BUILD_SIZE_DIR
  || ['dist', 'site', 'build', 'out'].find((d) => existsSync(join(cwd, d)))
if (!dir || !existsSync(join(cwd, dir))) process.exit(0)

let bytes = 0, files = 0
const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) {
  const f = join(d, e.name)
  if (e.isDirectory()) walk(f)
  else { bytes += statSync(f).size; files++ }
} }
try { walk(join(cwd, dir)) } catch { process.exit(0) }
if (files === 0) ask(`⚠ 產物資料夾 ${dir}/ 是空的——build 很可能沒跑或無聲死(這台 Node 24 vite 踩過)。先重 build 確認 ${dir}/index.html 時間戳再部署。`)

const baseFile = join(cwd, '.build-size.json')
const mb = (n) => (n / 1048576).toFixed(2)
let base = null
try { base = JSON.parse(readFileSync(baseFile, 'utf8')) } catch {}

const save = () => { try { writeFileSync(baseFile, JSON.stringify({ dir, bytes, files, updated: new Date().toISOString().slice(0, 10) }) + '\n', 'utf8') } catch {} }

if (!base || base.dir !== dir) { save(); process.exit(0) } // 第一次:記基準、放行
if (process.env.BUILD_SIZE_ACCEPT === '1') { save(); process.exit(0) }

const MAXG = Number(process.env.BUILD_SIZE_MAX_GROWTH || 1.5)
const ratio = base.bytes ? bytes / base.bytes : 1
const delta = Math.abs(bytes - base.bytes)
if (delta > 102400 && (ratio > MAXG || ratio < 0.4)) {
  ask(`⚠ ${dir}/ 產物大小異常:上次 ${mb(base.bytes)}MB(${base.files} 檔,${base.updated})→ 這次 ${mb(bytes)}MB(${files} 檔)。` +
    (ratio > MAXG
      ? `暴增 ${ratio.toFixed(1)}×——是不是捆進了大圖/影音/沒壓的資產?PWA 舊裝置會整包重抓。`
      : `暴縮到 ${(ratio * 100).toFixed(0)}%——build 可能不完整(Node 24 vite 無聲死?)。`) +
    ` 確定沒問題就放行(或 BUILD_SIZE_ACCEPT=1 更新基準)。`)
}
save() // 正常範圍:靜默更新基準、放行
process.exit(0)
