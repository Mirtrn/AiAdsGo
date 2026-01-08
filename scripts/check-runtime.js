/* eslint-disable no-console */

const fs = require('fs')
const path = require('path')
const childProcess = require('child_process')

function fail(message) {
  console.error(`\n❌ ${message}\n`)
  process.exit(1)
}

function info(label, value) {
  console.log(`- ${label}: ${value}`)
}

const nodeVersion = process.versions.node
const nodeMajor = Number(nodeVersion.split('.')[0])
const nodeAbi = process.versions.modules
const nodeArch = process.arch
const platform = process.platform

let machineArch = null
let hardwareArm64 = null
let procTranslated = null
try {
  machineArch = childProcess.execSync('uname -m', { encoding: 'utf8' }).trim()
} catch {
  machineArch = null
}
try {
  hardwareArm64 = childProcess.execSync('sysctl -n hw.optional.arm64', { encoding: 'utf8' }).trim()
} catch {
  hardwareArm64 = null
}
try {
  procTranslated = childProcess.execSync('sysctl -n sysctl.proc_translated', { encoding: 'utf8' }).trim()
} catch {
  procTranslated = null
}

console.log('\n🔎 Runtime check')
info('node', nodeVersion)
info('arch', nodeArch)
if (machineArch) info('machine_arch', machineArch)
if (hardwareArm64) info('hw.optional.arm64', hardwareArm64)
if (procTranslated) info('sysctl.proc_translated', procTranslated)
info('node_abi', nodeAbi)
info('execPath', process.execPath)

if (nodeMajor !== 22) {
  fail(
    `Node.js 版本不匹配（当前 ${nodeVersion}）。请统一使用 Node 22（Homebrew: \`brew link --overwrite --force node@22\`），然后重开终端并执行 \`rm -rf node_modules .next && npm ci\`。`
  )
}

if (platform === 'darwin' && hardwareArm64 === '1' && nodeArch === 'x64') {
  fail(
    '检测到你在 Apple Silicon 上使用了 x86_64（Rosetta）Node，这会导致 better-sqlite3 等原生依赖架构不匹配。请用“非 Rosetta”的终端/Node（arm64）并重新安装依赖：`rm -rf node_modules .next && npm ci`。'
  )
}

try {
  const Database = require('better-sqlite3')
  const db = new Database(':memory:')
  db.exec('SELECT 1;')
  db.close()
  info('better-sqlite3', 'ok')
} catch (err) {
  const message = err && typeof err === 'object' ? String(err.message || err) : String(err)
  console.error(err)

  if (platform === 'darwin' && /incompatible architecture/i.test(message)) {
    const nodeBinDir = path.dirname(process.execPath)
    fail(
      `better-sqlite3 架构不匹配（常见：之前用 x86_64 Node/npm 安装过依赖，现在切到 arm64 Node）。\n` +
      `建议用同一个 Node 重新安装依赖：\n` +
      `  1) export PATH="${nodeBinDir}:$PATH"\n` +
      `  2) rm -rf node_modules .next && npm ci`
    )
  }

  fail('better-sqlite3 原生模块加载失败。请在 Node 22 下执行：`rm -rf node_modules .next && npm ci`。')
}

try {
  const reactIsPath = require.resolve('react-is')
  const exists = fs.existsSync(reactIsPath)
  if (!exists) {
    fail(`依赖解析异常：\`${reactIsPath}\` 不存在。请执行 \`rm -rf node_modules .next && npm ci\`。`)
  }
  info('react-is', path.relative(process.cwd(), reactIsPath))
} catch (err) {
  console.error(err)
  fail('依赖解析异常：react-is 无法解析。请执行 `rm -rf node_modules .next && npm ci`。')
}

console.log('✅ Runtime check passed\n')
