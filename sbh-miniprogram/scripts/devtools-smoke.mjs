import { accessSync, constants, existsSync, statSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDirectory, '..')
const smokeTargets = Object.freeze([
  {
    label: '首页',
    marker: '#home-ready',
    method: 'reLaunch',
    path: 'pages/home/index',
  },
  {
    label: '找房页',
    marker: '#listings-ready',
    method: 'switchTab',
    path: 'pages/listings/index',
  },
])

const defaultTimeouts = Object.freeze({
  acceptanceMs: 1_000,
  closeMs: 5_000,
  launchMs: 45_000,
  readyMs: 10_000,
  routeMs: 10_000,
})
const failureCleanupGraceMs = 250

class DevtoolsConfigurationError extends Error {}

function requireDevtoolsCli(environment) {
  const cliPath = environment.WECHAT_DEVTOOLS_CLI

  if (!cliPath) {
    throw new DevtoolsConfigurationError(
      '缺少 WECHAT_DEVTOOLS_CLI，请填写微信开发者工具 CLI 的绝对路径',
    )
  }
  if (!isAbsolute(cliPath)) {
    throw new DevtoolsConfigurationError('WECHAT_DEVTOOLS_CLI 必须是绝对路径')
  }
  if (!existsSync(cliPath) || !statSync(cliPath).isFile()) {
    throw new DevtoolsConfigurationError('WECHAT_DEVTOOLS_CLI 指向的文件不存在')
  }
  try {
    accessSync(cliPath, constants.X_OK)
  } catch {
    throw new DevtoolsConfigurationError('WECHAT_DEVTOOLS_CLI 缺少执行权限')
  }

  return cliPath
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}

async function withTimeout(operation, milliseconds, message) {
  let timeoutId
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), milliseconds)
  })

  try {
    return await Promise.race([operation, timeout])
  } finally {
    clearTimeout(timeoutId)
  }
}

async function waitForReadyMarker(page, markerSelector, pollIntervalMs, readyMs) {
  const deadline = Date.now() + readyMs

  while (true) {
    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) throw new Error('ready 超时')

    const marker = await withTimeout(
      Promise.resolve().then(() => page.$(markerSelector)),
      remainingMs,
      'ready 超时',
    )
    if (marker) return
    await delay(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())))
  }
}

async function verifyTarget(miniProgram, target, runtimeExceptionPromise, pollIntervalMs, timeouts) {
  const navigate = miniProgram[target.method]
  if (typeof navigate !== 'function') {
    throw new Error(`${target.label}路由方法不可用`)
  }

  const page = await Promise.race([
    withTimeout(
      Promise.resolve().then(() => navigate.call(miniProgram, `/${target.path}`)),
      timeouts.routeMs,
      `${target.label}路由超时`,
    ),
    runtimeExceptionPromise,
  ])

  if (!page || page.path !== target.path) {
    throw new Error(`${target.label}路由不匹配`)
  }

  await Promise.race([
    waitForReadyMarker(page, target.marker, pollIntervalMs, timeouts.readyMs),
    runtimeExceptionPromise,
  ])
  await Promise.race([delay(timeouts.acceptanceMs), runtimeExceptionPromise])
}

async function closeSafely(miniProgram, closeMs) {
  try {
    await withTimeout(Promise.resolve().then(() => miniProgram.close()), closeMs, '关闭超时')
    return null
  } catch {
    try {
      await withTimeout(
        Promise.resolve().then(() => miniProgram.disconnect()),
        closeMs,
        '强制断开超时',
      )
    } catch {
      // 二次清理只作兜底，不能覆盖更有诊断价值的主错误。
    }
    return new Error('关闭连接失败')
  }
}

export function createDevtoolsSmokeRunner({
  automator,
  pollIntervalMs = 100,
  timeouts: timeoutOverrides = {},
}) {
  if (!automator || typeof automator.launch !== 'function') {
    throw new TypeError('automator.launch 必须可调用')
  }

  const timeouts = { ...defaultTimeouts, ...timeoutOverrides }

  return async function run(environment = process.env, validatedConfiguration) {
    const cliPath = validatedConfiguration?.cliPath ?? requireDevtoolsCli(environment)
    let miniProgram
    let primaryError = null
    let runtimeExceptionPromise
    let removeExceptionListener = () => {}

    try {
      const launchPromise = Promise.resolve().then(() =>
        automator.launch({
          cliPath,
          projectPath: projectRoot,
          timeout: timeouts.launchMs,
          trustProject: true,
        }),
      )
      try {
        miniProgram = await withTimeout(launchPromise, timeouts.launchMs, '启动超时')
      } catch (error) {
        if (error instanceof Error && error.message === '启动超时') {
          void launchPromise
            .then((lateMiniProgram) => closeSafely(lateMiniProgram, timeouts.closeMs))
            .catch(() => {})
        }
        throw error
      }

      runtimeExceptionPromise = new Promise((_, reject) => {
        const onException = () => reject(new Error('验收窗口检测到运行时异常'))
        miniProgram.on('exception', onException)
        removeExceptionListener = () => {
          if (typeof miniProgram.removeListener === 'function') {
            miniProgram.removeListener('exception', onException)
          }
        }
      })

      for (const target of smokeTargets) {
        await verifyTarget(miniProgram, target, runtimeExceptionPromise, pollIntervalMs, timeouts)
      }
    } catch (error) {
      primaryError = error instanceof Error ? error : new Error('开发者工具冒烟失败')
    } finally {
      try {
        removeExceptionListener()
      } catch {
        // 监听器清理失败不能阻断连接关闭，也不能覆盖主错误。
      }
      const cleanupError = miniProgram
        ? await closeSafely(miniProgram, timeouts.closeMs)
        : null

      if (primaryError) throw primaryError
      if (cleanupError) throw cleanupError
    }
  }
}

export async function runDevtoolsSmoke(environment = process.env) {
  const configuration = { cliPath: requireDevtoolsCli(environment) }
  const imported = await import('miniprogram-automator')
  const automator = imported.default ?? imported
  return createDevtoolsSmokeRunner({ automator })(environment, configuration)
}

export async function main({
  cleanupGraceMs = failureCleanupGraceMs,
  exit = process.exit,
  run = runDevtoolsSmoke,
} = {}) {
  try {
    await run()
    console.log('微信开发者工具首页/找房冒烟检查通过')
  } catch (error) {
    if (error instanceof DevtoolsConfigurationError) {
      console.error(`开发者工具冒烟检查失败：${error.message}`)
    } else {
      console.error('开发者工具冒烟检查失败：请检查 CLI、登录状态、自动化端口与工程编译结果')
    }
    await delay(cleanupGraceMs)
    exit(1)
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main()
}
