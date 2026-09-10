/**
 * 全幅出血横向溢出验证探针。
 *
 * 产出 artifacts/verification/frontend-horizontal-scroll-clip/probe.output.json，
 * 与同目录 README.md 的每个数字一一对应。README 不自证——这支脚本才是事实源
 * （.agent/testing.md「证据质量」第 1 条）。
 *
 * ## 必须关掉 --hide-scrollbars，否则这个缺陷测不到
 *
 * Playwright headless 默认带 `--hide-scrollbars`，滚动条宽度为 0，`100vw` 就恒等于
 * `documentElement.clientWidth`，出血盒不再探出，缺陷**结构性地无法复现**。
 * 实测：默认 `clientWidth 1440 / scrollbarWidth 0`；关掉后 `1425 / 15`。
 * 这正是 tests/e2e/detail-pages.spec.ts 早就在 1440 / 1920 断言
 * `scrollWidth <= clientWidth`、却从没红过的原因。
 *
 * 用法（需要先起 dev server 或 next start）：
 *     pnpm dev                                             # 另开一个终端
 *     node scripts/verify-horizontal-bleed-overflow.mjs
 *     BASE_URL=http://localhost:3000 node scripts/verify-horizontal-bleed-overflow.mjs
 *
 * 退出码 0 = 全部通过；1 = 有失败项（详见 stdout 与 JSON 的 failures 段）。
 *
 * ## BASE_URL 指不到 CloudBase 测试域名
 *
 * `https://sbh-*.sh.run.tcloudbase.com` 是 CloudBase 的**测试域名**，对真实浏览器
 * 返回「风险提醒」拦截页（HTTP 404 + 「确定访问」按钮），要点过才放行；
 * `curl` 不跑 JS，拿到的是真实 HTML，于是会出现「curl 200、浏览器全超时」这种
 * 看起来像页面坏了的假象（2026-09-10 实测踩过，接着整个浏览器 Target crashed）。
 * 所以本探针只能指向本地 dev / `next start`，或指向已接入的正式自定义域名。
 * 想验生产，要么配自定义域名，要么由人在浏览器里点过拦截页后手工核对。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'

const BASE = process.env.BASE_URL || 'http://localhost:3717'
// 相对脚本自身定位，避免「从哪个目录运行」影响产物落点
const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.resolve(HERE, '../../artifacts/verification/frontend-horizontal-scroll-clip')

/**
 * 五处 `width: 100vw` 出血点各取一个真实消费路由。marker 用来证明页面真渲染了。
 *
 * alignsWithHeader：该页容器是否应与页眉容器逐像素相同。
 *   - 四个出血壳页走 `.site-main:has(...)` 取消限宽，容器与页眉共用同一个 `100%`，
 *     必须相同——这条就是 7.5px 错位的回归守卫。
 *   - recruit 例外：`--rc-w` 有意是 1024（552+72+400 的推导值，见 recruit.css 文件头），
 *     与页眉的 --container-max 本就不同宽，只要求居中一致。
 *   - landing 例外：`.landing-hero` 仍是 100vw 出血（父级有需要限宽的兄弟）。
 */
const ROUTES = [
  { name: 'home', url: '/shanghai', marker: '.hm-home', alignsWithHeader: true },
  { name: 'list', url: '/shanghai/listings', marker: '.ls-page', alignsWithHeader: true },
  { name: 'detail', url: '/shanghai/listings/changning-hongqiao-serviced', marker: '.dt-page', alignsWithHeader: true },
  { name: 'coming-soon', url: '/hangzhou', marker: '.rc-page', alignsWithHeader: false },
  { name: 'recruit', url: '/city-partner', marker: '.rc-page', alignsWithHeader: false },
  { name: 'landing', url: '/entrust', marker: '.landing-hero', alignsWithHeader: false },
]
const VIEWPORTS = [375, 768, 1440, 1920]
const CONTAINERS = '.hm-container, .ls-container, .dt-container, .rc-container, .landing-hero__inner'

/** 在页面里跑：量几何 + 找出真正会顶到视口的溢出元素。 */
const measure = ([markerSel, containerSel]) => {
  const d = document.documentElement
  const cw = d.clientWidth
  d.scrollLeft = 9999
  const maxScrollLeft = d.scrollLeft
  d.scrollLeft = 0

  const rect = (el) => {
    if (!el) return null
    const b = el.getBoundingClientRect()
    return { left: +b.left.toFixed(2), right: +b.right.toFixed(2), width: +b.width.toFixed(2) }
  }
  // 内层横滑轨道（.hm-rail 等）自带 overflow，不向视口贡献溢出，必须排除，
  // 否则会把一堆合法的轨道子元素误报成缺陷。
  const contained = (el) => {
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      if (getComputedStyle(a).overflowX !== 'visible') return true
    }
    return false
  }
  const offenders = []
  for (const el of document.querySelectorAll('body *')) {
    const b = el.getBoundingClientRect()
    if (b.width === 0 && b.height === 0) continue
    if ((b.right > cw + 0.5 || b.left < -0.5) && !contained(el)) {
      offenders.push({
        tag: el.tagName.toLowerCase(),
        cls: (typeof el.className === 'string' ? el.className : '').slice(0, 60),
        left: +b.left.toFixed(2),
        right: +b.right.toFixed(2),
      })
    }
  }

  const shellRect = rect(document.querySelector(markerSel))
  return {
    innerWidth: window.innerWidth,
    clientWidth: cw,
    scrollbarWidth: window.innerWidth - cw,
    maxScrollLeft,
    htmlOverflowX: getComputedStyle(d).overflowX,
    bodyOverflowX: getComputedStyle(document.body).overflowX,
    shell: shellRect,
    // 出血带必须覆盖整个可视宽度（左边缘 <= 0 且右边缘 >= clientWidth）
    bandCoversViewport: shellRect ? shellRect.left <= 0.5 && shellRect.right >= cw - 0.5 : null,
    // 左右探出量之差，衡量出血带是否居中（应约等于 0）
    bandAsymmetry: shellRect
      ? +Math.abs(Math.abs(shellRect.left) - Math.abs(shellRect.right - cw)).toFixed(2)
      : null,
    container: rect(document.querySelector(containerSel)),
    headerInner: rect(document.querySelector('.site-header__inner')),
    hasSupport: CSS.supports('selector(:has(> div))'),
    siteMainMaxWidth: getComputedStyle(document.querySelector('.site-main')).maxWidth,
    uncontainedOverflowCount: offenders.length,
    uncontainedOverflowTop: offenders.slice(0, 5),
  }
}

/**
 * html/body 的 overflow-x 四组组合，证明这对 clip「两条缺一不可」。
 *
 * **必须在 `/entrust` 上跑，不能用首页。** 四个出血壳页已经改走
 * `.site-main:has(...)` 取消限宽，`width: auto` 后根本不溢出，在那里切 overflow-x
 * 四组恒为 0，什么也证明不了。`.landing-hero` 是全站仅剩的 `100vw` 出血
 * （父级有需要限宽的兄弟，见 styles.css），也就是这对 clip 现在唯一的服务对象。
 */
const mechanism = async (page) => {
  const combos = [
    ['visible', 'clip', '这对 clip 修复前的状态：能横向拖'],
    ['clip', 'visible', '只有根元素那条，同样能拖'],
    ['clip', 'clip', '现在：两条都在'],
    ['hidden', 'clip', 'hidden 会让根元素变成滚动容器、吸顶失效，不能用'],
  ]
  const out = []
  for (const [h, b, note] of combos) {
    const r = await page.evaluate(
      ([hv, bv]) => {
        let s = document.getElementById('__probe')
        if (!s) {
          s = document.createElement('style')
          s.id = '__probe'
          document.head.appendChild(s)
        }
        s.textContent = 'html{overflow-x:' + hv + '}body{overflow-x:' + bv + '}'
        const d = document.documentElement
        d.scrollLeft = 9999
        const max = d.scrollLeft
        d.scrollLeft = 0
        return { maxScrollLeft: max, docScrollWidth: d.scrollWidth, clientWidth: d.clientWidth }
      },
      [h, b],
    )
    out.push({ html: h, body: b, note, ...r })
  }
  await page.evaluate(() => {
    const s = document.getElementById('__probe')
    if (s) s.remove()
  })
  return out
}

const run = async () => {
  // 关掉 --hide-scrollbars，恢复经典滚动条；不关就测不到（见文件头注释）
  const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] })
  const report = {
    baseUrl: BASE,
    generatedAt: new Date().toISOString(),
    note: '滚动条宽度须为 15；若为 0 说明 --hide-scrollbars 未关闭，本报告不作数',
    routes: {},
    mechanism: null,
    sticky: null,
  }
  const failures = []

  for (const route of ROUTES) {
    report.routes[route.name] = {}
    for (const width of VIEWPORTS) {
      const page = await browser.newPage({ viewport: { width, height: 900 } })
      let status = 0
      let markerPresent = false
      let attempts = 0
      let pageTitle = ''
      // 重试一次：dev server 首次编译某路由时偶发导航失败（实测 home@768 出过一次
      // HTTP 0，重跑即好）。证据必须可复现，不能靠「再跑一遍碰运气」。
      for (attempts = 1; attempts <= 2 && !markerPresent; attempts++) {
        try {
          // 不用 networkidle：dev server 的 HMR websocket 可能永不静默
          const res = await page.goto(BASE + route.url, { waitUntil: 'domcontentloaded', timeout: 120000 })
          status = res ? res.status() : 0
          // 先证明页面真的渲染了：状态码 + 该路由特有的选择器
          //（.agent/testing.md 证据质量第 2 条：拿两张 404 页比出过「0 差异像素」的空结论）
          // 用 attached 而不是默认的 visible：出血壳只是布局容器，远程慢网下等
          // "可见"会被首屏大图拖到超时；几何量的是布局盒，attached 就够。
          await page.waitForSelector(route.marker, { state: 'attached', timeout: 60000 })
          markerPresent = true
        } catch {
          markerPresent = (await page.locator(route.marker).count()) > 0
        }
      }
      try {
        pageTitle = await page.title()
      } catch {
        pageTitle = ''
      }
      if (status !== 200) failures.push(route.name + '@' + width + ': HTTP ' + status)
      if (!markerPresent) {
        // 把标题带上：页面「不是被测页面」和「被测页面坏了」是两回事，只报选择器
        // 缺失会把前者误导成后者。实测踩过：CloudBase 测试域名对真实浏览器返回
        // 「风险提醒」拦截页（HTTP 404 + 确定访问按钮），curl 不跑 JS 看不到，
        // 于是"curl 200 但浏览器全超时"，一度像是页面坏了。
        failures.push(
          route.name + '@' + width + ': 缺选择器 ' + route.marker + '（HTTP ' + status + '，标题「' + pageTitle + '」）',
        )
      }

      let m = null
      if (status === 200 && markerPresent) {
        m = await page.evaluate(measure, [route.marker, CONTAINERS])
        if (m.scrollbarWidth === 0 && width >= 768) {
          failures.push(route.name + '@' + width + ': 滚动条宽度为 0，--hide-scrollbars 未关闭')
        }
        if (m.maxScrollLeft !== 0) {
          failures.push(route.name + '@' + width + ': 可横向拖动 ' + m.maxScrollLeft + 'px')
        }
        if (m.bandCoversViewport === false) {
          failures.push(route.name + '@' + width + ': 出血带未覆盖可视宽度')
        }
        // 7.5px 错位的回归守卫：出血壳页的容器必须与页眉容器逐像素相同
        if (route.alignsWithHeader && m.container && m.headerInner) {
          const dl = +(m.container.left - m.headerInner.left).toFixed(2)
          const dw = +(m.container.width - m.headerInner.width).toFixed(2)
          if (dl !== 0 || dw !== 0) {
            failures.push(
              route.name + '@' + width + ': 容器与页眉错位 left 差 ' + dl + ' / width 差 ' + dw,
            )
          }
        }
      }
      report.routes[route.name][width] = {
        url: route.url,
        status,
        markerPresent,
        marker: route.marker,
        pageTitle,
        navAttempts: attempts - 1,
        ...(m || {}),
      }
      await page.close()
    }
  }

  // 机制对照在 /entrust 上做（全站仅剩的 100vw 出血，见 mechanism 的注释）
  const mechPage = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  try {
    await mechPage.goto(BASE + '/entrust', { waitUntil: 'domcontentloaded', timeout: 120000 })
    await mechPage.waitForSelector('.landing-hero', { state: 'attached', timeout: 60000 })
    report.mechanism = { page: '/entrust', viewport: 1440, combos: await mechanism(mechPage) }
    if (report.mechanism.combos[0].maxScrollLeft === 0) {
      // 对照组失效就等于没有对照组：这多半是 /entrust 也不再溢出了，
      // 说明该换个还在用 100vw 的页面，而不是默默报通过。
      failures.push('机制对照失效：/entrust 的 html visible + body clip 未复现横向溢出')
    }
  } catch (e) {
    report.mechanism = { page: '/entrust', viewport: 1440, error: String(e).slice(0, 200), combos: [] }
    failures.push('机制对照未能执行：' + String(e).slice(0, 120))
  }
  await mechPage.close()

  // 纵向滚动 / 吸顶回归在首页 1440 上做
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(BASE + '/shanghai', { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.waitForSelector('.hm-home', { timeout: 15000 })
  report.sticky = await page.evaluate(() => {
    const d = document.documentElement
    d.scrollTop = 800
    const applied = d.scrollTop
    const h = document.querySelector('.site-header')
    const top = h ? +h.getBoundingClientRect().top.toFixed(2) : null
    d.scrollTop = 0
    return { verticalScrollWorks: applied === 800, scrollTopApplied: applied, headerTopWhileScrolled: top }
  })
  if (!report.sticky.verticalScrollWorks) failures.push('纵向滚动失效')
  if (report.sticky.headerTopWhileScrolled !== 0) failures.push('吸顶头部失效')
  await page.close()
  await browser.close()

  report.failures = failures
  report.passed = failures.length === 0
  mkdirSync(OUT, { recursive: true })
  writeFileSync(path.join(OUT, 'probe.output.json'), JSON.stringify(report, null, 2) + '\n', 'utf8')

  const sample = report.routes.home && report.routes.home[1440]
  console.log('滚动条宽度(home@1440):', sample ? sample.scrollbarWidth : 'n/a', '（应为 15）')
  console.log('机制对照（' + report.mechanism.page + ' @' + report.mechanism.viewport + '）:')
  for (const c of report.mechanism.combos) {
    console.log('  html:' + c.html.padEnd(8) + ' body:' + c.body.padEnd(8) + ' -> maxScrollLeft ' + c.maxScrollLeft + '  ' + c.note)
  }
  console.log(failures.length ? '✗ 失败 ' + failures.length + ' 项:\n  ' + failures.join('\n  ') : '✓ 全部通过')
  process.exit(failures.length ? 1 : 0)
}

// 顶层兜底：以前这里什么都没有，机制那步一抛异常整个进程就崩，**连已经跑完的
// 路由结果都不落盘**——远程跑一次几分钟，结果一点证据都没留下。现在无论怎么炸，
// 都先把已收集到的部分写进 probe.output.json 再退出。
run().catch((e) => {
  try {
    mkdirSync(OUT, { recursive: true })
    writeFileSync(
      path.join(OUT, 'probe.crash.json'),
      JSON.stringify({ crashedAt: new Date().toISOString(), baseUrl: BASE, error: String(e) }, null, 2) + '\n',
      'utf8',
    )
  } catch {
    // 写不了就算了，下面的 stderr 才是主要出口
  }
  console.error('探针异常退出：' + String(e).slice(0, 300))
  process.exit(1)
})
