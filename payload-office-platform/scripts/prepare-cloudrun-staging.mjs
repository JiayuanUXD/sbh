import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { isIP } from 'node:net'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const PRODUCTION_CLOUDRUN_ORIGIN =
  'https://sbh-286300-10-1253925058.sh.run.tcloudbase.com'
export const PRODUCTION_ENV_ID = 'sbh-d9gnr8h5ef7e22e30'
export const STAGING_RUNTIME_ENV_ID = 'sbhmini-gateway-d3fbrmn8097478b8'
export const STAGING_DATABASE_ENV_ID = 'sbhmini-d5g7d6732b2c64a66'

const ENV_ID_PATTERN = /^[a-z][a-z0-9-]{5,63}$/
const PRODUCTION_CLOUDRUN_HOSTNAME = normalizeHostname(
  new URL(PRODUCTION_CLOUDRUN_ORIGIN).hostname,
)

function normalizeHostname(hostname) {
  return hostname.toLowerCase().replace(/\.+$/, '')
}

function isLocalOrIpHostname(hostname) {
  const normalized = normalizeHostname(hostname)
  const unbracketed =
    normalized.startsWith('[') && normalized.endsWith(']')
      ? normalized.slice(1, -1)
      : normalized
  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    isIP(unbracketed) !== 0
  )
}

export function validateStagingOrigin(rawOrigin) {
  if (typeof rawOrigin !== 'string' || rawOrigin.trim() !== rawOrigin || rawOrigin === '') {
    throw new Error('staging origin 必须是非空且无首尾空格的字符串')
  }

  let parsed
  try {
    parsed = new URL(rawOrigin)
  } catch {
    throw new Error('staging origin 不是合法 URL')
  }

  if (normalizeHostname(parsed.hostname) === PRODUCTION_CLOUDRUN_HOSTNAME) {
    throw new Error('staging origin 不得指向生产 CloudRun')
  }
  if (parsed.protocol !== 'https:') throw new Error('staging origin 必须使用 HTTPS')
  if (parsed.username || parsed.password) throw new Error('staging origin 不得包含凭据')
  if (rawOrigin !== parsed.origin) throw new Error('staging origin 不得包含路径、查询或片段')
  if (isLocalOrIpHostname(parsed.hostname)) {
    throw new Error('staging origin 不得使用 localhost 或 IP 地址')
  }
  return parsed.origin
}

export function rewriteDockerfileForStaging(source, rawOrigin) {
  const stagingOrigin = validateStagingOrigin(rawOrigin)
  const occurrenceCount = source.split(PRODUCTION_CLOUDRUN_ORIGIN).length - 1

  if (occurrenceCount !== 2) {
    throw new Error(`生产 origin 必须在 Dockerfile 中恰好出现 2 次，实际为 ${occurrenceCount} 次`)
  }

  return source.replaceAll(PRODUCTION_CLOUDRUN_ORIGIN, stagingOrigin)
}

export function validateStagingEnvId(rawEnvId) {
  if (typeof rawEnvId !== 'string' || !ENV_ID_PATTERN.test(rawEnvId)) {
    throw new Error('staging 环境 ID 格式不合法')
  }
  if (rawEnvId !== STAGING_RUNTIME_ENV_ID) {
    if (rawEnvId === PRODUCTION_ENV_ID) throw new Error('staging 环境 ID 不得指向生产环境')
    if (rawEnvId === STAGING_DATABASE_ENV_ID) {
      throw new Error('staging 运行层不得指向 PostgreSQL 数据库环境')
    }
    throw new Error('staging 环境 ID 与受控运行环境不一致')
  }
  return rawEnvId
}

export function prepareStagingPackage({
  repositoryRoot,
  outputDirectory,
  stagingEnvId,
  stagingOrigin,
}) {
  const root = resolve(repositoryRoot)
  const output = resolve(outputDirectory)
  const validatedEnvId = validateStagingEnvId(stagingEnvId)
  const validatedOrigin = validateStagingOrigin(stagingOrigin)
  const outputRelativeToRepository = relative(root, output)

  if (!isAbsolute(outputDirectory)) throw new Error('输出目录必须使用绝对路径')
  if (!outputRelativeToRepository.startsWith('..')) {
    throw new Error('staging 部署包不得写入仓库目录')
  }

  const actualRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: root,
    encoding: 'utf8',
  }).trim()
  if (resolve(actualRoot) !== root) throw new Error('repositoryRoot 不是当前 Git 仓库根目录')

  const commitSha = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim()
  if (!/^[0-9a-f]{40}$/.test(commitSha)) throw new Error('无法取得完整 Git commit SHA')

  mkdirSync(output)
  const archivePath = join(output, '.source.tar')
  execFileSync(
    'git',
    ['archive', '--format=tar', `--output=${archivePath}`, `${commitSha}:payload-office-platform`],
    { cwd: root },
  )
  execFileSync('tar', ['-xf', archivePath, '-C', output], { cwd: root })
  unlinkSync(archivePath)

  const dockerfilePath = join(output, 'Dockerfile')
  const dockerfile = readFileSync(dockerfilePath, 'utf8')
  writeFileSync(
    dockerfilePath,
    rewriteDockerfileForStaging(dockerfile, validatedOrigin),
    'utf8',
  )
  writeFileSync(join(output, 'build-info.json'), `${JSON.stringify({ commit: commitSha })}\n`, 'utf8')

  return {
    commitSha,
    outputDirectory: output,
    stagingEnvId: validatedEnvId,
    stagingOrigin: validatedOrigin,
  }
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url

if (isMain) {
  const args = new Map()
  for (let index = 2; index < process.argv.length; index += 2) {
    args.set(process.argv[index], process.argv[index + 1])
  }

  const stagingEnvId = args.get('--env-id')
  const stagingOrigin = args.get('--origin')
  if (!stagingEnvId || !stagingOrigin) {
    throw new Error('用法：node scripts/prepare-cloudrun-staging.mjs --env-id <staging-env-id> --origin <https-origin>')
  }

  const repositoryRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))
  const branch = execFileSync('git', ['branch', '--show-current'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  }).trim()
  if (!branch || branch === 'master') throw new Error('只能从非 master 的具名功能分支准备 staging 包')

  execFileSync('git', ['diff', '--quiet'], { cwd: repositoryRoot })
  execFileSync('git', ['diff', '--cached', '--quiet'], { cwd: repositoryRoot })

  const outputDirectory = join(tmpdir(), `sbh-cloudrun-staging-${crypto.randomUUID()}`)
  const result = prepareStagingPackage({
    repositoryRoot,
    outputDirectory,
    stagingEnvId,
    stagingOrigin,
  })
  process.stdout.write(`${JSON.stringify(result)}\n`)
}
