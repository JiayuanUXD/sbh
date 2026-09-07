import { rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const reportPath = resolve(scriptDirectory, '../../artifacts/verification/MP-106/acceptance-report.json')

// 旧 runner 不具备当前环境身份、源码指纹与必需交互合同；启动即使旧报告失效。
rmSync(reportPath, { force: true })
console.error('LEGACY_ACCEPTANCE_RETIRED: MP-106 旧 runner 已退役，由 MP-109 验收替代；不得作为当前权威证据。')
process.exitCode = 1
