 import { execFileSync } from 'node:child_process'
import {
  accessSync,
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { STAGING_RUNTIME_ENV_ID, STAGING_RUNTIME_SERVICE_NAME } from './trial-origin.mjs'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDirectory, '..')
const manifestRelativePath = 'miniprogram/config/trial-deployment.generated.ts'
const shaPattern = /^[0-9a-f]{40}$/
const revisionPattern = /^[A-Za-z0-9._-]{1,128}$/

class UploadConfigurationError extends Error {}

function isPathInsideRepository(candidatePath) {
  const candidateRelativePath = relative(projectRoot, candidatePath)
  return (
    candidateRelativePath === '' ||
    (candidateRelativePath !== '..' &&
      !candidateRelativePath.startsWith(`..${sep}`) &&
      !isAbsolute(candidateRelativePath))
  )
}

function required(environment, name) {
  const value = environment[name]
  if (typeof value !== 'string' || value.length === 0) {
    throw new UploadConfigurationError(`缺少 ${name}`)
  }
  return value
}

function requireNoFollowFlag() {
  if (!Number.isInteger(constants.O_NOFOLLOW)) {
    throw new UploadConfigurationError('当前平台不支持 O_NOFOLLOW，拒绝读取微信 CI 私钥')
  }
  return constants.O_NOFOLLOW
}

function assertStrictSemVer(version) {
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(
      version,
    )

  if (!match || version.length > 64) {
    throw new UploadConfigurationError('WECHAT_MINIPROGRAM_VERSION 必须是严格 SemVer')
  }

  const prerelease = match[4]
  if (
    prerelease?.split('.').some(
      (identifier) => /^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith('0'),
    )
  ) {
    throw new UploadConfigurationError('WECHAT_MINIPROGRAM_VERSION 必须是严格 SemVer')
  }
}

function readPrivateKeyStats(privateKeyPath) {
  let privateKeyStats
  try {
    privateKeyStats = lstatSync(privateKeyPath, { bigint: true })
  } catch {
    throw new UploadConfigurationError('微信 CI 私钥文件不存在或不可用')
  }

  if (privateKeyStats.isSymbolicLink()) {
    throw new UploadConfigurationError('微信 CI 私钥不接受符号链接')
  }
  if (!privateKeyStats.isFile()) {
    throw new UploadConfigurationError('微信 CI 私钥必须是普通文件')
  }
  if ((privateKeyStats.mode & 0o177n) !== 0n || (privateKeyStats.mode & 0o400n) === 0n) {
    throw new UploadConfigurationError('微信 CI 私钥权限必须仅所有者可读写（0400 或 0600）')
  }

  return { dev: privateKeyStats.dev, ino: privateKeyStats.ino }
}

function readPrivateKeyFromOwnedDescriptor(privateKeyPath, expectedIdentity) {
  const noFollow = requireNoFollowFlag()
  let descriptor
  let primaryError = null

  try {
    descriptor = openSync(privateKeyPath, constants.O_RDONLY | noFollow)
    const descriptorStats = fstatSync(descriptor, { bigint: true })
    if (!descriptorStats.isFile()) {
      throw new UploadConfigurationError('微信 CI 私钥必须是普通文件')
    }
    if ((descriptorStats.mode & 0o177n) !== 0n || (descriptorStats.mode & 0o400n) === 0n) {
      throw new UploadConfigurationError('微信 CI 私钥权限必须仅所有者可读写（0400 或 0600）')
    }

    const pathStats = lstatSync(privateKeyPath, { bigint: true })
    if (
      pathStats.isSymbolicLink() ||
      pathStats.dev !== descriptorStats.dev ||
      pathStats.ino !== descriptorStats.ino ||
      descriptorStats.dev !== expectedIdentity.dev ||
      descriptorStats.ino !== expectedIdentity.ino
    ) {
      throw new UploadConfigurationError('微信 CI 私钥在读取期间发生变化')
    }

    return readFileSync(descriptor, 'utf8')
  } catch (error) {
    primaryError =
      error instanceof UploadConfigurationError
        ? error
        : new UploadConfigurationError('微信 CI 私钥无法安全打开')
    throw primaryError
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor)
      } catch {
        if (!primaryError) {
          throw new UploadConfigurationError('微信 CI 私钥文件描述符关闭失败')
        }
      }
    }
  }
}

function getOwnedOutputStats(outputPath, identity) {
  try {
    const stats = lstatSync(outputPath, { bigint: true })
    if (
      stats.isSymbolicLink() ||
      !stats.isFile() ||
      stats.dev !== identity.dev ||
      stats.ino !== identity.ino
    ) {
      return null
    }
    return stats
  } catch {
    return null
  }
}

function removeOwnedOutput(outputPath, identity) {
  if (getOwnedOutputStats(outputPath, identity) === null) return
  try {
    rmSync(outputPath, { force: true })
  } catch {
    // 不得用不确定的路径扩大清理范围，也不覆盖更有诊断价值的主错误。
  }
}

function assertReportPath(outputPath) {
  if (!isAbsolute(outputPath)) {
    throw new UploadConfigurationError('上传报告路径必须是绝对路径')
  }
  if (extname(outputPath).toLowerCase() !== '.json') {
    throw new UploadConfigurationError('上传报告路径必须使用 .json 扩展名')
  }
  if (isPathInsideRepository(resolve(outputPath))) {
    throw new UploadConfigurationError('上传报告路径必须位于版本库之外')
  }

  try {
    const outputStats = lstatSync(outputPath)
    if (outputStats.isSymbolicLink()) {
      throw new UploadConfigurationError('上传报告路径不接受符号链接')
    }
    throw new UploadConfigurationError('上传报告路径已存在，拒绝覆盖')
  } catch (error) {
    if (error instanceof UploadConfigurationError) throw error
    if (!(error && typeof error === 'object' && error.code === 'ENOENT')) {
      throw new UploadConfigurationError('无法检查上传报告路径')
    }
  }

  const parentPath = dirname(outputPath)
  let parentStats
  try {
    parentStats = lstatSync(parentPath)
  } catch {
    throw new UploadConfigurationError('上传报告父目录不存在')
  }
  if (parentStats.isSymbolicLink()) {
    throw new UploadConfigurationError('上传报告父目录不接受符号链接')
  }
  if (!parentStats.isDirectory()) {
    throw new UploadConfigurationError('上传报告父路径不是目录')
  }
  if ((parentStats.mode & 0o022) !== 0) {
    throw new UploadConfigurationError('上传报告父目录权限不得允许 group/other 写入')
  }
  try {
    accessSync(parentPath, constants.W_OK | constants.X_OK)
  } catch {
    throw new UploadConfigurationError('上传报告父目录不可写')
  }
  if (isPathInsideRepository(realpathSync(parentPath))) {
    throw new UploadConfigurationError('上传报告路径必须位于版本库之外')
  }
}

// git status 的路径可能相对于当前目录或仓库根，取决于 pathspec 与配置，
// 因此统一归一化后再判断是否只有已生成的 trial manifest 被改动。
function isGeneratedManifestChange(entry) {
  let candidate = entry
  while (candidate.startsWith('../')) candidate = candidate.slice(3)
  return candidate === manifestRelativePath || candidate.endsWith(`/${manifestRelativePath}`)
}

export function readUploadSnapshot() {
  const headSha = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: projectRoot,
    encoding: 'utf8',
  }).trim()
  // 小程序包只由 miniprogram/ 打包，工具脚本不进包；因此干净性只覆盖真正进包的目录。
  const statusOutput = execFileSync(
    'git',
    ['status', '--porcelain', '--untracked-files=all', '--', 'miniprogram'],
    { cwd: projectRoot, encoding: 'utf8' },
  )

  const dirtyPaths = statusOutput
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .map((line) => line.slice(3).trim())

  const manifest = readTrialManifest(resolve(projectRoot, manifestRelativePath))

  return { dirtyPaths, headSha, manifest }
}

export function readTrialManifest(manifestPath) {
  let source
  try {
    source = readFileSync(manifestPath, 'utf8')
  } catch {
    throw new UploadConfigurationError('trial deployment manifest 不可读')
  }

  const match = /export const trialDeploymentManifest = Object\.freeze\((\{[\s\S]*\})\s*as const\)/.exec(
    source,
  )
  if (!match) throw new UploadConfigurationError('trial deployment manifest 未生成或格式非法')

  let parsed
  try {
    parsed = JSON.parse(match[1])
  } catch {
    throw new UploadConfigurationError('trial deployment manifest 未生成或格式非法')
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new UploadConfigurationError('trial deployment manifest 未生成或格式非法')
  }

  const manifest = {
    cloudEnvId: parsed.cloudEnvId,
    cloudServiceName: parsed.cloudServiceName,
    gitCommitSha: parsed.gitCommitSha,
    serverDeploymentRevision: parsed.serverDeploymentRevision,
  }

  for (const [name, value] of Object.entries(manifest)) {
    if (typeof value !== 'string') {
      throw new UploadConfigurationError(`trial deployment manifest 的 ${name} 未生成或非法`)
    }
  }

  return manifest
}

export function validateUploadEnvironment(environment, providedSnapshot) {
  requireNoFollowFlag()
  const appid = required(environment, 'WECHAT_MINIPROGRAM_APPID')
  if (!/^wx[0-9a-f]{16}$/.test(appid)) {
    throw new UploadConfigurationError(
      'WECHAT_MINIPROGRAM_APPID 必须是小写十六进制正式 AppID',
    )
  }

  const privateKeyPath = required(environment, 'WECHAT_MINIPROGRAM_PRIVATE_KEY_PATH')
  if (!isAbsolute(privateKeyPath)) {
    throw new UploadConfigurationError('微信 CI 私钥路径必须是绝对路径')
  }
  if (isPathInsideRepository(resolve(privateKeyPath))) {
    throw new UploadConfigurationError('微信 CI 私钥必须存放在版本库之外')
  }
  const privateKeyIdentity = readPrivateKeyStats(privateKeyPath)
  try {
    accessSync(privateKeyPath, constants.R_OK)
  } catch {
    throw new UploadConfigurationError('微信 CI 私钥文件不存在或不可用')
  }
  if (isPathInsideRepository(realpathSync(privateKeyPath))) {
    throw new UploadConfigurationError('微信 CI 私钥必须存放在版本库之外')
  }

  const robotText = required(environment, 'WECHAT_MINIPROGRAM_ROBOT')
  if (!/^(?:[1-9]|[12]\d|30)$/.test(robotText)) {
    throw new UploadConfigurationError('WECHAT_MINIPROGRAM_ROBOT 必须是 1 到 30 的整数')
  }

  const version = required(environment, 'WECHAT_MINIPROGRAM_VERSION')
  assertStrictSemVer(version)

  const expectedCommit = required(environment, 'WECHAT_MINIPROGRAM_EXPECTED_COMMIT')

  const cloudEnvId = required(environment, 'TRIAL_CLOUD_ENV_ID')
  if (cloudEnvId !== STAGING_RUNTIME_ENV_ID) {
    throw new UploadConfigurationError('trial cloud env 与受控 staging 不一致')
  }
  const cloudServiceName = required(environment, 'TRIAL_CLOUD_SERVICE_NAME')
  if (cloudServiceName !== STAGING_RUNTIME_SERVICE_NAME) {
    throw new UploadConfigurationError('trial cloud service 与受控 staging 不一致')
  }
  const serverDeploymentRevision = required(environment, 'TRIAL_SERVER_DEPLOYMENT_REVISION')
  if (!revisionPattern.test(serverDeploymentRevision)) {
    throw new UploadConfigurationError('缺少或非法服务端 deployment revision')
  }

  const snapshot = providedSnapshot ?? readUploadSnapshot()
  if (!shaPattern.test(expectedCommit) || expectedCommit !== snapshot.headSha) {
    throw new UploadConfigurationError('目标 Git commit SHA 与当前 HEAD 不一致')
  }

  const unexpectedChanges = snapshot.dirtyPaths.filter(
    (entry) => !isGeneratedManifestChange(entry),
  )
  if (unexpectedChanges.length > 0) {
    throw new UploadConfigurationError('上传只允许从干净快照进行，且仅允许已生成的 trial manifest')
  }

  const manifest = snapshot.manifest
  if (
    manifest.cloudEnvId !== cloudEnvId ||
    manifest.cloudServiceName !== cloudServiceName ||
    manifest.gitCommitSha !== expectedCommit ||
    manifest.serverDeploymentRevision !== serverDeploymentRevision
  ) {
    throw new UploadConfigurationError('trial manifest 与目标 staging 身份不一致')
  }

  const reportPath = required(environment, 'WECHAT_MINIPROGRAM_UPLOAD_REPORT_PATH')
  assertReportPath(reportPath)

  return {
    appid,
    cloudEnvId,
    cloudServiceName,
    gitCommitSha: expectedCommit,
    privateKeyIdentity,
    privateKeyPath,
    reportPath,
    robot: Number(robotText),
    serverDeploymentRevision,
    version,
  }
}

function buildUploadReport(configuration, uploadResult) {
  return {
    appid: configuration.appid,
    cloudEnvId: configuration.cloudEnvId,
    cloudServiceName: configuration.cloudServiceName,
    gitCommitSha: configuration.gitCommitSha,
    pluginInfo: Array.isArray(uploadResult?.pluginInfo) ? uploadResult.pluginInfo : [],
    robot: configuration.robot,
    serverDeploymentRevision: configuration.serverDeploymentRevision,
    subPackageInfo: Array.isArray(uploadResult?.subPackageInfo) ? uploadResult.subPackageInfo : [],
    uploadedAt: new Date().toISOString(),
    version: configuration.version,
  }
}

function writeUploadReport(outputPath, report) {
  const contents = `${JSON.stringify(report, null, 2)}\n`
  const noFollow = requireNoFollowFlag()
  let descriptor
  let identity
  let primaryError = null

  try {
    descriptor = openSync(
      outputPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | noFollow,
      0o600,
    )
    const openedStats = fstatSync(descriptor, { bigint: true })
    identity = { dev: openedStats.dev, ino: openedStats.ino }
    if (!openedStats.isFile() || (openedStats.mode & 0o777n) !== 0o600n) {
      throw new UploadConfigurationError('上传报告文件不安全')
    }

    writeFileSync(descriptor, contents)
    const writtenStats = fstatSync(descriptor, { bigint: true })
    if (
      writtenStats.dev !== identity.dev ||
      writtenStats.ino !== identity.ino ||
      writtenStats.size !== BigInt(Buffer.byteLength(contents))
    ) {
      throw new UploadConfigurationError('上传报告写入校验失败')
    }
  } catch (error) {
    primaryError =
      error instanceof UploadConfigurationError
        ? error
        : new UploadConfigurationError('上传报告文件无法安全原子创建')
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor)
      } catch {
        if (!primaryError) {
          primaryError = new UploadConfigurationError('上传报告文件描述符关闭失败')
        }
      }
    }
  }

  if (primaryError) {
    if (identity) removeOwnedOutput(outputPath, identity)
    throw primaryError
  }

  const finalStats = getOwnedOutputStats(outputPath, identity)
  if (
    !finalStats ||
    finalStats.size !== BigInt(Buffer.byteLength(contents)) ||
    (finalStats.mode & 0o777n) !== 0o600n
  ) {
    removeOwnedOutput(outputPath, identity)
    throw new UploadConfigurationError('上传报告关闭后身份或大小校验失败')
  }

  return identity
}

export function createUploadRunner({ ci }) {
  if (!ci || typeof ci.Project !== 'function' || typeof ci.upload !== 'function') {
    throw new TypeError('miniprogram-ci 依赖不完整')
  }

  return async function run(environment = process.env, validatedConfiguration, snapshot) {
    const configuration =
      validatedConfiguration ?? validateUploadEnvironment(environment, snapshot)
    const privateKey = readPrivateKeyFromOwnedDescriptor(
      configuration.privateKeyPath,
      configuration.privateKeyIdentity,
    )
    const project = new ci.Project({
      appid: configuration.appid,
      type: 'miniProgram',
      projectPath: projectRoot,
      privateKey,
      ignores: ['node_modules/**/*'],
    })

    const uploadResult = await ci.upload({
      project,
      version: configuration.version,
      desc: `SBH 小程序 ${configuration.version} (${configuration.gitCommitSha.slice(0, 7)})`,
      setting: { useProjectConfig: true },
      robot: configuration.robot,
    })

    writeUploadReport(configuration.reportPath, buildUploadReport(configuration, uploadResult))

    return {
      gitCommitSha: configuration.gitCommitSha,
      reportPath: configuration.reportPath,
      version: configuration.version,
    }
  }
}

export async function runUpload(environment = process.env) {
  const configuration = validateUploadEnvironment(environment)
  const imported = await import('miniprogram-ci')
  const ci = imported.default ?? imported
  return createUploadRunner({ ci })(environment, configuration)
}

export async function main() {
  try {
    const result = await runUpload()
    console.log(
      `微信小程序 ${result.version} 上传完成（commit ${result.gitCommitSha.slice(0, 7)}）：${result.reportPath}`,
    )
  } catch (error) {
    if (error instanceof UploadConfigurationError) {
      console.error(`上传配置无效：${error.message}`)
    } else {
      console.error('上传失败：请检查微信 CI 权限、网络和工程编译结果；凭据未输出')
    }
    process.exitCode = 1
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main()
}
