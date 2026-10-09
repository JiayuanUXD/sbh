import { spawnSync } from 'node:child_process'
import { accessSync, constants, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDirectory, '..')

function fail(message) {
  throw new Error(message)
}

function readJson(relativePath) {
  const absolutePath = join(projectRoot, relativePath)

  try {
    return JSON.parse(readFileSync(absolutePath, 'utf8'))
  } catch {
    return fail(`${relativePath} 缺失或不是合法 JSON`)
  }
}

function assertFile(relativePath) {
  try {
    accessSync(join(projectRoot, relativePath), constants.R_OK)
  } catch {
    fail(`缺少可读文件：${relativePath}`)
  }
}

export function assertSupportedNodeVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)

  if (!match) {
    fail('无法识别当前 Node.js 版本')
  }

  const major = Number(match[1])
  const minor = Number(match[2])

  if (major !== 22 || minor < 12) {
    fail('需要 Node.js >=22.12 且 <23')
  }
}

function assertPrivateFilesIgnored() {
  const candidates = [
    'project.private.config.json',
    'verification-only.key',
    'verification-only.pem',
    'verification-only.p12',
  ]

  for (const candidate of candidates) {
    const result = spawnSync(
      'git',
      ['check-ignore', '--no-index', '--quiet', join(projectRoot, candidate)],
      { cwd: projectRoot, encoding: 'utf8' },
    )

    if (result.status !== 0) {
      fail(`敏感文件忽略规则未覆盖：${candidate}`)
    }
  }
}

export function checkProject() {
  assertSupportedNodeVersion(process.versions.node)

  const packageJson = readJson('package.json')
  if (packageJson.engines?.node !== '>=22.12 <23') {
    fail('package.json 的 Node.js 版本边界不正确')
  }

  const projectConfig = readJson('project.config.json')
  if (projectConfig.miniprogramRoot !== 'miniprogram/') {
    fail('project.config.json 的 miniprogramRoot 不正确')
  }
  if (projectConfig.compileType !== 'miniprogram') {
    fail('project.config.json 的 compileType 不正确')
  }
  if (projectConfig.appid !== 'touristappid') {
    fail('仓库配置必须使用 touristappid，正式 AppID 仅放本机私有配置')
  }
  if (!projectConfig.setting?.useCompilerPlugins?.includes('typescript')) {
    fail('project.config.json 未启用 TypeScript 编译插件')
  }

  const appConfig = readJson('miniprogram/app.json')
  const expectedPages = [
    'pages/home/index',
    'pages/listings/index',
    'pages/buildings/index',
    'pages/building-detail/index',
    'pages/listing-detail/index',
    'pages/foundation/index',
    'pages/profile/index',
  ]
  if (
    !Array.isArray(appConfig.pages) ||
    appConfig.pages.length !== expectedPages.length ||
    appConfig.pages.some((page, index) => page !== expectedPages[index])
  ) {
    fail('miniprogram/app.json 必须按首页、找房、楼盘、楼盘详情、房源详情、foundation、我的的顺序注册页面')
  }

  const expectedTabs = [
    { pagePath: 'pages/home/index', text: '首页' },
    { pagePath: 'pages/listings/index', text: '找房' },
    { pagePath: 'pages/buildings/index', text: '楼盘' },
    { pagePath: 'pages/profile/index', text: '我的' },
  ]
  const tabList = appConfig.tabBar?.list
  if (
    !Array.isArray(tabList) ||
    tabList.length !== expectedTabs.length ||
    tabList.some(
      (item, index) =>
        item?.pagePath !== expectedTabs[index].pagePath || item?.text !== expectedTabs[index].text,
    )
  ) {
    fail('miniprogram/app.json 的 tabBar 必须包含首页、找房、楼盘和我的')
  }

  for (const pagePath of expectedPages) {
    for (const extension of ['ts', 'json', 'wxml', 'wxss']) {
      assertFile(`miniprogram/${pagePath}.${extension}`)
    }
  }

  for (const [pagePath, marker] of [
    ['pages/home/index', 'home-ready'],
    ['pages/listings/index', 'listings-ready'],
    ['pages/buildings/index', 'buildings-ready'],
    ['pages/building-detail/index', 'building-detail-ready'],
    ['pages/listing-detail/index', 'listing-detail-ready'],
    ['pages/profile/index', 'profile-ready'],
  ]) {
    const markup = readFileSync(join(projectRoot, `miniprogram/${pagePath}.wxml`), 'utf8')
    if (!markup.includes(`id="${marker}"`)) {
      fail(`${pagePath} 缺少 #${marker} 自动化就绪标记`)
    }
  }

  assertPrivateFilesIgnored()
}

export function main() {
  try {
    checkProject()
    console.log('SBH 小程序工程静态检查通过')
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    console.error(`工程静态检查失败：${message}`)
    process.exitCode = 1
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main()
}
