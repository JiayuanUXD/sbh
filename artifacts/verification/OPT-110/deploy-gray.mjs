import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const env = 'sbh-d9gnr8h5ef7e22e30'
const server = 'sbh'
const cli = 'C:/Users/Administrator/AppData/Roaming/npm/node_modules/@cloudbase/cli/bin/tcb'
function api(service, action, version, body) {
  const result = spawnSync(process.execPath, [cli, 'api', service, action, '--api-version', version, '--json', '--body', JSON.stringify(body)], { encoding: 'utf8', env: { ...process.env, CLOUDBASE_CI: '1' } })
  if (result.status !== 0) throw new Error(`${action}: ${result.stderr}`)
  const json = JSON.parse(result.stdout.slice(result.stdout.indexOf('{')))
  if (json.error) throw new Error(`${action}: ${JSON.stringify(json.error)}`)
  return json.data
}
const bytes = readFileSync(process.env.RELEASE_ZIP ?? 'E:/sbh-release-opt110-71a4-v16.zip')
let info
for (let attempt = 1; attempt <= 5; attempt++) {
  info = api('tcb', 'DescribeCloudBaseBuildService', '2018-06-08', { EnvId: env, ServiceName: server })
  const response = await fetch(info.UploadUrl, { method: 'PUT', body: bytes, headers: Object.fromEntries((info.UploadHeaders ?? []).map(x => [x.Key, x.Value])), signal: AbortSignal.timeout(200_000) })
  console.log(JSON.stringify({ attempt, uploadedBytes: bytes.length, status: response.status }))
  if (response.status === 200) break
  console.log(await response.text())
  if (attempt === 5) throw new Error('Package upload failed')
}
const task = api('tcbr', 'UpdateCloudRunServer', '2022-02-17', {
  EnvId: env, ServerName: server,
  DeployInfo: { DeployType: 'package', PackageName: info.PackageName, PackageVersion: info.PackageVersion, ReleaseType: 'GRAY' },
  Items: [{ Key: 'AccessTypes', ArrayValue: ['OA', 'PUBLIC', 'MINIAPP'] }, { Key: 'Port', IntValue: 80 }],
})
writeFileSync(process.env.RELEASE_TASK ?? 'E:/wt-pub/artifacts/verification/OPT-110/deploy-task.json', JSON.stringify({ env, server, task, packageName: info.PackageName, packageVersion: info.PackageVersion }, null, 2) + '\n')
console.log(JSON.stringify({ task }))
