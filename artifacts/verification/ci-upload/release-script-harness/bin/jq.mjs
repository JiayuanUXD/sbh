// 只认 cloudrun-release.sh 上传路径用到的三种 jq 调用；其它一律报错，免得假装成功
import fs from 'node:fs'
const args = process.argv.slice(2)
const named = {}
const flags = []
let filter = null
let file = null
for (let i = 0; i < args.length; ) {
  const a = args[i]
  if (a === '--arg') { named[args[i + 1]] = args[i + 2]; i += 3; continue }
  if (a.startsWith('-')) { flags.push(a); i++; continue }
  if (filter === null) filter = a; else file = a
  i++
}
const nullInput = flags.some((f) => /n/.test(f.replace(/^-+/, '')))
const raw = file ? fs.readFileSync(file, 'utf8') : nullInput ? '' : fs.readFileSync(0, 'utf8')
let out
switch (filter) {
  case '.data.UploadUrl':
    out = JSON.parse(raw).data.UploadUrl
    break
  case '.data.UploadHeaders[]? | [.Key,.Value] | @tsv':
    out = (JSON.parse(raw).data.UploadHeaders || []).map((h) => `${h.Key}\t${h.Value}`).join('\n')
    break
  case '{EnvId:$envId,ServiceName:$svc}':
    out = JSON.stringify({ EnvId: named.envId, ServiceName: named.svc })
    break
  default:
    console.error(`jq shim: unsupported filter ${JSON.stringify(filter)}`)
    process.exit(2)
}
process.stdout.write(out + '\n')
