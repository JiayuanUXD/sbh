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
  upload: join(projectRoot, 'scripts/upload.mjs'),
  mp109SheetAcceptance: join(projectRoot, 'scripts/mp109-sheet-acceptance-runner.mjs'),
}

const previewVariableNames = [
  'WECHAT_MINIPROGRAM_APPID',
  'WECHAT_MINIPROGRAM_PRIVATE_KEY_PATH',
  'WECHAT_MINIPROGRAM_ROBOT',
  'WECHAT_MINIPROGRAM_VERSION',
  'WECHAT_MINIPROGRAM_QRCODE_OUTPUT_PATH',
] as const

const uploadVariableNames = [
  'WECHAT_MINIPROGRAM_EXPECTED_COMMIT',
  'WECHAT_MINIPROGRAM_UPLOAD_REPORT_PATH',
  'TRIAL_CLOUD_ENV_ID',
  'TRIAL_CLOUD_SERVICE_NAME',
  'TRIAL_SERVER_DEPLOYMENT_REVISION',
] as const

function cleanEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env }

  for (const name of previewVariableNames) {
    delete environment[name]
  }
  for (const name of uploadVariableNames) {
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
  test('静态检查覆盖详情页四件套与可信详情 ready marker', () => {
    const source = readFileSync(scripts.checkProject, 'utf8')

    expect(source).toContain("'pages/listing-detail/index'")
    expect(source).toMatch(/\['pages\/listing-detail\/index',\s*'listing-detail-ready'\]/)
  })

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

describe('MP-109 sheet acceptance runner', () => {
  test('缺 DevTools 环境时只允许写 environment-unavailable，不得假绿', async () => {
    expect(existsSync(scripts.mp109SheetAcceptance)).toBe(true)
    if (!existsSync(scripts.mp109SheetAcceptance)) return
    const module = await import('../scripts/mp109-sheet-acceptance-runner.mjs' as never) as {
      buildEnvironmentUnavailableProfile(
        name: 'small' | 'large',
        reason: string,
      ): Readonly<{ status: string; reason: string; states: unknown }>
    }
    const report = module.buildEnvironmentUnavailableProfile('small', 'DevTools CLI not found')

    expect(report).toMatchObject({
      status: 'environment-unavailable',
      reason: 'DevTools CLI not found',
      states: {},
    })
    expect(JSON.stringify(report)).not.toMatch(/"passed":true/)
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

  test('真实冒烟入口用精确 XPath 跨组件边界读取原生卡片 slug 后进入详情页', async () => {
    const module = await import(pathToFileURL(scripts.devtoolsSmoke).href)
    const detailPage = { path: 'pages/listing-detail/index', query: { slug: 'listing-one' }, $: vi.fn().mockResolvedValue({ id: 'listing-detail-ready' }) }
    const listingCard = { attribute: vi.fn().mockResolvedValue('listing-one') }
    const listingsPage = {
      path: 'pages/listings/index',
      $: vi.fn().mockImplementation(async (selector: string) => selector === '#listings-ready'
        ? { id: 'listings-ready' }
        : null),
      xpath: vi.fn().mockResolvedValue(listingCard),
    }
    const homePage = { path: 'pages/home/index', $: vi.fn().mockResolvedValue({ id: 'home-ready' }) }
    const miniProgram = Object.assign(new EventEmitter(), {
      reLaunch: vi.fn()
        .mockResolvedValueOnce(homePage)
        .mockResolvedValueOnce(detailPage),
      switchTab: vi.fn().mockResolvedValue(listingsPage),
      close: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
    })
    const runner = module.createDevtoolsSmokeRunner({
      automator: { launch: vi.fn().mockResolvedValue(miniProgram) },
      includeDetail: true,
      pollIntervalMs: 1,
      timeouts: { acceptanceMs: 1, closeMs: 20, launchMs: 20, readyMs: 20, routeMs: 20 },
    })

    await runner({ WECHAT_DEVTOOLS_CLI: executableCliPath })
    expect(listingsPage.$).toHaveBeenCalledTimes(1)
    expect(listingsPage.$).toHaveBeenCalledWith('#listings-ready')
    expect(listingsPage.$).not.toHaveBeenCalledWith('[data-listing-slug]')
    expect(listingsPage.xpath).toHaveBeenCalledWith('//*[contains(@class, "listing-card") and @data-slug]')
    expect(listingCard.attribute).toHaveBeenCalledWith('data-slug')
    expect(miniProgram.reLaunch).toHaveBeenNthCalledWith(2, '/pages/listing-detail/index?slug=listing-one')
    expect(detailPage.$).toHaveBeenCalledWith('#listing-detail-ready')
  })

  test('首条房源暂缺时在总 deadline 内轮询，随后用 pathname/query 验证详情', async () => {
    const module = await import(pathToFileURL(scripts.devtoolsSmoke).href)
    let listingQueries = 0
    const listingsPage = {
      path: 'pages/listings/index',
      $: vi.fn().mockImplementation(async (selector: string) => selector === '#listings-ready' ? {} : null),
      xpath: vi.fn().mockImplementation(async () => {
        listingQueries += 1
        return listingQueries < 2 ? null : { attribute: vi.fn().mockResolvedValue('listing-two') }
      }),
    }
    const detailPage = { path: 'pages/listing-detail/index', query: { slug: 'listing-two' }, $: vi.fn().mockResolvedValue({}) }
    const miniProgram = Object.assign(new EventEmitter(), {
      reLaunch: vi.fn().mockResolvedValueOnce({ path: 'pages/home/index', $: vi.fn().mockResolvedValue({}) }).mockResolvedValueOnce(detailPage),
      switchTab: vi.fn().mockResolvedValue(listingsPage),
      close: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
    })
    const runner = module.createDevtoolsSmokeRunner({ automator: { launch: vi.fn().mockResolvedValue(miniProgram) }, includeDetail: true, pollIntervalMs: 1, timeouts: { acceptanceMs: 1, closeMs: 20, launchMs: 20, readyMs: 20, routeMs: 20, listingSlugMs: 50 } })
    await runner({ WECHAT_DEVTOOLS_CLI: executableCliPath })
    expect(listingQueries).toBe(2)
    expect(detailPage.$).toHaveBeenCalledWith('#listing-detail-ready')
  })

  test('详情 pathname 正确但 query.slug 缺失或不匹配时失败并清理', async () => {
    const module = await import(pathToFileURL(scripts.devtoolsSmoke).href)
    const listingsPage = {
      path: 'pages/listings/index',
      $: vi.fn().mockImplementation(async (selector: string) => selector === '#listings-ready' ? {} : null),
      xpath: vi.fn().mockResolvedValue({ attribute: vi.fn().mockResolvedValue('listing-three') }),
    }
    const detailPage = { path: 'pages/listing-detail/index', query: {}, $: vi.fn() }
    const miniProgram = Object.assign(new EventEmitter(), {
      reLaunch: vi.fn().mockResolvedValueOnce({ path: 'pages/home/index', $: vi.fn().mockResolvedValue({}) }).mockResolvedValueOnce(detailPage),
      switchTab: vi.fn().mockResolvedValue(listingsPage), close: vi.fn().mockResolvedValue(undefined), disconnect: vi.fn(),
    })
    const runner = module.createDevtoolsSmokeRunner({ automator: { launch: vi.fn().mockResolvedValue(miniProgram) }, includeDetail: true, pollIntervalMs: 1, timeouts: { acceptanceMs: 1, closeMs: 20, launchMs: 20, readyMs: 20, routeMs: 20, listingSlugMs: 20 } })
    await expect(runner({ WECHAT_DEVTOOLS_CLI: executableCliPath })).rejects.toThrow('房源详情页查询参数不匹配')
    expect(miniProgram.close).toHaveBeenCalledOnce()
  })

  test.each([
    ['首条房源查询', '首条房源查询超时'],
    ['首条房源 slug 属性', '首条房源 slug 属性超时'],
  ] as const)('%s挂起时在明确超时后失败并清理', async (label, expectedMessage) => {
    const module = await import(pathToFileURL(scripts.devtoolsSmoke).href)
    const listingsPage = {
      path: 'pages/listings/index',
      $: vi.fn().mockImplementation(async (selector: string) => selector === '#listings-ready'
        ? { id: 'listings-ready' }
        : null),
      xpath: vi.fn().mockImplementation(async () => {
        if (label === '首条房源查询') return new Promise(() => {})
        return { attribute: () => new Promise(() => {}) }
      }),
    }
    const miniProgram = Object.assign(new EventEmitter(), {
      reLaunch: vi.fn().mockResolvedValueOnce({ path: 'pages/home/index', $: vi.fn().mockResolvedValue({}) }).mockResolvedValueOnce({ path: 'pages/listing-detail/index', query: { slug: 'x' }, $: vi.fn() }),
      switchTab: vi.fn().mockResolvedValue(listingsPage),
      close: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
    })
    const runner = module.createDevtoolsSmokeRunner({
      automator: { launch: vi.fn().mockResolvedValue(miniProgram) },
      includeDetail: true,
      timeouts: { acceptanceMs: 1, closeMs: 20, launchMs: 20, readyMs: 20, routeMs: 20, listingSlugMs: 5 },
    })

    await expect(runner({ WECHAT_DEVTOOLS_CLI: executableCliPath })).rejects.toThrow(expectedMessage)
    expect(miniProgram.close).toHaveBeenCalledOnce()
  })

  test('读取首条 slug 期间 runtime exception 竞速失败并清理', async () => {
    const module = await import(pathToFileURL(scripts.devtoolsSmoke).href)
    const miniProgram = Object.assign(new EventEmitter(), {
      reLaunch: vi.fn().mockResolvedValueOnce({ path: 'pages/home/index', $: vi.fn().mockResolvedValue({}) }).mockResolvedValueOnce({ path: 'pages/listing-detail/index?slug=x', $: vi.fn() }),
      switchTab: vi.fn().mockResolvedValue({
        path: 'pages/listings/index',
        $: vi.fn().mockImplementation(async (selector: string) => selector === '#listings-ready' ? {} : null),
        xpath: vi.fn().mockImplementation(async () => {
          setTimeout(() => miniProgram.emit('exception'), 1)
          return { attribute: () => new Promise(() => {}) }
        }),
      }),
      close: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
    })
    const runner = module.createDevtoolsSmokeRunner({
      automator: { launch: vi.fn().mockResolvedValue(miniProgram) },
      includeDetail: true,
      timeouts: { acceptanceMs: 1, closeMs: 20, launchMs: 20, readyMs: 20, routeMs: 20, listingSlugMs: 50 },
    })

    await expect(runner({ WECHAT_DEVTOOLS_CLI: executableCliPath })).rejects.toThrow('运行时异常')
    expect(miniProgram.close).toHaveBeenCalledOnce()
  })

  test('XPath 查询与 attribute 读取共享同一个绝对 deadline', async () => {
    vi.useFakeTimers()
    try {
      const module = await import(pathToFileURL(scripts.devtoolsSmoke).href)
      const attribute = vi.fn(() => new Promise(() => {}))
      const listingsPage = {
        path: 'pages/listings/index',
        $: vi.fn().mockImplementation(async (selector: string) => selector === '#listings-ready' ? {} : null),
        xpath: vi.fn().mockImplementation(async () => {
          await new Promise((resolve) => setTimeout(resolve, 15))
          return { attribute }
        }),
      }
      const miniProgram = Object.assign(new EventEmitter(), {
        reLaunch: vi.fn().mockResolvedValueOnce({ path: 'pages/home/index', $: vi.fn().mockResolvedValue({}) }),
        switchTab: vi.fn().mockResolvedValue(listingsPage),
        close: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn(),
      })
      const runner = module.createDevtoolsSmokeRunner({ automator: { launch: vi.fn().mockResolvedValue(miniProgram) }, includeDetail: true, pollIntervalMs: 1, timeouts: { acceptanceMs: 1, closeMs: 20, launchMs: 20, readyMs: 20, routeMs: 20, listingSlugMs: 20 } })
      let outcome: { error?: unknown; settled: boolean } = { settled: false }
      const runPromise = runner({ WECHAT_DEVTOOLS_CLI: executableCliPath }).then(
        () => { outcome = { settled: true } },
        (error: unknown) => { outcome = { error, settled: true } },
      )

      await vi.advanceTimersByTimeAsync(2)
      expect(listingsPage.xpath).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(15)
      expect(attribute).toHaveBeenCalledWith('data-slug')
      expect(outcome.settled).toBe(false)
      await vi.advanceTimersByTimeAsync(4)
      expect(outcome.settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      await runPromise

      expect(outcome.settled).toBe(true)
      expect(outcome.error).toEqual(expect.objectContaining({ message: '首条房源 slug 属性超时' }))
      expect(miniProgram.close).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
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

describe('ci:upload', () => {
  let temporaryDirectory: string
  let privateKeyPath: string

  const expectedCommit = '8eab1a17cfe5800d1778fbad2d47cf4c54542d87'
  const cloudEnvId = 'sbhmini-gateway-d3fbrmn8097478b8'
  const cloudServiceName = 'sbhmini'
  const serverDeploymentRevision = 'sbhmini-005'
  const manifest = {
    cloudEnvId,
    cloudServiceName,
    gitCommitSha: expectedCommit,
    serverDeploymentRevision,
  }
  const cleanSnapshot = { dirtyPaths: [], headSha: expectedCommit, manifest }
  const generatedManifestSnapshot = {
    dirtyPaths: ['miniprogram/config/trial-deployment.generated.ts'],
    headSha: expectedCommit,
    manifest,
  }

  function uploadEnvironment(reportPath: string): NodeJS.ProcessEnv {
    return {
      ...cleanEnvironment(),
      TRIAL_CLOUD_ENV_ID: cloudEnvId,
      TRIAL_CLOUD_SERVICE_NAME: cloudServiceName,
      TRIAL_SERVER_DEPLOYMENT_REVISION: serverDeploymentRevision,
      WECHAT_MINIPROGRAM_APPID: 'wx1234567890abcdef',
      WECHAT_MINIPROGRAM_EXPECTED_COMMIT: expectedCommit,
      WECHAT_MINIPROGRAM_PRIVATE_KEY_PATH: privateKeyPath,
      WECHAT_MINIPROGRAM_ROBOT: '1',
      WECHAT_MINIPROGRAM_UPLOAD_REPORT_PATH: reportPath,
      WECHAT_MINIPROGRAM_VERSION: '1.2.3',
    }
  }

  beforeAll(() => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'sbh-mp-upload-test-'))
    privateKeyPath = join(temporaryDirectory, 'private.key')
    writeFileSync(privateKeyPath, 'test-only-key', { mode: 0o600 })
    chmodSync(privateKeyPath, 0o600)
  })

  afterAll(() => {
    rmSync(temporaryDirectory, { force: true, recursive: true })
  })

  test('缺少必填环境变量时 fail closed', () => {
    const result = runScript(scripts.upload)

    expect(result.status).not.toBe(0)
    expect(outputOf(result)).toContain('WECHAT_MINIPROGRAM_APPID')
  })

  test('拒绝 touristappid', () => {
    const result = runScript(scripts.upload, {
      ...uploadEnvironment(join(temporaryDirectory, 'tourist-report.json')),
      WECHAT_MINIPROGRAM_APPID: 'touristappid',
    })

    expect(result.status).not.toBe(0)
    expect(outputOf(result)).toContain('正式 AppID')
  })

  test('私钥不存在时失败且不回显路径', () => {
    const secretPath = join(temporaryDirectory, 'secret-do-not-print.key')
    const result = runScript(scripts.upload, {
      ...uploadEnvironment(join(temporaryDirectory, 'missing-key-report.json')),
      WECHAT_MINIPROGRAM_PRIVATE_KEY_PATH: secretPath,
    })

    expect(result.status).not.toBe(0)
    expect(outputOf(result)).toContain('私钥文件')
    expect(outputOf(result)).not.toContain(secretPath)
  })

  test('拒绝使用版本库内的文件充当 CI 私钥', () => {
    const result = runScript(scripts.upload, {
      ...uploadEnvironment(join(temporaryDirectory, 'inside-repo-key-report.json')),
      WECHAT_MINIPROGRAM_PRIVATE_KEY_PATH: join(projectRoot, 'package.json'),
    })

    expect(result.status).not.toBe(0)
    expect(outputOf(result)).toContain('版本库之外')
    expect(outputOf(result)).not.toContain(join(projectRoot, 'package.json'))
  })

  test('拒绝从版本库外用符号链接绕过私钥位置门', () => {
    const linkedKeyPath = join(temporaryDirectory, 'linked.key')
    symlinkSync(join(projectRoot, 'package.json'), linkedKeyPath)

    const result = runScript(scripts.upload, {
      ...uploadEnvironment(join(temporaryDirectory, 'linked-key-report.json')),
      WECHAT_MINIPROGRAM_PRIVATE_KEY_PATH: linkedKeyPath,
    })

    expect(result.status).not.toBe(0)
    expect(outputOf(result)).toContain('符号链接')
    expect(outputOf(result)).not.toContain(linkedKeyPath)
  })

  test.each(['0', '31', '1.5', 'abc'])('拒绝越界或非整数 robot=%s', (robot) => {
    const result = runScript(scripts.upload, {
      ...uploadEnvironment(join(temporaryDirectory, `robot-${robot}-report.json`)),
      WECHAT_MINIPROGRAM_ROBOT: robot,
    })

    expect(result.status).not.toBe(0)
    expect(outputOf(result)).toContain('1 到 30')
  })

  test('缺少版本号时在加载 miniprogram-ci 前失败', () => {
    const result = runScript(scripts.upload, {
      ...uploadEnvironment(join(temporaryDirectory, 'no-version-report.json')),
      WECHAT_MINIPROGRAM_VERSION: '',
    })

    expect(result.status).not.toBe(0)
    expect(outputOf(result)).toContain('WECHAT_MINIPROGRAM_VERSION')
  })

  test.each(['01.2.3', '1.02.3', '1.2.03', '1.2', '1.2.3-', '1.2.3-alpha..1', '1.2.3-01'])(
    '拒绝不严格的 SemVer：%s',
    async (version) => {
      const module = await import(pathToFileURL(scripts.upload).href)

      expect(() =>
        module.validateUploadEnvironment(
          {
            WECHAT_MINIPROGRAM_APPID: 'wx1234567890abcdef',
            WECHAT_MINIPROGRAM_PRIVATE_KEY_PATH: privateKeyPath,
            WECHAT_MINIPROGRAM_ROBOT: '1',
            WECHAT_MINIPROGRAM_VERSION: version,
          },
          cleanSnapshot,
        ),
      ).toThrow('严格 SemVer')
    },
  )

  test('报告路径必须是仓外绝对 .json 新文件', async () => {
    const module = await import(pathToFileURL(scripts.upload).href)

    for (const outputPath of [
      'report.json',
      join(projectRoot, 'report.json'),
      join(temporaryDirectory, 'missing-parent', 'report.json'),
      join(temporaryDirectory, 'report.png'),
    ]) {
      expect(() =>
        module.validateUploadEnvironment(uploadEnvironment(outputPath), cleanSnapshot),
      ).toThrow(/绝对路径|版本库之外|父目录|\.json 扩展名/)
    }
  })

  test('拒绝已存在或符号链接的报告输出目标', async () => {
    const module = await import(pathToFileURL(scripts.upload).href)
    const existingOutputPath = join(temporaryDirectory, 'existing-report.json')
    const linkedOutputPath = join(temporaryDirectory, 'linked-report.json')
    writeFileSync(existingOutputPath, 'do not overwrite')
    symlinkSync(existingOutputPath, linkedOutputPath)

    for (const outputPath of [existingOutputPath, linkedOutputPath]) {
      expect(() =>
        module.validateUploadEnvironment(uploadEnvironment(outputPath), cleanSnapshot),
      ).toThrow(/已存在|符号链接/)
    }
  })

  test('拒绝 group/other 可写的报告父目录', async () => {
    const module = await import(pathToFileURL(scripts.upload).href)
    const writableByOthersDirectory = join(temporaryDirectory, 'upload-world-writable')
    mkdirSync(writableByOthersDirectory, { mode: 0o777 })
    chmodSync(writableByOthersDirectory, 0o777)

    expect(() =>
      module.validateUploadEnvironment(
        uploadEnvironment(join(writableByOthersDirectory, 'report.json')),
        cleanSnapshot,
      ),
    ).toThrow('父目录权限')
  })

  test('期望 commit 与当前 HEAD 不一致时拒绝', async () => {
    const module = await import(pathToFileURL(scripts.upload).href)
    const environment = uploadEnvironment(join(temporaryDirectory, 'commit-mismatch.json'))
    const otherCommit = 'a'.repeat(40)

    expect(() =>
      module.validateUploadEnvironment(environment, {
        dirtyPaths: [],
        headSha: otherCommit,
        manifest,
      }),
    ).toThrow('目标 Git commit SHA 与当前 HEAD 不一致')
  })

  test('工作树存在非 manifest 改动时拒绝上传', async () => {
    const module = await import(pathToFileURL(scripts.upload).href)
    const environment = uploadEnvironment(join(temporaryDirectory, 'dirty-tree.json'))

    expect(() =>
      module.validateUploadEnvironment(environment, {
        dirtyPaths: [
          'miniprogram/config/trial-deployment.generated.ts',
          'miniprogram/pages/home/index.ts',
        ],
        headSha: expectedCommit,
        manifest,
      }),
    ).toThrow('上传只允许从干净快照进行')
  })

  test('已生成的 trial manifest 改动不阻止上传', async () => {
    const module = await import(pathToFileURL(scripts.upload).href)
    const reportPath = join(temporaryDirectory, 'generated-manifest-ok.json')

    const configuration = module.validateUploadEnvironment(
      uploadEnvironment(reportPath),
      generatedManifestSnapshot,
    )

    expect(configuration).toEqual(
      expect.objectContaining({
        cloudEnvId,
        cloudServiceName,
        gitCommitSha: expectedCommit,
        serverDeploymentRevision,
      }),
    )
  })

  test('空 manifest 或身份不符的 manifest 阻止上传', async () => {
    const module = await import(pathToFileURL(scripts.upload).href)
    const environment = uploadEnvironment(join(temporaryDirectory, 'bad-manifest.json'))

    for (const candidate of [
      { cloudEnvId: '', cloudServiceName: '', gitCommitSha: '', serverDeploymentRevision: '' },
      { ...manifest, serverDeploymentRevision: 'sbhmini-004' },
      { ...manifest, cloudEnvId: 'sbhmini-d5g7d6732b2c64a66' },
      { ...manifest, gitCommitSha: 'b'.repeat(40) },
    ]) {
      expect(() =>
        module.validateUploadEnvironment(environment, {
          dirtyPaths: ['miniprogram/config/trial-deployment.generated.ts'],
          headSha: expectedCommit,
          manifest: candidate,
        }),
      ).toThrow('trial manifest 与目标 staging 身份不一致')
    }
  })

  test('trial cloud env/service 与受控 staging 不一致时拒绝', async () => {
    const module = await import(pathToFileURL(scripts.upload).href)
    const reportPath = join(temporaryDirectory, 'wrong-env.json')

    expect(() =>
      module.validateUploadEnvironment(
        { ...uploadEnvironment(reportPath), TRIAL_CLOUD_ENV_ID: 'sbhmini-d5g7d6732b2c64a66' },
        generatedManifestSnapshot,
      ),
    ).toThrow('trial cloud env 与受控 staging 不一致')

    expect(() =>
      module.validateUploadEnvironment(
        { ...uploadEnvironment(reportPath), TRIAL_CLOUD_SERVICE_NAME: 'other-service' },
        generatedManifestSnapshot,
      ),
    ).toThrow('trial cloud service 与受控 staging 不一致')
  })

  test('假 CI 上传成功后写出不含凭据的仓外报告', async () => {
    const module = await import(pathToFileURL(scripts.upload).href)
    const reportPath = join(temporaryDirectory, 'successful-upload-report.json')
    let projectOptions: Record<string, unknown> | undefined
    class Project {
      constructor(options: Record<string, unknown>) {
        projectOptions = options
      }
    }
    const upload = vi.fn().mockResolvedValue({
      subPackageInfo: [{ name: '__APP__', size: 1024 }],
      pluginInfo: [],
    })
    const configuration = module.validateUploadEnvironment(
      uploadEnvironment(reportPath),
      generatedManifestSnapshot,
    )
    const runner = module.createUploadRunner({ ci: { upload, Project } })

    const result = await runner(uploadEnvironment(reportPath), configuration)

    expect(projectOptions).toEqual(
      expect.objectContaining({
        appid: 'wx1234567890abcdef',
        privateKey: 'test-only-key',
        projectPath: projectRoot,
        type: 'miniProgram',
      }),
    )
    expect(projectOptions).not.toHaveProperty('privateKeyPath')
    expect(upload).toHaveBeenCalledWith(
      expect.objectContaining({
        desc: 'SBH 小程序 1.2.3 (8eab1a1)',
        robot: 1,
        version: '1.2.3',
      }),
    )
    expect(upload.mock.calls[0]?.[0]).not.toHaveProperty('qrcodeOutputDest')
    expect(result).toEqual({ gitCommitSha: expectedCommit, reportPath, version: '1.2.3' })

    const reportContents = readFileSync(reportPath, 'utf8')
    expect(reportContents).not.toContain('test-only-key')
    expect(reportContents).not.toContain(privateKeyPath)
    const reportStats = lstatSync(reportPath, { bigint: true })
    expect(reportStats.mode & 0o777n).toBe(0o600n)
    expect(JSON.parse(reportContents)).toEqual(
      expect.objectContaining({
        appid: 'wx1234567890abcdef',
        cloudEnvId,
        cloudServiceName,
        gitCommitSha: expectedCommit,
        pluginInfo: [],
        serverDeploymentRevision,
        subPackageInfo: [{ name: '__APP__', size: 1024 }],
        version: '1.2.3',
      }),
    )
  })

  test('假 CI 上传失败时不生成报告', async () => {
    const module = await import(pathToFileURL(scripts.upload).href)
    const reportPath = join(temporaryDirectory, 'failed-upload-report.json')
    class Project {}
    const upload = vi.fn().mockRejectedValue(new Error('fake network secret detail'))
    const configuration = module.validateUploadEnvironment(
      uploadEnvironment(reportPath),
      generatedManifestSnapshot,
    )
    const runner = module.createUploadRunner({ ci: { upload, Project } })

    await expect(runner(uploadEnvironment(reportPath), configuration)).rejects.toThrow(
      'fake network secret detail',
    )
    expect(existsSync(reportPath)).toBe(false)
  })

  test('私钥在校验与打开之间被替换时按 inode 拒绝且不调用 CI', async () => {
    const module = await import(pathToFileURL(scripts.upload).href)
    const raceKeyPath = join(temporaryDirectory, 'race.key')
    const originalKeyPath = join(temporaryDirectory, 'race-original.key')
    const reportPath = join(temporaryDirectory, 'race-upload-report.json')
    writeFileSync(raceKeyPath, 'original-private-key', { mode: 0o600 })
    chmodSync(raceKeyPath, 0o600)
    const environment = {
      ...uploadEnvironment(reportPath),
      WECHAT_MINIPROGRAM_PRIVATE_KEY_PATH: raceKeyPath,
    }
    const configuration = module.validateUploadEnvironment(environment, generatedManifestSnapshot)
    renameSync(raceKeyPath, originalKeyPath)
    writeFileSync(raceKeyPath, 'replacement-private-key', { mode: 0o600 })
    chmodSync(raceKeyPath, 0o600)
    const upload = vi.fn()
    class Project {}
    const runner = module.createUploadRunner({ ci: { upload, Project } })

    await expect(runner(environment, configuration)).rejects.toThrow('读取期间发生变化')
    expect(upload).not.toHaveBeenCalled()
    expect(existsSync(reportPath)).toBe(false)
  })

  test('真实入口在动态导入 miniprogram-ci 前先做轻量配置校验', () => {
    const source = readFileSync(scripts.upload, 'utf8')
    const entry = source.slice(source.indexOf('export async function runUpload'))

    expect(entry.indexOf('validateUploadEnvironment')).toBeGreaterThanOrEqual(0)
    expect(entry.indexOf('validateUploadEnvironment')).toBeLessThan(
      entry.indexOf("import('miniprogram-ci')"),
    )
  })
})

describe('package scripts 安全边界', () => {
  test('预览与上传只由显式 ci:preview / ci:upload 命令触发', () => {
    const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }

    expect(packageJson.scripts['ci:preview']).toBe('node scripts/preview.mjs')
    expect(packageJson.scripts['ci:upload']).toBe('node scripts/upload.mjs')

    for (const [name, command] of Object.entries(packageJson.scripts)) {
      if (name === 'ci:preview' || name === 'ci:upload') continue
      expect(command, `${name} 不得触发 preview/upload 或 miniprogram-ci`).not.toMatch(
        /preview\.mjs|upload\.mjs|miniprogram-ci|ci:preview|ci:upload/,
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
