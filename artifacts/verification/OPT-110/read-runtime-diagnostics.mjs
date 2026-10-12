import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const cli = 'C:/Users/Administrator/AppData/Roaming/npm/node_modules/@cloudbase/cli/bin/tcb'
const version = process.argv[2] ?? '218'
const start = process.argv[3] ?? '2026-10-12 08:14:00'
const end = process.argv[4] ?? '2026-10-12 09:00:00'
const result = spawnSync(process.execPath, [cli, 'api', 'tcbr', 'SearchClsLog', '--api-version', '2022-02-17', '--json', '--body', JSON.stringify({
  EnvId: 'sbh-d9gnr8h5ef7e22e30', StartTime: start, EndTime: end,
  QueryString: `sbh-${version} AND NOT side-dns-cache`, Limit: 100, Sort: 'asc', UseLucene: true,
})], { encoding: 'utf8', env: { ...process.env, CLOUDBASE_CI: '1' } })
if (result.status !== 0) throw new Error(result.stderr)
const data = JSON.parse(result.stdout.slice(result.stdout.indexOf('{'))).data
const logs = (data.LogResults?.Results ?? []).map(row => {
  let content
  try { content = JSON.parse(row.Content) } catch { content = { __CONTENT__: row.Content } }
  const message = String(content.__CONTENT__ ?? '').replace(/postgres[^\s]+/g, '[connection-redacted]').replace(/eyJ[A-Za-z0-9_.-]+/g, '[token-redacted]')
  return { at: row.Timestamp, pod: content.__TAG__?.pod_name, message }
})
writeFileSync(new URL(`./runtime-diagnostics-${version}.json`, import.meta.url), JSON.stringify({ logs, hasMore: Boolean(data.LogResults?.Context) }, null, 2))
console.log(JSON.stringify({ logs, hasMore: Boolean(data.LogResults?.Context) }, null, 2))
