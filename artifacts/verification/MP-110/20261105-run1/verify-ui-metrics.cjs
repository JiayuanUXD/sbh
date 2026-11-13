// 仅采集当前微信模拟器的实际布局与生效颜色。点按与真机证据另行记录。
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { createHash } = require('node:crypto')
const { pathToFileURL } = require('node:url')

const root = path.resolve(process.env.TARGET_ROOT || path.join(__dirname, '../../../../sbh-miniprogram'))
const expectedWidth = Number(process.env.MP110_VIEWPORT)
const screenHeights = new Map([[375, 667], [390, 844], [430, 932]])

async function requireElement(page, selector) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const element = await page.$(selector)
    if (element) return element
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(`微信节点缺失：${selector}`)
}

async function box(element) {
  const [{ width, height }, offset] = await Promise.all([element.size(), element.offset()])
  const left = offset.left ?? offset.x
  const top = offset.top ?? offset.y
  if (![width, height, left, top].every(Number.isFinite) || width <= 0 || height <= 0) {
    throw new Error('微信节点返回无效尺寸或坐标')
  }
  return { left, top, width, height }
}

function luminance(color) {
  const channels = /^#[0-9a-f]{6}$/i.test(color)
    ? color.slice(1).match(/../g).map(channel => parseInt(channel, 16))
    : /^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*1(?:\.0+)?)?\s*\)$/.exec(color)?.slice(1).map(Number)
  if (!channels || channels.some(channel => channel > 255)) throw new Error(`无法测量颜色：${color}`)
  const [r, g, b] = channels.map(channel => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function fingerprint(directory) {
  const digest = createHash('sha256')
  for (const name of fs.readdirSync(directory, { recursive: true }).sort()) {
    const file = path.join(directory, name)
    if (fs.statSync(file).isFile()) digest.update(name).update('\0').update(fs.readFileSync(file)).update('\0')
  }
  return digest.digest('hex')
}

async function sample(mini, screenshotDir, width) {
  const sizes = []
  const colors = []
  const bars = []
  const take = name => mini.screenshot({ path: path.join(screenshotDir, `${name}.png`) })
  async function measure(page, selector) {
    return recordSize(selector, await requireElement(page, selector))
  }
  async function recordSize(selector, element) {
    const rect = await box(element)
    sizes.push({ selector, ...rect, pass: rect.width >= 44 && rect.height >= 44 })
    return rect
  }
  async function contrast(page, selector, backgroundSelector = selector) {
    const elements = await page.$$(selector)
    if (!elements.length) throw new Error(`微信颜色采样节点缺失：${selector}`)
    const background = await (await requireElement(page, backgroundSelector)).style('background-color')
    for (const element of elements) {
      const foreground = await element.style('color')
      if (!foreground || !background) throw new Error(`微信颜色采样缺失：${selector} (${foreground}) / ${backgroundSelector} (${background})`)
      const a = luminance(foreground)
      const b = luminance(background)
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
      colors.push({ selector, backgroundSelector, foreground, background, ratio, pass: ratio >= 4.5 })
    }
  }
  const home = await mini.reLaunch('/pages/home/index')
  await measure(home, '.home-search__submit')
  await measure(home, '.home-buildings__all')
  await home.setData({ refreshError: true })
  await requireElement(home, '.home-refresh-error')
  await contrast(home, '.home-refresh-error')
  await take('home-refresh-error')

  const listings = await mini.switchTab('/pages/listings/index')
  await measure(listings, '.listings-search-input')
  await measure(listings, '.listings-summary__sort')
  await take('listings')

  const buildings = await mini.switchTab('/pages/buildings/index')
  const filters = await buildings.$$('.buildings-filter-item')
  const filterNames = ['区域', '等级', '排序']
  if (filters.length !== filterNames.length) throw new Error('楼盘筛选入口数量与验收要求不一致')
  let previousRight = 0
  for (const [index, element] of filters.entries()) {
    const rect = await recordSize(`.buildings-filter-item (${filterNames[index]})`, element)
    if (rect.left < previousRight - 0.5) throw new Error('楼盘筛选入口重叠或采样重复')
    previousRight = rect.left + rect.width
  }
  await requireElement(buildings, '.buildings-inactive-desc')
  await contrast(buildings, '.buildings-inactive-title', '.buildings-page')
  await contrast(buildings, '.buildings-inactive-desc', '.buildings-page')
  await take('buildings')

  const building = await mini.navigateTo('/pages/building-detail/index?slug=heng-long-plaza')
  await requireElement(building, '.building-stat-label')
  await contrast(building, '.building-stat-label', '.building-stats-card')
  await contrast(building, '.building-group-title', '.building-listings-card')
  await take('building-detail')

  const profile = await mini.switchTab('/pages/profile/index')
  await measure(profile, '.profile-connect-error__action')
  await take('profile-error')

  const detail = await mini.navigateTo('/pages/listing-detail/index?slug=jingan-kerry-center-300sqm')
  for (const state of ['ready', 'stale']) {
    if (state === 'stale') await detail.setData({ state })
    await requireElement(detail, '.listing-detail__bar-fav')
    if ((await detail.data()).state !== state) throw new Error(`房源详情未进入 ${state} 状态`)
    const selectors = ['.listing-detail__bar-fav', '.listing-detail__bar-action--share', '.listing-detail__bar-action--inquiry']
    const controls = []
    for (const selector of selectors) controls.push(await box(await requireElement(detail, selector)))
    const gaps = controls.slice(1).map((rect, index) => rect.left - controls[index].left - controls[index].width)
    const pass = gaps.every(gap => gap >= 4) && controls.every(rect =>
      rect.left >= 0 && rect.left + rect.width <= width && rect.width >= 44 && rect.height >= 44)
    bars.push({ state, controls, gaps, pass })
    await take(`listing-detail-${state}`)
  }
  return { sizes, colors, bars }
}

async function main() {
  const source = path.join(root, 'miniprogram')
  const config = path.join(root, 'project.config.json')
  if (!fs.existsSync(path.join(source, 'app.json')) || !fs.existsSync(config)) {
    throw new Error(`小程序源码或项目配置不存在：${root}`)
  }
  if (!screenHeights.has(expectedWidth)) {
    console.log(JSON.stringify({ verdict: 'INCOMPLETE', reason: '请先在微信开发者工具选定机型，并指定 MP110_VIEWPORT=375、390 或 430' }))
    process.exitCode = 2
    return
  }
  const cliPath = process.env.WECHAT_DEVTOOLS_CLI || '/Applications/wechatwebdevtools.app/Contents/MacOS/cli'
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'mp110-wechat-project-'))
  let server
  let mini
  try {
    fs.cpSync(source, path.join(project, 'miniprogram'), { recursive: true })
    fs.copyFileSync(config, path.join(project, 'project.config.json'))
    const sourceFingerprint = fingerprint(path.join(project, 'miniprogram'))
    const { createAcceptanceServer, ACCEPTANCE_FIXTURE_ID } = await import(pathToFileURL(path.join(root, 'scripts/acceptance-mock-server.mjs')))
    // 端口已占用时停止采样，避免把请求发到其他本地项目。
    server = await createAcceptanceServer(3717)
    const servedPaths = new Set()
    server.server.on('request', (request, response) => {
      response.once('finish', () => {
        if (request.method === 'GET' && response.statusCode === 200) {
          servedPaths.add(request.url.split('?')[0])
        }
      })
    })
    const automator = require(path.join(root, 'node_modules/miniprogram-automator'))
    mini = await automator.launch({ cliPath, projectPath: project, timeout: 20000, trustProject: true })
    if (!mini) throw new Error('微信开发者工具自动化未连接')
    const { windowWidth, screenHeight, SDKVersion } = await mini.systemInfo()
    if (windowWidth !== expectedWidth || screenHeight !== screenHeights.get(expectedWidth)) {
      throw new Error(`实际屏幕为 ${windowWidth}×${screenHeight}，与要求的机型不一致`)
    }
    const screenshotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp110-wechat-evidence-'))
    const metrics = await sample(mini, screenshotDir, windowWidth)
    const requiredPaths = [
      '/api/mini/v1/home', '/api/mini/v1/listings', '/api/mini/v1/buildings',
      '/api/mini/v1/buildings/heng-long-plaza', '/api/mini/v1/listings/jingan-kerry-center-300sqm',
    ]
    if (!requiredPaths.every(endpoint => servedPaths.has(endpoint))) {
      throw new Error(`微信页面未命中预期 Mock 路由：${requiredPaths.filter(endpoint => !servedPaths.has(endpoint)).join(', ')}`)
    }
    if (fingerprint(path.join(project, 'miniprogram')) !== sourceFingerprint || fingerprint(source) !== sourceFingerprint) {
      throw new Error('采样过程中小程序源码发生变化')
    }
    const pass = [...metrics.sizes, ...metrics.colors, ...metrics.bars].every(result => result.pass)
    console.log(JSON.stringify({
      verdict: pass ? 'PASS' : 'FAIL', scope: '微信模拟器几何与颜色',
      viewport: { width: windowWidth, height: screenHeight }, SDKVersion, sourceFingerprint,
      fixture: { id: ACCEPTANCE_FIXTURE_ID, paths: requiredPaths }, screenshotDir, ...metrics,
    }))
    if (!pass) process.exitCode = 1
  } finally {
    try {
      if (mini) await mini.close()
    } finally {
      if (server) await server.close()
      fs.rmSync(project, { recursive: true, force: true })
    }
  }
}

main().catch(error => {
  console.error(error.message)
  process.exitCode = 1
})
