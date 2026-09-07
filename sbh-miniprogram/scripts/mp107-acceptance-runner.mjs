import { rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const reportPath = resolve(scriptDirectory, '../../artifacts/verification/MP-107/acceptance-report.json')

// 旧 runner 依赖已删除的页面合同，且未覆盖当前 session/favorites/me 服务端资产链路。
rmSync(reportPath, { force: true })
console.error('LEGACY_ACCEPTANCE_RETIRED: MP-107 旧 runner 已退役，由 MP-109 验收替代；不得作为当前权威证据。')
process.exitCode = 1
