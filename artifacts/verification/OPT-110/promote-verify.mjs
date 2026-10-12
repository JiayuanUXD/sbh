import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const cli = 'C:/Users/Administrator/AppData/Roaming/npm/node_modules/@cloudbase/cli/bin/tcb'
const build = JSON.parse(readFileSync(process.env.RELEASE_MANIFEST ?? 'E:/wt-pub/artifacts/verification/OPT-110/package-manifest.json')).build
const proofDirectory = process.env.RELEASE_PROOF_DIRECTORY ?? 'E:/wt-pub/artifacts/verification/OPT-110'
const rollback = process.env.ROLLBACK_VERSION ?? 'sbh-219'
if (!/^sbh-\d+$/.test(rollback)) throw new Error('Invalid rollback version')
const candidate = process.env.CANDIDATE_VERSION
if (!/^sbh-\d+$/.test(candidate ?? '')) throw new Error('CANDIDATE_VERSION is required')
const sentinel = JSON.parse(readFileSync(new URL('../OPT-037/lib/sentinel.json', import.meta.url)))
function traffic(action) {
  const r = spawnSync(process.execPath, [cli, '-e', 'sbh-d9gnr8h5ef7e22e30', 'cloudrun', 'traffic', action, '-s', 'sbh'], { encoding: 'utf8', input: '\n\n\n', env: { ...process.env, CLOUDBASE_CI: '1' } })
  console.log(r.stdout)
  if (r.status !== 0) throw new Error(r.stderr)
}
traffic('promote')
const pages = []
let currentPath = null
try {
  const health = []
  let consecutive = 0
  for (let i = 0; i < 20; i++) {
    const r = await fetch('https://shangban.cc/api/health', { signal: AbortSignal.timeout(60_000), headers: { Connection: 'close' } })
    const j = await r.json()
    health.push({ status: r.status, ...j })
    console.log({ attempt: i + 1, status: r.status, version: j.version })
    if (r.status !== 200 || j.status !== 'ok') throw new Error('Production health check failed')
    consecutive = j.version === build ? consecutive + 1 : 0
    if (consecutive === 3) break
    await new Promise(resolve => setTimeout(resolve, 5_000))
  }
  if (consecutive !== 3) throw new Error('New build identity did not converge')
  for (const path of ['/', '/shanghai/listings', '/shanghai', '/admin/login', '/shanghai/buildings', '/sitemap.xml']) {
    currentPath = path
    const start = Date.now()
    console.log({ smokeStart: path })
    const r = await fetch('https://shangban.cc' + path, { signal: AbortSignal.timeout(60_000) })
    const record = { path, status: r.status, headersMs: Date.now() - start, firstChunkMs: null, bytes: 0, elapsedMs: null }
    pages.push(record)
    console.log({ path, phase: 'headers', status: r.status, elapsedMs: record.headersMs })
    const chunks = []
    for await (const chunk of r.body) {
      chunks.push(chunk)
      record.bytes += chunk.byteLength
      if (record.firstChunkMs === null) record.firstChunkMs = Date.now() - start
    }
    record.elapsedMs = Date.now() - start
    if (['/', '/shanghai', '/shanghai/listings', '/shanghai/buildings'].includes(path)) {
      const family = sentinel.families.find(family => new RegExp(family.pattern).test(path))
      const html = Buffer.concat(chunks).toString('utf8')
      record.rendered = Boolean(family && family.requiredMarkers.every(marker => html.includes(marker)))
      if (!record.rendered) throw new Error(`Missing rendered page markers: ${path}`)
    }
    console.log(pages.at(-1))
    if (r.status !== 200) throw new Error(`Failed smoke: ${path}`)
  }
  writeFileSync(`${proofDirectory}/promoted-verification.json`, JSON.stringify({ build, health, pages }, null, 2))
  if (pages.some(page => ['/', '/shanghai/listings', '/shanghai/buildings'].includes(page.path)
    && page.elapsedMs >= 10_000)) throw new Error('Cold frontend response exceeded 10 second acceptance threshold')
  console.log({ success: true, build, pages })
} catch (error) {
  console.error('Smoke failure:', error)
  writeFileSync(`${proofDirectory}/smoke-failure.json`, JSON.stringify({ build, currentPath, pages, error: String(error) }, null, 2))
  const r = spawnSync(process.execPath, [cli, 'api', 'tcbr', 'SubmitServerRollback', '--api-version', '2022-02-17', '--json', '--body', JSON.stringify({ EnvId: 'sbh-d9gnr8h5ef7e22e30', ServerName: 'sbh', CurrentVersionName: candidate, RollbackVersionName: rollback, OperatorRemark: 'OPT-110 冒烟失败回滚' })], { encoding: 'utf8', env: { ...process.env, CLOUDBASE_CI: '1' } })
  console.error('Rollback response:', r.stdout, r.stderr)
  throw error
}
