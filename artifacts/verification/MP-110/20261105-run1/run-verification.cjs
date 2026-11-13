// 只汇总当前工作树的静态检查和 Node 测试，历史证据文件由原报告保留。
const path = require('node:path')
const { execFileSync, spawnSync } = require('node:child_process')

const worktreeRoot = path.resolve(__dirname, '../../../..')
const cwd = path.join(worktreeRoot, 'sbh-miniprogram')
const env = { ...process.env, TARGET_ROOT: cwd }

function run(args, json = false) {
  const result = spawnSync(process.execPath, args, {
    cwd, env, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024,
  })
  let verdict = result.status === 0 ? 'PASS' : 'FAIL'
  if (json) {
    try {
      if (JSON.parse(result.stdout).verdict !== 'PASS') verdict = 'FAIL'
    } catch {
      verdict = 'FAIL'
    }
  }
  return {
    verdict,
    exitCode: result.status,
    stdout: result.stdout?.trim(),
    stderr: result.stderr?.trim(),
    error: result.error?.message,
  }
}

const tsc = 'node_modules/typescript/bin/tsc'
const checks = {
  project: run(['scripts/check-project.mjs']),
  typecheck: run([tsc, '--project', 'tsconfig.json', '--pretty', 'false']),
  typecheckNode: run([tsc, '--project', 'tsconfig.node.json', '--pretty', 'false']),
  vitest: run(['node_modules/vitest/vitest.mjs', 'run', '--reporter=dot']),
  buildingDetail: run([path.join(__dirname, 'verify-building-detail.cjs')], true),
  stateActions: run([path.join(__dirname, 'verify-state-actions.cjs')], true),
}
const staticVerdict = Object.values(checks).every(check => check.verdict === 'PASS') ? 'PASS' : 'FAIL'
const overallVerdict = staticVerdict === 'PASS' ? 'INCOMPLETE' : 'FAIL'
console.log(JSON.stringify({
  spec: 'MP-110',
  timestamp: new Date().toISOString(),
  node: process.version,
  baseCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: worktreeRoot, encoding: 'utf8' }).trim(),
  worktreeRoot,
  checks,
  staticVerdict,
  overallVerdict,
  pending: '微信模拟器三档采样、边缘点按、真机和联调证据需独立记录',
}, null, 2))
process.exitCode = overallVerdict === 'FAIL' ? 1 : 2
