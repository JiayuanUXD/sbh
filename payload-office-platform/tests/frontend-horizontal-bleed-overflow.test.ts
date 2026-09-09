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
 * 居中后每侧探出 7.67px：
 *
 *     documentElement.clientWidth          1425
 *     .hm-home 的 getBoundingClientRect()  left -7.67 / right 1432.33 / width 1440
 *
 * 当时只有 `body` 那条 clip，**它不生效**：body 的 overflow 只有在根元素为
 * `visible` 时才会被提升到视口，而提升之后 body 自己按 `visible` 用（等于没裁），
 * 被提升上去的 `clip` 又不消除视口的可滚动性。于是：
 *
 *     documentElement.scrollLeft = 9999  →  读回 8   ← 用户真能横向拖 8px
 *
 * 四组对照（视口 1920 / clientWidth 1905，1440 与 768 同结论；375 走覆盖式
 * 滚动条，滚动条宽 0，本就不复现）：
 *
 *     html visible + body clip     →  8   ← 修复前
 *     html clip    + body visible  →  8
 *     html clip    + body clip     →  0   ← 现在
 *     html hidden  + body clip     →  0   （但 hidden 会让根元素变成滚动容器）
 *
 * 所以修复是**给根元素补一条**，不是把 body 那条挪走。谁把 body 那条删了，
 * 故障原样复发。
 *
 * ## 为什么必须是文本断言，E2E 顶不上
 *
 * `tests/e2e/detail-pages.spec.ts` 早就在 1440 / 1920 上断言
 * `documentElement.scrollWidth <= clientWidth`，却从没红过——因为
 * **headless Chromium 的滚动条宽度是 0**（已实测：viewport 1440 下
 * `innerWidth 1440 / clientWidth 1440 / scrollbarWidth 0`）。滚动条不占布局，
 * `100vw` 就恒等于 `clientWidth`，那条断言在这一类缺陷上**结构性地不可能失败**。
 * 这个 bug 只在有经典滚动条的真实浏览器里存在，只能靠守「写法」来防。
 *
 * 要把行为守卫也补上，得让 E2E 以带经典滚动条的方式跑（headful 或强制非覆盖式
 * 滚动条），那是另一件事；在那之前，本文件是唯一会红的地方。
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
