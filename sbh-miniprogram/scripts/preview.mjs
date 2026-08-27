import {
  accessSync,
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDirectory, '..')
const maximumQrcodeBytes = 5 * 1024 * 1024

class PreviewConfigurationError extends Error {}

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
    throw new PreviewConfigurationError(`缺少 ${name}`)
  }
  return value
}

function requireNoFollowFlag() {
  if (!Number.isInteger(constants.O_NOFOLLOW)) {
    throw new PreviewConfigurationError('当前平台不支持 O_NOFOLLOW，拒绝读取微信 CI 私钥')
  }
  return constants.O_NOFOLLOW
}

function assertStrictSemVer(version) {
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(
      version,
    )

  if (!match || version.length > 64) {
    throw new PreviewConfigurationError('WECHAT_MINIPROGRAM_VERSION 必须是严格 SemVer')
  }

  const prerelease = match[4]
  if (
    prerelease?.split('.').some(
      (identifier) => /^\d+$/.test(identifier) && identifier.length > 1 && identifier.startsWith('0'),
    )
  ) {
    throw new PreviewConfigurationError('WECHAT_MINIPROGRAM_VERSION 必须是严格 SemVer')
  }
}

function readPrivateKeyStats(privateKeyPath) {
  let privateKeyStats
  try {
    privateKeyStats = lstatSync(privateKeyPath, { bigint: true })
  } catch {
    throw new PreviewConfigurationError('微信 CI 私钥文件不存在或不可用')
  }

  if (privateKeyStats.isSymbolicLink()) {
    throw new PreviewConfigurationError('微信 CI 私钥不接受符号链接')
  }
  if (!privateKeyStats.isFile()) {
    throw new PreviewConfigurationError('微信 CI 私钥必须是普通文件')
  }
  if ((privateKeyStats.mode & 0o177n) !== 0n || (privateKeyStats.mode & 0o400n) === 0n) {
    throw new PreviewConfigurationError('微信 CI 私钥权限必须仅所有者可读写（0400 或 0600）')
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
      throw new PreviewConfigurationError('微信 CI 私钥必须是普通文件')
    }
    if ((descriptorStats.mode & 0o177n) !== 0n || (descriptorStats.mode & 0o400n) === 0n) {
      throw new PreviewConfigurationError('微信 CI 私钥权限必须仅所有者可读写（0400 或 0600）')
    }

    const pathStats = lstatSync(privateKeyPath, { bigint: true })
    if (
      pathStats.isSymbolicLink() ||
      pathStats.dev !== descriptorStats.dev ||
      pathStats.ino !== descriptorStats.ino ||
      descriptorStats.dev !== expectedIdentity.dev ||
      descriptorStats.ino !== expectedIdentity.ino
    ) {
      throw new PreviewConfigurationError('微信 CI 私钥在读取期间发生变化')
    }

    return readFileSync(descriptor, 'utf8')
  } catch (error) {
    primaryError =
      error instanceof PreviewConfigurationError
        ? error
        : new PreviewConfigurationError('微信 CI 私钥无法安全打开')
    throw primaryError
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor)
      } catch {
        if (!primaryError) {
          throw new PreviewConfigurationError('微信 CI 私钥文件描述符关闭失败')
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

function isOwnedOutput(outputPath, identity) {
  return getOwnedOutputStats(outputPath, identity) !== null
}

function removeOwnedOutput(outputPath, identity) {
  if (!isOwnedOutput(outputPath, identity)) return
  try {
    rmSync(outputPath, { force: true })
  } catch {
    // 不得用不确定的路径扩大清理范围，也不覆盖更有诊断价值的主错误。
  }
}

function createPrivateStagingDirectory() {
  let stagingDirectory
  let stagingIdentity

  try {
    stagingDirectory = mkdtempSync(join(tmpdir(), 'sbh-mp-preview-'))
    const createdStats = lstatSync(stagingDirectory, { bigint: true })
    if (createdStats.isSymbolicLink() || !createdStats.isDirectory()) {
      throw new PreviewConfigurationError('二维码私有暂存目录不安全')
    }
    stagingIdentity = { dev: createdStats.dev, ino: createdStats.ino }
    chmodSync(stagingDirectory, 0o700)
    stagingDirectory = realpathSync(stagingDirectory)
    const stats = lstatSync(stagingDirectory, { bigint: true })
    if (
      stats.isSymbolicLink() ||
      !stats.isDirectory() ||
      (stats.mode & 0o777n) !== 0o700n ||
      stats.dev !== stagingIdentity.dev ||
      stats.ino !== stagingIdentity.ino ||
      isPathInsideRepository(stagingDirectory)
    ) {
      throw new PreviewConfigurationError('二维码私有暂存目录不安全')
    }
    return { identity: stagingIdentity, path: stagingDirectory }
  } catch (error) {
    if (stagingDirectory && stagingIdentity) {
      removeOwnedStagingDirectory(stagingDirectory, stagingIdentity)
    }
    throw error instanceof PreviewConfigurationError
      ? error
      : new PreviewConfigurationError('二维码私有暂存目录无法创建')
  }
}

function removeOwnedStagingDirectory(stagingDirectory, identity) {
  try {
    const stats = lstatSync(stagingDirectory, { bigint: true })
    if (
      stats.isSymbolicLink() ||
      !stats.isDirectory() ||
      stats.dev !== identity.dev ||
      stats.ino !== identity.ino
    ) {
      return new PreviewConfigurationError('二维码私有暂存目录身份发生变化')
    }
    rmSync(stagingDirectory, { force: true, recursive: true })
    return null
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return null
    return error instanceof PreviewConfigurationError
      ? error
      : new PreviewConfigurationError('二维码私有暂存目录清理失败')
  }
}

function readStagedQrcode(stagePath) {
  const noFollow = requireNoFollowFlag()
  let descriptor
  let primaryError = null

  try {
    descriptor = openSync(stagePath, constants.O_RDONLY | noFollow)
    const beforeRead = fstatSync(descriptor, { bigint: true })
    if (
      !beforeRead.isFile() ||
      beforeRead.size <= 0n ||
      beforeRead.size > BigInt(maximumQrcodeBytes)
    ) {
      throw new PreviewConfigurationError('二维码暂存文件必须是大小合理的普通文件')
    }

    const pathStats = lstatSync(stagePath, { bigint: true })
    if (
      pathStats.isSymbolicLink() ||
      pathStats.dev !== beforeRead.dev ||
      pathStats.ino !== beforeRead.ino
    ) {
      throw new PreviewConfigurationError('二维码暂存文件身份不安全')
    }

    const contents = readFileSync(descriptor)
    const afterRead = fstatSync(descriptor, { bigint: true })
    const afterPathStats = lstatSync(stagePath, { bigint: true })
    if (
      afterRead.dev !== beforeRead.dev ||
      afterRead.ino !== beforeRead.ino ||
      afterRead.size !== beforeRead.size ||
      afterPathStats.isSymbolicLink() ||
      afterPathStats.dev !== beforeRead.dev ||
      afterPathStats.ino !== beforeRead.ino ||
      BigInt(contents.length) !== beforeRead.size
    ) {
      throw new PreviewConfigurationError('二维码暂存文件在读取期间发生变化')
    }

    return contents
  } catch (error) {
    primaryError =
      error instanceof PreviewConfigurationError
        ? error
        : new PreviewConfigurationError('二维码暂存文件无法安全打开')
    throw primaryError
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor)
      } catch {
        if (!primaryError) {
          throw new PreviewConfigurationError('二维码暂存文件描述符关闭失败')
        }
      }
    }
  }
}

function writeFinalQrcode(outputPath, contents) {
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
      throw new PreviewConfigurationError('最终二维码文件不安全')
    }

    writeFileSync(descriptor, contents)
    const writtenStats = fstatSync(descriptor, { bigint: true })
    if (
      writtenStats.dev !== identity.dev ||
      writtenStats.ino !== identity.ino ||
      writtenStats.size !== BigInt(contents.length)
    ) {
      throw new PreviewConfigurationError('最终二维码写入校验失败')
    }
  } catch (error) {
    primaryError =
      error instanceof PreviewConfigurationError
        ? error
        : new PreviewConfigurationError('最终二维码文件无法安全原子创建')
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor)
      } catch {
        if (!primaryError) {
          primaryError = new PreviewConfigurationError('最终二维码文件描述符关闭失败')
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
    finalStats.size !== BigInt(contents.length) ||
    (finalStats.mode & 0o777n) !== 0o600n
  ) {
    removeOwnedOutput(outputPath, identity)
    throw new PreviewConfigurationError('最终二维码关闭后身份或大小校验失败')
  }

  return identity
}

function assertOutputPath(outputPath) {
  if (!isAbsolute(outputPath)) {
    throw new PreviewConfigurationError('二维码输出路径必须是绝对路径')
  }
  if (!['.jpg', '.jpeg'].includes(extname(outputPath).toLowerCase())) {
    throw new PreviewConfigurationError('二维码输出路径必须使用 .jpg 或 .jpeg 扩展名')
  }
  if (isPathInsideRepository(resolve(outputPath))) {
    throw new PreviewConfigurationError('二维码输出路径必须位于版本库之外')
  }

  try {
    const outputStats = lstatSync(outputPath)
    if (outputStats.isSymbolicLink()) {
      throw new PreviewConfigurationError('二维码输出路径不接受符号链接')
    }
    throw new PreviewConfigurationError('二维码输出路径已存在，拒绝覆盖')
  } catch (error) {
    if (error instanceof PreviewConfigurationError) throw error
    if (!(error && typeof error === 'object' && error.code === 'ENOENT')) {
      throw new PreviewConfigurationError('无法检查二维码输出路径')
    }
  }

  const parentPath = dirname(outputPath)
  let parentStats
  try {
    parentStats = lstatSync(parentPath)
  } catch {
    throw new PreviewConfigurationError('二维码输出父目录不存在')
  }
  if (parentStats.isSymbolicLink()) {
    throw new PreviewConfigurationError('二维码输出父目录不接受符号链接')
  }
  if (!parentStats.isDirectory()) {
    throw new PreviewConfigurationError('二维码输出父路径不是目录')
  }
  if ((parentStats.mode & 0o022) !== 0) {
    throw new PreviewConfigurationError('二维码输出父目录权限不得允许 group/other 写入')
  }
  try {
    accessSync(parentPath, constants.W_OK | constants.X_OK)
  } catch {
    throw new PreviewConfigurationError('二维码输出父目录不可写')
  }
  if (isPathInsideRepository(realpathSync(parentPath))) {
    throw new PreviewConfigurationError('二维码输出路径必须位于版本库之外')
  }
}

export function validatePreviewEnvironment(environment) {
  requireNoFollowFlag()
  const appid = required(environment, 'WECHAT_MINIPROGRAM_APPID')
  if (!/^wx[0-9a-f]{16}$/.test(appid)) {
    throw new PreviewConfigurationError(
      'WECHAT_MINIPROGRAM_APPID 必须是小写十六进制正式 AppID',
    )
  }

  const privateKeyPath = required(environment, 'WECHAT_MINIPROGRAM_PRIVATE_KEY_PATH')
  if (!isAbsolute(privateKeyPath)) {
    throw new PreviewConfigurationError('微信 CI 私钥路径必须是绝对路径')
  }
  if (isPathInsideRepository(resolve(privateKeyPath))) {
    throw new PreviewConfigurationError('微信 CI 私钥必须存放在版本库之外')
  }
  const privateKeyIdentity = readPrivateKeyStats(privateKeyPath)
  try {
    accessSync(privateKeyPath, constants.R_OK)
  } catch {
    throw new PreviewConfigurationError('微信 CI 私钥文件不存在或不可用')
  }
  if (isPathInsideRepository(realpathSync(privateKeyPath))) {
    throw new PreviewConfigurationError('微信 CI 私钥必须存放在版本库之外')
  }

  const robotText = required(environment, 'WECHAT_MINIPROGRAM_ROBOT')
  if (!/^(?:[1-9]|[12]\d|30)$/.test(robotText)) {
    throw new PreviewConfigurationError('WECHAT_MINIPROGRAM_ROBOT 必须是 1 到 30 的整数')
  }

  const version = required(environment, 'WECHAT_MINIPROGRAM_VERSION')
  assertStrictSemVer(version)

  const qrcodeOutputDest = required(environment, 'WECHAT_MINIPROGRAM_QRCODE_OUTPUT_PATH')
  assertOutputPath(qrcodeOutputDest)

  return {
    appid,
    privateKeyIdentity,
    privateKeyPath,
    qrcodeOutputDest,
    robot: Number(robotText),
    version,
  }
}

export function createPreviewRunner({ ci }) {
  if (!ci || typeof ci.Project !== 'function' || typeof ci.preview !== 'function') {
    throw new TypeError('miniprogram-ci 依赖不完整')
  }

  return async function run(environment = process.env, validatedConfiguration) {
    const configuration =
      validatedConfiguration ?? validatePreviewEnvironment(environment)
    const privateKey = readPrivateKeyFromOwnedDescriptor(
      configuration.privateKeyPath,
      configuration.privateKeyIdentity,
    )
    const staging = createPrivateStagingDirectory()
    const stagedQrcodePath = join(staging.path, 'stage.jpg')
    let finalIdentity
    let primaryError = null
    let result

    try {
      const project = new ci.Project({
        appid: configuration.appid,
        type: 'miniProgram',
        projectPath: projectRoot,
        privateKey,
        ignores: ['node_modules/**/*'],
      })

      await ci.preview({
        project,
        desc: `SBH 小程序 ${configuration.version}`,
        setting: { useProjectConfig: true },
        robot: configuration.robot,
        pagePath: 'pages/foundation/index',
        qrcodeFormat: 'image',
        qrcodeOutputDest: stagedQrcodePath,
      })

      const stagedContents = readStagedQrcode(stagedQrcodePath)
      finalIdentity = writeFinalQrcode(configuration.qrcodeOutputDest, stagedContents)

      result = {
        qrcodeOutputDest: configuration.qrcodeOutputDest,
        version: configuration.version,
      }
    } catch (error) {
      primaryError = error instanceof Error ? error : new Error('微信 CI 预览失败')
    } finally {
      const cleanupError = removeOwnedStagingDirectory(staging.path, staging.identity)
      if (cleanupError && !primaryError) primaryError = cleanupError
    }

    if (primaryError) {
      if (finalIdentity) removeOwnedOutput(configuration.qrcodeOutputDest, finalIdentity)
      throw primaryError
    }

    return result
  }
}

export async function runPreview(environment = process.env) {
  const configuration = validatePreviewEnvironment(environment)
  const imported = await import('miniprogram-ci')
  const ci = imported.default ?? imported
  return createPreviewRunner({ ci })(environment, configuration)
}

export async function main() {
  try {
    const result = await runPreview()
    console.log(`微信小程序 ${result.version} 预览构建完成：${result.qrcodeOutputDest}`)
  } catch (error) {
    if (error instanceof PreviewConfigurationError) {
      console.error(`预览配置无效：${error.message}`)
    } else {
      console.error('预览构建失败：请检查微信 CI 权限、网络和工程编译结果；凭据未输出')
    }
    process.exitCode = 1
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main()
}
