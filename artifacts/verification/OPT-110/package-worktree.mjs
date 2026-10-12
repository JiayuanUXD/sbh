import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const root = 'E:/wt-pub'
const prefix = 'payload-office-platform/'
const output = process.env.RELEASE_OUTPUT ?? 'E:/sbh-release-opt110-71a4-v16'
if (existsSync(output)) throw new Error('Output already exists')
const paths = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', prefix], { cwd: root }).toString().split('\0').filter(Boolean)
const files = []
const hash = createHash('sha256')
for (const path of paths.sort()) {
  const source = resolve(root, path)
  if (!existsSync(source)) continue
  const relative = path.slice(prefix.length)
  if ((relative.startsWith('.env') && relative !== '.env.example') || relative.includes('node_modules/') || relative.startsWith('.next/')) throw new Error(`Forbidden source: ${relative}`)
  const bytes = readFileSync(source)
  hash.update(relative).update(bytes)
  files.push({ path: relative, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length })
  const destination = join(output, relative)
  mkdirSync(dirname(destination), { recursive: true })
  copyFileSync(source, destination)
}
const sourceHash = hash.digest('hex')
const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim()
const build = `${base}-worktree-${sourceHash.slice(0, 12)}`
writeFileSync(join(output, 'build-info.json'), JSON.stringify({ commit: build, base, sourceHash }) + '\n')
writeFileSync(process.env.RELEASE_MANIFEST ?? join(root, 'artifacts/verification/OPT-110/package-manifest.json'), JSON.stringify({ output, build, base, sourceHash, files }, null, 2) + '\n')
console.log(JSON.stringify({ output, build, sourceHash, fileCount: files.length }))
