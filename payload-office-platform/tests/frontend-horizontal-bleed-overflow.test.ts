import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * 守卫：全幅出血带来的横向溢出，`html` 与 `body` 上的 `overflow-x: clip`
 * **两条都要在**，缺一不可。
 *
 * ## 本来的故障（2026-09-09 实测，本地 dev，经典滚动条 15px）
 *
 * 全站五处 `width: 100vw` 出血（`.hm-home` / `.ls-page` / `.dt-page` /
 * `.rc-page` / `.landing-hero`）都要从 `.site-main` 的 `max-width: 1440` +
 * `padding-inline: 24` 里破出来。`100vw` **含**滚动条宽度而
 * `documentElement.clientWidth` 不含，配合 `margin-inline: calc(50% - 50vw)`
 * 居中后每侧探出 7.5px：
 *
 *     documentElement.clientWidth          1425
 *     .hm-home 的 getBoundingClientRect()  left -7.5 / right 1432.5 / width 1440
 *
 * 当时只有 `body` 那条 clip，**它不生效**：body 的 overflow 只有在根元素为
 * `visible` 时才会被提升到视口，而提升之后 body 自己按 `visible` 用（等于没裁），
 * 被提升上去的 `clip` 又不消除视口的可滚动性。于是：
 *
 *     documentElement.scrollLeft = 9999  →  读回 8   ← 用户真能横向拖 8px
 *
 * 四组对照（视口 1920 / clientWidth 1905）。375 / 768 / 1440 / 1920 四档同结论
 * ——判据是**滚动条占不占布局宽度**而非视口大小：经典滚动条（桌面窗口，含
 * 375px 宽的窄窗口）恒复现；覆盖式滚动条（真机与浏览器的移动端模拟）宽 0，
 * `100vw` 恰好等于 `clientWidth`，本就不复现：
 *
 *     html visible + body clip     →  8   ← 修复前
 *     html clip    + body visible  →  8
 *     html clip    + body clip     →  0   ← 现在
 *     html hidden  + body clip     →  0   （但 hidden 会让根元素变成滚动容器）
 *
 * 所以修复是**给根元素补一条**，不是把 body 那条挪走。谁把 body 那条删了，
 * 故障原样复发。
 *
 * ## 为什么现有 E2E 没能发现，以及本文件与探针的分工
 *
 * `tests/e2e/detail-pages.spec.ts` 早就在 1440 / 1920 上断言
 * `documentElement.scrollWidth <= clientWidth`，却从没红过——**Playwright headless
 * 默认带 `--hide-scrollbars`，滚动条宽度为 0**（实测 viewport 1440 下
 * `innerWidth 1440 / clientWidth 1440 / scrollbarWidth 0`）。滚动条不占布局，
 * `100vw` 就恒等于 `clientWidth`，那条断言在这一类缺陷上不可能失败。
 *
 * 注意这是**默认配置**的限制，不是 headless 的固有限制：
 * `chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] })` 就能恢复 15px
 * 经典滚动条并如实复现（同一测点读回 8）。行为验证因此是可行的，见
 * `scripts/verify-horizontal-bleed-overflow.mjs`——它跑五路由 × 四视口，
 * 并把上面那张四组对照表当场重算一遍，产出
 * `artifacts/verification/frontend-horizontal-scroll-clip/probe.output.json`。
 *
 * 分工：那支探针需要起 dev server，属人工/按需运行；本文件是**进 pre-push 闸门**
 * 的那一半，只守「写法」，零依赖、毫秒级。两者都在，改错才会当场红。
 */

const ROOT = 'src/app/(frontend)'
const base = readFileSync(`${ROOT}/styles.css`, 'utf8')

/** 取顶层 `html { ... }` / `body { ... }` 规则体（媒体查询里的同名规则不参与）。 */
const RULE = {
  html: /^html\s*\{([^}]*)\}/m,
  body: /^body\s*\{([^}]*)\}/m,
}

const ruleBody = (css: string, selector: 'html' | 'body'): string => {
  const m = css.match(RULE[selector])
  if (!m) throw new Error(`styles.css 里找不到顶层 ${selector} 规则`)
  return m[1]
}

describe('全幅出血的横向溢出裁剪', () => {
  it('根元素带 overflow-x: clip', () => {
    // 缺了它，body 那条会被提升到视口而失效，全站恢复可横向拖 8px。
    expect(ruleBody(base, 'html')).toMatch(/overflow-x:\s*clip/)
  })

  it('body 也带 overflow-x: clip —— 真正做裁剪的是它', () => {
    // 根元素那条负责「阻止提升」，实际把出血盒裁掉的是 body 这条。两条是一对。
    expect(ruleBody(base, 'body')).toMatch(/overflow-x:\s*clip/)
  })

  it('根元素用的是 clip 不是 hidden —— hidden 会让它变成滚动容器，吸顶失效', () => {
    // `overflow-x: hidden` 会把 `overflow-y` 的 visible 连带升成 auto，
    // 根元素成为滚动容器后 `.site-header` / `.dt-bar` 的 position: sticky 当场失效。
    expect(ruleBody(base, 'html')).not.toMatch(/overflow-x:\s*hidden/)
  })

  it('出血点仍是已知的五处 —— 新增一处就来读这里', () => {
    // 每一处 `width: 100vw` 都会往视口贡献半条滚动条的探出。现在探出被上面那
    // 一对 clip 裁掉了，所以新增出血点**不会**再制造横向拖动；这条断言不是防
    // 溢出，而是保证「出血点清单」与上面那段注释不悄悄脱节。
    const files = readdirSync(ROOT, { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.css'))
      .map((f) => `${ROOT}/${f.split(path.sep).join('/')}`)

    const sites = files.flatMap((f) =>
      [...readFileSync(f, 'utf8').matchAll(/^\s*[^\n*]*width:\s*100vw/gm)].map(() => f),
    )

    expect(sites.sort()).toEqual(
      [
        `${ROOT}/styles.css`, // .landing-hero
        `${ROOT}/styles/detail.css`, // .dt-page
        `${ROOT}/styles/home.css`, // .hm-home
        `${ROOT}/styles/list.css`, // .ls-page
        `${ROOT}/styles/recruit.css`, // .rc-page
      ].sort(),
    )
  })
})
