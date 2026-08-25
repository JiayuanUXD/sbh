import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * 容器宽度契约。
 *
 * 这批断言守的是一条**跨四个文件**的不变量：页眉页脚 / 首页 / 列表 / 详情
 * 的内容容器必须同宽同源。它曾经不成立——页眉 1180、列表 1280，1440 视口下
 * 每侧错位 50px，而没有任何测试会红。
 *
 * 为什么用文本断言而不是渲染测：容器宽度是 CSS 变量层层派生出来的，
 * 真值只在浏览器里存在。E2E（tests/e2e/detail-pages.spec.ts）已经在 6 个视口
 * 上断言了 scrollWidth <= clientWidth，那是行为守卫；这里守的是**写法**，
 * 目的是让「有人把某个容器改回字面量」在 pre-push 就红，而不是等 E2E。
 */

const root = 'src/app/(frontend)'
const files = {
  base: readFileSync(`${root}/styles.css`, 'utf8'),
  home: readFileSync(`${root}/styles/home.css`, 'utf8'),
  list: readFileSync(`${root}/styles/list.css`, 'utf8'),
  detail: readFileSync(`${root}/styles/detail.css`, 'utf8'),
}

describe('容器宽度契约', () => {
  it('四个容器的宽度都源自 --container-max，没有字面量副本', () => {
    // --w 是页眉/页脚/首页共用的容器 token
    expect(files.base).toMatch(/--w:\s*var\(--container-max\)/)
    expect(files.detail).toMatch(/--dt-w:\s*var\(--container-max\)/)
    expect(files.list).toMatch(/--ls-w:\s*var\(--container-max\)/)

    // 招募页是**有意**的例外：1024 是 552 + 72 + 400 的推导值，
    // 改容器等于改两栏推导前提（见 recruit.css 顶部注释）。
    // 这条断言存在是为了让「顺手把它也统一了」变成一次显式决定。
    const recruit = readFileSync(`${root}/styles/recruit.css`, 'utf8')
    expect(recruit).toMatch(/--rc-w:\s*1024px/)
  })

  it('--gut 三档齐全，且换挡断点是 768 / 1440', () => {
    expect(files.base).toMatch(/--gut:\s*16px/)
    expect(files.base).toMatch(
      /@media\s*\(min-width:\s*768px\)\s*\{\s*:root\s*\{\s*--gut:\s*32px/,
    )
    expect(files.base).toMatch(
      /@media\s*\(min-width:\s*1440px\)\s*\{\s*:root\s*\{\s*--gut:\s*48px/,
    )
  })

  it('容器规则一律用 var(--gut)，不得写回 100% - 32px', () => {
    const containerRule = /width:\s*min\(var\(--(?:w|dt-w|ls-w)\),\s*100% - var\(--gut\) \* 2\)/g
    // 页眉 + 页脚 + 页脚栏 = 3 处
    expect(files.base.match(containerRule)).toHaveLength(3)
    // .hm-container / .dt-container + .dt-page .location-panel / .ls-container
    expect(files.home.match(containerRule)).toHaveLength(1)
    expect(files.detail.match(containerRule)).toHaveLength(2)
    expect(files.list.match(containerRule)).toHaveLength(1)

    // 写死的 32px gutter 不得复活。detail.css 的
    // `calc((100% - 32px) / 5)` 是 5 格缩略图的 flex-basis（4 × 8px 间隙），
    // 与容器边距无关，所以只禁 `min(..., 100% - 32px)` 这个形状。
    for (const [name, css] of Object.entries(files)) {
      expect(css, `${name}.css 出现了写死的容器 gutter`).not.toMatch(
        /min\(var\(--[a-z-]*w\),\s*100% - 32px\)/,
      )
    }
  })

  it('列表页与首页/详情页用同一套 100vw 出血，不退回 .site-main 边框盒', () => {
    // 三者的 100% 必须都是视口，否则容器同宽后 .site-main 的 max-width
    // 会只裁到其中一个，1920 下列表 1344 / 页眉 1440。
    for (const [name, css] of [
      ['home', files.home],
      ['list', files.list],
      ['detail', files.detail],
    ] as const) {
      expect(css, `${name}.css 的页面外壳没有 100vw 出血`).toMatch(
        /width:\s*100vw;\s*\n?\s*margin-inline:\s*calc\(50% - 50vw\)/,
      )
    }
  })

  it('--measure 不跟随容器变宽（它是行长约束）', () => {
    expect(files.base).toMatch(/--measure:\s*702px/)
  })
})

describe('详情页两栏轨道', () => {
  it('主栏是弹性轨道，侧栏定宽——两条定宽轨道会在中间视口段溢出', () => {
    expect(files.detail).toMatch(
      /\.dt-core\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*var\(--dt-side\)/s,
    )
    expect(files.detail).toMatch(
      /\.location-panel__grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*var\(--dt-side\)/s,
    )
    // --dt-main 已删除：776 由 --dt-w - 32 - --dt-side 推导，不再单点声明。
    expect(files.detail).not.toMatch(/--dt-main\s*:/)
    // 776 / 372 的字面量副本不得写回轨道定义。
    expect(files.detail).not.toMatch(/grid-template-columns:\s*776px/)
  })

  it('关键规格宫格用容器查询（全站唯一一处）', () => {
    // .dt-nomedia 在 .dt-core 主栏内，主栏 1023 塌单列 → 宫格可用宽对视口
    // 不单调（1023 时 879、1024 时 476），媒体查询表达不了「网格自己窄了」。
    expect(files.detail).toMatch(/\.dt-nomedia\s*\{\s*container-type:\s*inline-size/)
    expect(files.detail).toMatch(
      /@container\s*\(max-width:\s*528px\)\s*\{\s*\.dt-keyspecs\s*\{[^}]*repeat\(2,/s,
    )
  })
})
