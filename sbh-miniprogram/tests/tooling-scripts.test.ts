import { execFileSync, spawnSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const scripts = {
  checkProject: join(projectRoot, 'scripts/check-project.mjs'),
  devtoolsSmoke: join(projectRoot, 'scripts/devtools-smoke.mjs'),
  preview: join(projectRoot, 'scripts/preview.mjs'),
}

const previewVariableNames = [
  'WECHAT_MINIPROGRAM_APPID',
  'WECHAT_MINIPROGRAM_PRIVATE_KEY_PATH',
  'WECHAT_MINIPROGRAM_ROBOT',
  'WECHAT_MINIPROGRAM_VERSION',
  'WECHAT_MINIPROGRAM_QRCODE_OUTPUT_PATH',
] as const

function cleanEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env }

  for (const name of previewVariableNames) {
    delete environment[name]
  }
  delete environment.WECHAT_DEVTOOLS_CLI

  return environment
}

function runScript(
  script: string,
  environment: NodeJS.ProcessEnv = cleanEnvironment(),
): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [script], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: environment,
    timeout: 10_000,
  })
}

function outputOf(result: ReturnType<typeof spawnSync>): string {
  return `${result.stdout ?? ''}${result.stderr ?? ''}`
}

describe('project:check', () => {
  test('在受支持的 Node 22 下完成纯本地工程检查', () => {
    const result = runScript(scripts.checkProject)

    expect(result.status, outputOf(result)).toBe(0)
    expect(outputOf(result)).toContain('工程静态检查通过')
  })

  test('拒绝 Node 22.12 以下和 Node 23', () => {
    const evaluation = `
      import { assertSupportedNodeVersion } from ${JSON.stringify(new URL('../scripts/check-project.mjs', import.meta.url).href)};
      const results = ['22.11.9', '22.12.0', '22.99.0', '22.12.0-beta.1', '23.0.0'].map((version) => {
        try { assertSupportedNodeVersion(version); return 'pass'; }
        catch { return 'fail'; }
      });
      process.stdout.write(results.join(','));
    `

    const output = execFileSync(process.execPath, ['--input-type=module', '--eval', evaluation], {
      cwd: projectRoot,
      encoding: 'utf8',
    })

    expect(output).toBe('fail,pass,pass,fail,fail')
  })
})

describe('devtools:smoke', () => {
  let temporaryDirectory: string
  let executableCliPath: string

  beforeAll(() => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'sbh-mp-devtools-test-'))
    executableCliPath = join(temporaryDirectory, 'cli')
    writeFileSync(executableCliPath, '#!/bin/sh\nexit 0\n')
    chmodSync(executableCliPath, 0o700)
  })

  afterAll(() => {
    rmSync(temporaryDirectory, { force: true, recursive: true })
  })

  test('缺少 WECHAT_DEVTOOLS_CLI 时在启动开发者工具前失败', () => {
    const result = runScript(scripts.devtoolsSmoke)

    expect(result.status).not.toBe(0)
    expect(outputOf(result)).toContain('WECHAT_DEVTOOLS_CLI')
  })

  test('拒绝相对路径，避免从当前目录误启动同名程序', () => {
    const result = runScript(scripts.devtoolsSmoke, {
      ...cleanEnvironment(),
      WECHAT_DEVTOOLS_CLI: './cli',
    })

    expect(result.status).not.toBe(0)
    expect(outputOf(result)).toContain('绝对路径')
  })

  test('拒绝没有执行权限的 CLI 文件', () => {
    const nonExecutableCliPath = join(temporaryDirectory, 'not-executable')
    writeFileSync(nonExecutableCliPath, 'not executable', { mode: 0o600 })
    chmodSync(nonExecutableCliPath, 0o600)

    const result = runScript(scripts.devtoolsSmoke, {
      ...cleanEnvironment(),
      WECHAT_DEVTOOLS_CLI: nonExecutableCliPath,
    })

    expect(result.status).not.toBe(0)
    expect(outputOf(result)).toContain('执行权限')
  })

  test('注入假 automator 后按首页到找房的顺序轮询 ready 并关闭连接', async () => {
    const module = await import(pathToFileURL(scripts.devtoolsSmoke).href)
    const homePage = {
      path: 'pages/home/index',
      $: vi.fn().mockResolvedValueOnce(null).mockResolvedValue({ id: 'home-ready' }),
    }
    const listingsPage = {
      path: 'pages/listings/index',
      $: vi.fn().mockResolvedValueOnce(null).mockResolvedValue({ id: 'listings-ready' }),
    }
    const miniProgram = Object.assign(new EventEmitter(), {
      reLaunch: vi.fn().mockResolvedValue(homePage),
      switchTab: vi.fn().mockResolvedValue(listingsPage),
      close: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
    })
    const automator = { launch: vi.fn().mockResolvedValue(miniProgram) }
    const runner = module.createDevtoolsSmokeRunner({
      automator,
      pollIntervalMs: 1,
      timeouts: { acceptanceMs: 2, closeMs: 20, launchMs: 20, readyMs: 20, routeMs: 20 },
    })

    await runner({ WECHAT_DEVTOOLS_CLI: executableCliPath })

    expect(automator.launch).toHaveBeenCalledWith(
      expect.objectContaining({
        cliPath: executableCliPath,
        projectPath: projectRoot,
        timeout: 20,
        trustProject: true,
      }),
    )
    expect(miniProgram.reLaunch).toHaveBeenCalledWith('/pages/home/index')
    expect(homePage.$).toHaveBeenCalledWith('#home-ready')
    expect(homePage.$).toHaveBeenCalledTimes(2)
    expect(miniProgram.switchTab).toHaveBeenCalledWith('/pages/listings/index')
    expect(listingsPage.$).toHaveBeenCalledWith('#listings-ready')
    expect(listingsPage.$).toHaveBeenCalledTimes(2)
    expect(miniProgram.close).toHaveBeenCalledOnce()
    expect(miniProgram.disconnect).not.toHaveBeenCalled()
  })

  test('首页实际路由不匹配时失败并清理', async () => {
    const module = await import(pathToFileURL(scripts.devtoolsSmoke).href)
    const page = { path: 'pages/other/index', $: vi.fn() }
    const miniProgram = Object.assign(new EventEmitter(), {
      reLaunch: vi.fn().mockResolvedValue(page),
      close: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
    })
    const runner = module.createDevtoolsSmokeRunner({
      automator: { launch: vi.fn().mockResolvedValue(miniProgram) },
      timeouts: { acceptanceMs: 1, closeMs: 20, launchMs: 20, readyMs: 20, routeMs: 20 },
    })

    await expect(runner({ WECHAT_DEVTOOLS_CLI: executableCliPath })).rejects.toThrow(
      '首页路由不匹配',
    )
    expect(miniProgram.close).toHaveBeenCalledOnce()
  })

  test('找房页实际路由不匹配时失败并清理', async () => {
    const module = await import(pathToFileURL(scripts.devtoolsSmoke).href)
    const miniProgram = Object.assign(new EventEmitter(), {
      reLaunch: vi
        .fn()
        .mockResolvedValue({ path: 'pages/home/index', $: vi.fn().mockResolvedValue({}) }),
      switchTab: vi
        .fn()
        .mockResolvedValue({ path: 'pages/other/index', $: vi.fn() }),
      close: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
    })
    const runner = module.createDevtoolsSmokeRunner({
      automator: { launch: vi.fn().mockResolvedValue(miniProgram) },
      timeouts: { acceptanceMs: 1, closeMs: 20, launchMs: 20, readyMs: 20, routeMs: 20 },
    })

    await expect(runner({ WECHAT_DEVTOOLS_CLI: executableCliPath })).rejects.toThrow(
      '找房页路由不匹配',
    )
    expect(miniProgram.close).toHaveBeenCalledOnce()
  })

  test('ready 后验收窗口出现运行时异常仍然失败', async () => {
    const module = await import(pathToFileURL(scripts.devtoolsSmoke).href)
    const miniProgram = Object.assign(new EventEmitter(), {
      reLaunch: vi.fn(),
      switchTab: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
    })
    const page = {
      path: 'pages/home/index',
      $: vi.fn().mockImplementation(async () => {
        setTimeout(() => miniProgram.emit('exception', { message: 'secret runtime detail' }), 1)
        return { id: 'home-ready' }
      }),
    }
    miniProgram.reLaunch.mockResolvedValue(page)
    const runner = module.createDevtoolsSmokeRunner({
      automator: { launch: vi.fn().mockResolvedValue(miniProgram) },
      pollIntervalMs: 1,
      timeouts: { acceptanceMs: 20, closeMs: 20, launchMs: 20, readyMs: 20, routeMs: 20 },
    })

    await expect(runner({ WECHAT_DEVTOOLS_CLI: executableCliPath })).rejects.toThrow(
      '运行时异常',
    )
    expect(miniProgram.close).toHaveBeenCalledOnce()
  })

  test('找房页 ready 后验收窗口出现运行时异常仍然失败', async () => {
    const module = await import(pathToFileURL(scripts.devtoolsSmoke).href)
    const miniProgram = Object.assign(new EventEmitter(), {
      reLaunch: vi.fn(),
      switchTab: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
    })
    miniProgram.reLaunch.mockResolvedValue({
      path: 'pages/home/index',
      $: vi.fn().mockResolvedValue({ id: 'home-ready' }),
    })
    miniProgram.switchTab.mockResolvedValue({
      path: 'pages/listings/index',
      $: vi.fn().mockImplementation(async () => {
        setTimeout(() => miniProgram.emit('exception', { message: 'secret runtime detail' }), 1)
        return { id: 'listings-ready' }
      }),
    })
    const runner = module.createDevtoolsSmokeRunner({
      automator: { launch: vi.fn().mockResolvedValue(miniProgram) },
      pollIntervalMs: 1,
      timeouts: { acceptanceMs: 20, closeMs: 20, launchMs: 20, readyMs: 20, routeMs: 20 },
    })

    await expect(runner({ WECHAT_DEVTOOLS_CLI: executableCliPath })).rejects.toThrow(
      '运行时异常',
    )
    expect(miniProgram.close).toHaveBeenCalledOnce()
  })

  test.each([
    ['启动', () => new Promise(() => {})],
  ])('%s阶段有明确超时', async (label, launch) => {
    const module = await import(pathToFileURL(scripts.devtoolsSmoke).href)
    const runner = module.createDevtoolsSmokeRunner({
      automator: { launch },
      timeouts: { acceptanceMs: 1, closeMs: 10, launchMs: 5, readyMs: 10, routeMs: 10 },
    })

    await expect(runner({ WECHAT_DEVTOOLS_CLI: executableCliPath })).rejects.toThrow(
      `${label}超时`,
    )
  })

  test('两个页面的路由和 ready 各自有明确超时，并在超时后关闭', async () => {
    const module = await import(pathToFileURL(scripts.devtoolsSmoke).href)

    for (const mode of ['home-route', 'home-ready', 'listings-route', 'listings-ready'] as const) {
      const homePage = {
        path: 'pages/home/index',
        $: vi.fn().mockResolvedValue(mode === 'home-ready' ? null : {}),
      }
      const listingsPage = {
        path: 'pages/listings/index',
        $: vi.fn().mockResolvedValue(mode === 'listings-ready' ? null : {}),
      }
      const miniProgram = Object.assign(new EventEmitter(), {
        reLaunch: vi.fn().mockImplementation(() =>
          mode === 'home-route' ? new Promise(() => {}) : Promise.resolve(homePage),
        ),
        switchTab: vi.fn().mockImplementation(() =>
          mode === 'listings-route' ? new Promise(() => {}) : Promise.resolve(listingsPage),
        ),
        close: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn(),
      })
      const runner = module.createDevtoolsSmokeRunner({
        automator: { launch: vi.fn().mockResolvedValue(miniProgram) },
        pollIntervalMs: 1,
        timeouts: { acceptanceMs: 1, closeMs: 10, launchMs: 10, readyMs: 5, routeMs: 5 },
      })

      await expect(runner({ WECHAT_DEVTOOLS_CLI: executableCliPath })).rejects.toThrow(
        mode.endsWith('route') ? '路由超时' : 'ready 超时',
      )
      expect(miniProgram.close).toHaveBeenCalledOnce()
    }
  })

  test('清理失败不覆盖原始错误，关闭超时后 disconnect 也受二次保护', async () => {
    const module = await import(pathToFileURL(scripts.devtoolsSmoke).href)
    const page = { path: 'pages/other/index', $: vi.fn() }
    const miniProgram = Object.assign(new EventEmitter(), {
      reLaunch: vi.fn().mockResolvedValue(page),
      close: vi.fn().mockImplementation(() => new Promise(() => {})),
      disconnect: vi.fn().mockImplementation(() => {
        throw new Error('disconnect detail must not replace route failure')
      }),
      removeListener: vi.fn().mockImplementation(() => {
        throw new Error('listener cleanup must not replace route failure')
      }),
    })
    const runner = module.createDevtoolsSmokeRunner({
      automator: { launch: vi.fn().mockResolvedValue(miniProgram) },
      timeouts: { acceptanceMs: 1, closeMs: 5, launchMs: 10, readyMs: 10, routeMs: 10 },
    })

    await expect(runner({ WECHAT_DEVTOOLS_CLI: executableCliPath })).rejects.toThrow(
      '首页路由不匹配',
    )
    expect(miniProgram.disconnect).toHaveBeenCalledOnce()
  })

  test('主流程成功但关闭失败时 fail closed 并执行 disconnect', async () => {
    const module = await import(pathToFileURL(scripts.devtoolsSmoke).href)
    const page = { path: 'pages/home/index', $: vi.fn().mockResolvedValue({}) }
    const miniProgram = Object.assign(new EventEmitter(), {
      reLaunch: vi.fn().mockResolvedValue(page),
      switchTab: vi
        .fn()
        .mockResolvedValue({ path: 'pages/listings/index', $: vi.fn().mockResolvedValue({}) }),
      close: vi.fn().mockRejectedValue(new Error('close detail')),
      disconnect: vi.fn(),
    })
    const runner = module.createDevtoolsSmokeRunner({
      automator: { launch: vi.fn().mockResolvedValue(miniProgram) },
      timeouts: { acceptanceMs: 1, closeMs: 10, launchMs: 10, readyMs: 10, routeMs: 10 },
    })

    await expect(runner({ WECHAT_DEVTOOLS_CLI: executableCliPath })).rejects.toThrow(
      '关闭连接失败',
    )
    expect(miniProgram.disconnect).toHaveBeenCalledOnce()
  })

  test('启动超时后迟到的 miniProgram 仍会被安全回收', async () => {
    const module = await import(pathToFileURL(scripts.devtoolsSmoke).href)
    let resolveLaunch: ((value: unknown) => void) | undefined
    const launchPromise = new Promise((resolvePromise) => {
      resolveLaunch = resolvePromise
    })
    const miniProgram = Object.assign(new EventEmitter(), {
      close: vi.fn().mockRejectedValue(new Error('late close failure')),
      disconnect: vi.fn(),
    })
    const runner = module.createDevtoolsSmokeRunner({
      automator: { launch: vi.fn(() => launchPromise) },
      timeouts: { acceptanceMs: 1, closeMs: 10, launchMs: 5, readyMs: 10, routeMs: 10 },
    })

    await expect(runner({ WECHAT_DEVTOOLS_CLI: executableCliPath })).rejects.toThrow('启动超时')
    resolveLaunch?.(miniProgram)

    await vi.waitFor(() => expect(miniProgram.disconnect).toHaveBeenCalledOnce())
    expect(miniProgram.close).toHaveBeenCalledOnce()
  })

  test('真实入口在动态导入 automator 前先校验 CLI', () => {
    const source = readFileSync(scripts.devtoolsSmoke, 'utf8')
    const entry = source.slice(source.indexOf('export async function runDevtoolsSmoke'))

    expect(entry.indexOf('requireDevtoolsCli')).toBeGreaterThanOrEqual(0)
    expect(entry.indexOf('requireDevtoolsCli')).toBeLessThan(
      entry.indexOf("import('miniprogram-automator')"),
    )
  })

  test('失败入口在存在活跃句柄时仍会在明确上限内以非零码退出', () => {
    const evaluation = `
      import { main } from ${JSON.stringify(pathToFileURL(scripts.devtoolsSmoke).href)};
      setInterval(() => {}, 1_000);
      await main({
        cleanupGraceMs: 25,
        run: async () => { throw new Error('injected launch failure'); },
      });
      process.stdout.write('main-returned-without-exit');
    `
    const startedAt = Date.now()
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', evaluation], {
      cwd: projectRoot,
      encoding: 'utf8',
      env: cleanEnvironment(),
      timeout: 1_500,
    })
    const elapsedMs = Date.now() - startedAt

    expect(result.signal, outputOf(result)).toBeNull()
    expect(result.status, outputOf(result)).toBe(1)
    expect(elapsedMs).toBeLessThan(1_000)
    expect(outputOf(result)).not.toContain('main-returned-without-exit')
  })

  test('成功入口不强制退出，调用方仍可继续执行', () => {
    const evaluation = `
      import { main } from ${JSON.stringify(pathToFileURL(scripts.devtoolsSmoke).href)};
      await main({ run: async () => {} });
      await new Promise((resolve) => setTimeout(resolve, 20));
      process.stdout.write('continued-after-success');
    `
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', evaluation], {
      cwd: projectRoot,
      encoding: 'utf8',
      env: cleanEnvironment(),
      timeout: 1_500,
    })

    expect(result.signal, outputOf(result)).toBeNull()
    expect(result.status, outputOf(result)).toBe(0)
    expect(outputOf(result)).toContain('continued-after-success')
  })
})

describe('ci:preview', () => {
  let temporaryDirectory: string
  let privateKeyPath: string

  beforeAll(() => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'sbh-mp-preview-test-'))
    privateKeyPath = join(temporaryDirectory, 'private.key')
    writeFileSync(privateKeyPath, 'test-only-key', { mode: 0o600 })
    chmodSync(privateKeyPath, 0o600)
  })

  afterAll(() => {
    rmSync(temporaryDirectory, { force: true, recursive: true })
  })

  test('缺少必填环境变量时 fail closed', () => {
    const result = runScript(scripts.preview)

    expect(result.status).not.toBe(0)
    expect(outputOf(result)).toContain('WECHAT_MINIPROGRAM_APPID')
  })

  test('拒绝 touristappid', () => {
    const result = runScript(scripts.preview, {
      ...cleanEnvironment(),
      WECHAT_MINIPROGRAM_APPID: 'touristappid',
      WECHAT_MINIPROGRAM_PRIVATE_KEY_PATH: privateKeyPath,
      WECHAT_MINIPROGRAM_ROBOT: '1',
      WECHAT_MINIPROGRAM_VERSION: '0.1.0',
    })

    expect(result.status).not.toBe(0)
    expect(outputOf(result)).toContain('正式 AppID')
  })

  test('私钥不存在时失败且不回显路径', () => {
    const secretPath = join(temporaryDirectory, 'secret-do-not-print.key')
    const result = runScript(scripts.preview, {
      ...cleanEnvironment(),
      WECHAT_MINIPROGRAM_APPID: 'wx1234567890abcdef',
      WECHAT_MINIPROGRAM_PRIVATE_KEY_PATH: secretPath,
      WECHAT_MINIPROGRAM_ROBOT: '1',
      WECHAT_MINIPROGRAM_VERSION: '0.1.0',
    })

    expect(result.status).not.toBe(0)
    expect(outputOf(result)).toContain('私钥文件')
    expect(outputOf(result)).not.toContain(secretPath)
  })

  test('拒绝使用版本库内的文件充当 CI 私钥', () => {
    const result = runScript(scripts.preview, {
      ...cleanEnvironment(),
      WECHAT_MINIPROGRAM_APPID: 'wx1234567890abcdef',
      WECHAT_MINIPROGRAM_PRIVATE_KEY_PATH: join(projectRoot, 'package.json'),
      WECHAT_MINIPROGRAM_ROBOT: '1',
      WECHAT_MINIPROGRAM_VERSION: '0.1.0',
    })

    expect(result.status).not.toBe(0)
    expect(outputOf(result)).toContain('版本库之外')
    expect(outputOf(result)).not.toContain(join(projectRoot, 'package.json'))
  })

  test('拒绝从版本库外用符号链接绕过私钥位置门', () => {
    const linkedKeyPath = join(temporaryDirectory, 'linked.key')
    symlinkSync(join(projectRoot, 'package.json'), linkedKeyPath)

    const result = runScript(scripts.preview, {
      ...cleanEnvironment(),
      WECHAT_MINIPROGRAM_APPID: 'wx1234567890abcdef',
      WECHAT_MINIPROGRAM_PRIVATE_KEY_PATH: linkedKeyPath,
      WECHAT_MINIPROGRAM_ROBOT: '0',
      WECHAT_MINIPROGRAM_VERSION: '0.1.0',
    })

    expect(result.status).not.toBe(0)
    expect(outputOf(result)).toContain('符号链接')
    expect(outputOf(result)).not.toContain(linkedKeyPath)
  })

  test.each(['0', '31', '1.5', 'abc'])('拒绝越界或非整数 robot=%s', (robot) => {
    const result = runScript(scripts.preview, {
      ...cleanEnvironment(),
      WECHAT_MINIPROGRAM_APPID: 'wx1234567890abcdef',
      WECHAT_MINIPROGRAM_PRIVATE_KEY_PATH: privateKeyPath,
      WECHAT_MINIPROGRAM_ROBOT: robot,
      WECHAT_MINIPROGRAM_VERSION: '0.1.0',
    })

    expect(result.status).not.toBe(0)
    expect(outputOf(result)).toContain('1 到 30')
  })

  test('缺少版本号时在加载 miniprogram-ci 前失败', () => {
    const result = runScript(scripts.preview, {
      ...cleanEnvironment(),
      WECHAT_MINIPROGRAM_APPID: 'wx1234567890abcdef',
      WECHAT_MINIPROGRAM_PRIVATE_KEY_PATH: privateKeyPath,
      WECHAT_MINIPROGRAM_ROBOT: '1',
    })

    expect(result.status).not.toBe(0)
    expect(outputOf(result)).toContain('WECHAT_MINIPROGRAM_VERSION')
  })

  test.each(['wxABCDEF1234567890', 'wx1234567890abcdeg', 'wx123'])(
    '拒绝非小写十六进制 AppID：%s',
    async (appid) => {
      const module = await import(pathToFileURL(scripts.preview).href)

      expect(() =>
        module.validatePreviewEnvironment({ WECHAT_MINIPROGRAM_APPID: appid }),
      ).toThrow('小写十六进制')
    },
  )

  test('拒绝权限过宽的私钥文件', async () => {
    const module = await import(pathToFileURL(scripts.preview).href)
    const broadKeyPath = join(temporaryDirectory, 'broad.key')
    writeFileSync(broadKeyPath, 'test-only-key', { mode: 0o644 })
    chmodSync(broadKeyPath, 0o644)

    expect(() =>
      module.validatePreviewEnvironment({
        WECHAT_MINIPROGRAM_APPID: 'wx1234567890abcdef',
        WECHAT_MINIPROGRAM_PRIVATE_KEY_PATH: broadKeyPath,
      }),
    ).toThrow('仅所有者可读写')
  })

  test.each([
    '01.2.3',
    '1.02.3',
    '1.2.03',
    '1.2',
    '1.2.3-',
    '1.2.3-alpha..1',
    '1.2.3-01',
  ])('拒绝不严格的 SemVer：%s', async (version) => {
    const module = await import(pathToFileURL(scripts.preview).href)

    expect(() =>
      module.validatePreviewEnvironment({
        WECHAT_MINIPROGRAM_APPID: 'wx1234567890abcdef',
        WECHAT_MINIPROGRAM_PRIVATE_KEY_PATH: privateKeyPath,
        WECHAT_MINIPROGRAM_ROBOT: '1',
        WECHAT_MINIPROGRAM_VERSION: version,
      }),
    ).toThrow('严格 SemVer')
  })

  test('显式二维码路径必须为仓外绝对新文件', async () => {
    const module = await import(pathToFileURL(scripts.preview).href)
    const commonEnvironment = {
      WECHAT_MINIPROGRAM_APPID: 'wx1234567890abcdef',
      WECHAT_MINIPROGRAM_PRIVATE_KEY_PATH: privateKeyPath,
      WECHAT_MINIPROGRAM_ROBOT: '1',
      WECHAT_MINIPROGRAM_VERSION: '1.2.3',
    }

    for (const outputPath of [
      'preview.jpg',
      join(projectRoot, 'preview.jpg'),
      join(temporaryDirectory, 'missing-parent', 'preview.jpg'),
    ]) {
      expect(() =>
        module.validatePreviewEnvironment({
          ...commonEnvironment,
          WECHAT_MINIPROGRAM_QRCODE_OUTPUT_PATH: outputPath,
        }),
      ).toThrow(/绝对路径|版本库之外|父目录/)
    }
  })

  test('拒绝已存在或符号链接的二维码输出目标', async () => {
    const module = await import(pathToFileURL(scripts.preview).href)
    const existingOutputPath = join(temporaryDirectory, 'existing.jpg')
    const linkedOutputPath = join(temporaryDirectory, 'linked-output.jpg')
    writeFileSync(existingOutputPath, 'do not overwrite')
    symlinkSync(existingOutputPath, linkedOutputPath)
    const commonEnvironment = {
      WECHAT_MINIPROGRAM_APPID: 'wx1234567890abcdef',
      WECHAT_MINIPROGRAM_PRIVATE_KEY_PATH: privateKeyPath,
      WECHAT_MINIPROGRAM_ROBOT: '1',
      WECHAT_MINIPROGRAM_VERSION: '1.2.3',
    }

    for (const outputPath of [existingOutputPath, linkedOutputPath]) {
      expect(() =>
        module.validatePreviewEnvironment({
          ...commonEnvironment,
          WECHAT_MINIPROGRAM_QRCODE_OUTPUT_PATH: outputPath,
        }),
      ).toThrow(/已存在|符号链接/)
    }
  })

  test('拒绝 group/other 可写的二维码父目录', async () => {
    const module = await import(pathToFileURL(scripts.preview).href)
    const writableByOthersDirectory = join(temporaryDirectory, 'world-writable')
    mkdirSync(writableByOthersDirectory, { mode: 0o777 })
    chmodSync(writableByOthersDirectory, 0o777)

    expect(() =>
      module.validatePreviewEnvironment({
        WECHAT_MINIPROGRAM_APPID: 'wx1234567890abcdef',
        WECHAT_MINIPROGRAM_PRIVATE_KEY_PATH: privateKeyPath,
        WECHAT_MINIPROGRAM_ROBOT: '1',
        WECHAT_MINIPROGRAM_VERSION: '1.2.3',
        WECHAT_MINIPROGRAM_QRCODE_OUTPUT_PATH: join(
          writableByOthersDirectory,
          'preview.jpg',
        ),
      }),
    ).toThrow('父目录权限')
  })

  test('私钥在校验与打开之间被替换时按 inode 拒绝且不调用 CI', async () => {
    const module = await import(pathToFileURL(scripts.preview).href)
    const raceKeyPath = join(temporaryDirectory, 'race.key')
    const originalKeyPath = join(temporaryDirectory, 'race-original.key')
    const qrcodeOutputDest = join(temporaryDirectory, 'race-preview.jpg')
    writeFileSync(raceKeyPath, 'original-private-key', { mode: 0o600 })
    chmodSync(raceKeyPath, 0o600)
    const environment = {
      WECHAT_MINIPROGRAM_APPID: 'wx1234567890abcdef',
      WECHAT_MINIPROGRAM_PRIVATE_KEY_PATH: raceKeyPath,
      WECHAT_MINIPROGRAM_ROBOT: '1',
      WECHAT_MINIPROGRAM_VERSION: '1.2.3',
      WECHAT_MINIPROGRAM_QRCODE_OUTPUT_PATH: qrcodeOutputDest,
    }
    const configuration = module.validatePreviewEnvironment(environment)
    renameSync(raceKeyPath, originalKeyPath)
    writeFileSync(raceKeyPath, 'replacement-private-key', { mode: 0o600 })
    chmodSync(raceKeyPath, 0o600)
    const preview = vi.fn()
    class Project {}
    const runner = module.createPreviewRunner({ ci: { preview, Project } })

    await expect(runner(environment, configuration)).rejects.toThrow('读取期间发生变化')
    expect(preview).not.toHaveBeenCalled()
    expect(existsSync(qrcodeOutputDest)).toBe(false)
  })

  test('假 CI 只写私有暂存目录，成功后再安全复制到显式最终路径', async () => {
    const module = await import(pathToFileURL(scripts.preview).href)
    const qrcodeOutputDest = join(temporaryDirectory, 'successful-preview.jpg')
    let projectOptions: Record<string, unknown> | undefined
    class Project {
      constructor(options: Record<string, unknown>) {
        projectOptions = options
      }
    }
    let stagingDirectory: string | undefined
    const preview = vi.fn().mockImplementation(async (options: { qrcodeOutputDest: string }) => {
      expect(options.qrcodeOutputDest).not.toBe(qrcodeOutputDest)
      expect(options.qrcodeOutputDest).toMatch(/\/stage\.jpg$/)
      expect(existsSync(qrcodeOutputDest)).toBe(false)
      stagingDirectory = dirname(options.qrcodeOutputDest)
      const stagingStats = lstatSync(stagingDirectory)
      expect(stagingStats.isDirectory()).toBe(true)
      expect(stagingStats.mode & 0o777).toBe(0o700)
      writeFileSync(options.qrcodeOutputDest, 'fake qrcode')
    })
    const runner = module.createPreviewRunner({ ci: { preview, Project } })
    const environment = {
      WECHAT_MINIPROGRAM_APPID: 'wx1234567890abcdef',
      WECHAT_MINIPROGRAM_PRIVATE_KEY_PATH: privateKeyPath,
      WECHAT_MINIPROGRAM_ROBOT: '7',
      WECHAT_MINIPROGRAM_VERSION: '1.2.3-alpha.1+build.5',
      WECHAT_MINIPROGRAM_QRCODE_OUTPUT_PATH: qrcodeOutputDest,
    }

    const result = await runner(environment)

    expect(projectOptions).toEqual(
      expect.objectContaining({
        appid: environment.WECHAT_MINIPROGRAM_APPID,
        privateKey: 'test-only-key',
        projectPath: projectRoot,
        type: 'miniProgram',
      }),
    )
    expect(projectOptions).not.toHaveProperty('privateKeyPath')
    expect(preview).toHaveBeenCalledWith(
      expect.objectContaining({
        desc: `SBH 小程序 ${environment.WECHAT_MINIPROGRAM_VERSION}`,
        pagePath: 'pages/foundation/index',
        qrcodeFormat: 'image',
        robot: 7,
      }),
    )
    expect(preview.mock.calls[0]?.[0].qrcodeOutputDest).not.toBe(qrcodeOutputDest)
    expect(preview.mock.calls[0]?.[0]).not.toHaveProperty('version')
    expect(result).toEqual({ qrcodeOutputDest, version: environment.WECHAT_MINIPROGRAM_VERSION })
    expect(existsSync(qrcodeOutputDest)).toBe(true)
    expect(readFileSync(qrcodeOutputDest, 'utf8')).toBe('fake qrcode')
    const finalStats = lstatSync(qrcodeOutputDest, { bigint: true })
    expect(finalStats.isFile()).toBe(true)
    expect(finalStats.mode & 0o777n).toBe(0o600n)
    expect(stagingDirectory && existsSync(stagingDirectory)).toBe(false)
  })

  test('假 CI 失败后始终清理私有暂存目录且不生成最终文件', async () => {
    const module = await import(pathToFileURL(scripts.preview).href)
    const qrcodeOutputDest = join(temporaryDirectory, 'failed-preview.jpg')
    class Project {}
    let stagingDirectory: string | undefined
    const preview = vi.fn().mockImplementation(async (options: { qrcodeOutputDest: string }) => {
      stagingDirectory = dirname(options.qrcodeOutputDest)
      writeFileSync(options.qrcodeOutputDest, 'partial qrcode')
      throw new Error('fake network secret detail')
    })
    const runner = module.createPreviewRunner({ ci: { preview, Project } })

    await expect(
      runner({
        WECHAT_MINIPROGRAM_APPID: 'wx1234567890abcdef',
        WECHAT_MINIPROGRAM_PRIVATE_KEY_PATH: privateKeyPath,
        WECHAT_MINIPROGRAM_ROBOT: '1',
        WECHAT_MINIPROGRAM_VERSION: '1.2.3',
        WECHAT_MINIPROGRAM_QRCODE_OUTPUT_PATH: qrcodeOutputDest,
      }),
    ).rejects.toThrow('fake network secret detail')
    expect(existsSync(qrcodeOutputDest)).toBe(false)
    expect(stagingDirectory && existsSync(stagingDirectory)).toBe(false)
  })

  test('假 CI 把暂存图替换为符号链接时拒绝复制并清理暂存目录', async () => {
    const module = await import(pathToFileURL(scripts.preview).href)
    const qrcodeOutputDest = join(temporaryDirectory, 'symlink-stage-preview.jpg')
    const outsideFile = join(temporaryDirectory, 'outside-stage-target.jpg')
    writeFileSync(outsideFile, 'must not be copied')
    let stagingDirectory: string | undefined
    class Project {}
    const preview = vi.fn().mockImplementation(async (options: { qrcodeOutputDest: string }) => {
      stagingDirectory = dirname(options.qrcodeOutputDest)
      symlinkSync(outsideFile, options.qrcodeOutputDest)
    })
    const runner = module.createPreviewRunner({ ci: { preview, Project } })

    await expect(
      runner({
        WECHAT_MINIPROGRAM_APPID: 'wx1234567890abcdef',
        WECHAT_MINIPROGRAM_PRIVATE_KEY_PATH: privateKeyPath,
        WECHAT_MINIPROGRAM_ROBOT: '1',
        WECHAT_MINIPROGRAM_VERSION: '1.2.3',
        WECHAT_MINIPROGRAM_QRCODE_OUTPUT_PATH: qrcodeOutputDest,
      }),
    ).rejects.toThrow(/暂存|安全打开/)
    expect(existsSync(qrcodeOutputDest)).toBe(false)
    expect(readFileSync(outsideFile, 'utf8')).toBe('must not be copied')
    expect(stagingDirectory && existsSync(stagingDirectory)).toBe(false)
  })

  test('CI 期间最终路径被占用时 O_EXCL 拒绝覆盖且清理暂存目录', async () => {
    const module = await import(pathToFileURL(scripts.preview).href)
    const qrcodeOutputDest = join(temporaryDirectory, 'raced-final-preview.jpg')
    let stagingDirectory: string | undefined
    class Project {}
    const preview = vi.fn().mockImplementation(async (options: { qrcodeOutputDest: string }) => {
      stagingDirectory = dirname(options.qrcodeOutputDest)
      writeFileSync(options.qrcodeOutputDest, 'fake qrcode')
      writeFileSync(qrcodeOutputDest, 'occupied by another process')
    })
    const runner = module.createPreviewRunner({ ci: { preview, Project } })

    await expect(
      runner({
        WECHAT_MINIPROGRAM_APPID: 'wx1234567890abcdef',
        WECHAT_MINIPROGRAM_PRIVATE_KEY_PATH: privateKeyPath,
        WECHAT_MINIPROGRAM_ROBOT: '1',
        WECHAT_MINIPROGRAM_VERSION: '1.2.3',
        WECHAT_MINIPROGRAM_QRCODE_OUTPUT_PATH: qrcodeOutputDest,
      }),
    ).rejects.toThrow(/原子创建|已存在/)
    expect(readFileSync(qrcodeOutputDest, 'utf8')).toBe('occupied by another process')
    expect(stagingDirectory && existsSync(stagingDirectory)).toBe(false)
  })

  test('真实入口在动态导入 miniprogram-ci 前先做轻量配置校验', () => {
    const source = readFileSync(scripts.preview, 'utf8')
    const entry = source.slice(source.indexOf('export async function runPreview'))

    expect(entry.indexOf('validatePreviewEnvironment')).toBeGreaterThanOrEqual(0)
    expect(entry.indexOf('validatePreviewEnvironment')).toBeLessThan(
      entry.indexOf("import('miniprogram-ci')"),
    )
  })
})

describe('package scripts 安全边界', () => {
  test('预览只由显式 ci:preview 命令触发', () => {
    const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }

    expect(packageJson.scripts['ci:preview']).toBe('node scripts/preview.mjs')

    for (const [name, command] of Object.entries(packageJson.scripts)) {
      if (name === 'ci:preview') continue
      expect(command, `${name} 不得触发 preview 或 miniprogram-ci`).not.toMatch(
        /preview\.mjs|miniprogram-ci|ci:preview/,
      )
    }
  })

  test('独立小程序质量工作流只运行本地质量门且不接触发布能力', () => {
    const workflowPath = resolve(
      projectRoot,
      '..',
      '.github/workflows/miniprogram-quality.yml',
    )
    const workflow = readFileSync(workflowPath, 'utf8')

    expect(workflow).toContain("'sbh-miniprogram/**'")
    expect(workflow).toContain("'.github/workflows/miniprogram-quality.yml'")
    expect(workflow).toMatch(/node-version:\s*['\"]?22['\"]?/)
    expect(workflow).toMatch(/version:\s*8\.6\.1/)
    expect(workflow).toContain('pnpm install --frozen-lockfile')
    expect(workflow).toContain('pnpm test')
    expect(workflow).toContain('pnpm typecheck')
    expect(workflow).toContain('pnpm project:check')
    const triggerBlock = workflow.slice(workflow.indexOf('on:'), workflow.indexOf('permissions:'))
    expect(triggerBlock.match(/^  [a-z_]+:/gm)).toEqual(['  push:', '  pull_request:'])
    expect(workflow).not.toMatch(
      /workflow_dispatch|ci:preview|preview\.mjs|miniprogram-ci|upload|deploy|secrets\./i,
    )
  })
})
