import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 后台左侧导航「看得见、点不动」的双向契约（OPT-056 T1）。
 *
 * ## 症状与根因
 *
 * Payload 3.86 的 `NavProvider` 在视口 ≤1440px（断点 `l`）时 `setNavOpen(false)`，
 * `NavWrapper` 随即给 `<aside class="nav">` 加上 **`inert`**——整棵导航子树不可交互。
 * 而 `custom.scss` 在 ≥1024px 又强制导航常驻可见、隐藏汉堡开关。两者叠加，
 * **1024–1440px 区间的导航看得见却点不动**，且拖动窗口跨断点后不会自愈。
 *
 * ## 为什么需要两层，且都要守
 *
 * 1. **状态层**（`setNavOpen(true)`）：让 Payload 自己的状态回到 open，class
 *    `nav--nav-open` 等衍生行为才自洽。但它依赖「NavProvider 先置 false、本组件
 *    的效果再置回 true」的渲染时序——拖拽时 resize 连续触发，时序不保证每轮成立。
 * 2. **DOM 层**（MutationObserver 摘 `inert`）：把不变量钉死在 DOM 上，与渲染时序
 *    解耦。这是「拖窄后点不动、刷新才好」那一类残留的兜底。
 *
 * 少任何一层都会在**某一条路径**上复发，而两种复发都不报错、不警告——只能靠测试守。
 *
 * ## 断言的是「机制在」，不是「实现长什么样」
 *
 * 因此只断言：桌面态判定、两层各自的关键调用、以及移动态**不得**被误伤
 * （<1024px 的导航是模态，关闭时带 inert 是正确行为，摘掉会破坏可访问性）。
 */

const here = fileURLToPath(new URL('.', import.meta.url))
const NAV_CLIENT = resolve(here, '../src/components/admin/AdminNavigationClient.tsx')
const source = readFileSync(NAV_CLIENT, 'utf8')

/** 递归收集目录下所有文件路径。 */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

describe('后台导航桌面态不得残留 inert（OPT-056 T1）', () => {
  it('状态层：桌面态把 Payload 的 navOpen 强制置回 true', () => {
    expect(source).toMatch(/useNav\(\)/)
    expect(source).toMatch(/setNavOpen\(true\)/)
    // 必须以「桌面态且当前是关闭」为条件，避免在移动端把模态导航强行打开
    expect(source).toMatch(/isDesktop\s*&&\s*!navOpen/)
  })

  it('DOM 层：桌面态用 MutationObserver 摘掉 inert', () => {
    expect(source).toMatch(/new MutationObserver/)
    expect(source).toMatch(/removeAttribute\(['"]inert['"]\)/)
    expect(source).toMatch(/attributeFilter:\s*\[['"]inert['"]\]/)
    // 必须断开，避免路由切换后观察者泄漏
    expect(source).toMatch(/observer\.disconnect\(\)/)
  })

  it('移动态（<1024px）不介入：关闭态保留 inert 是正确的可访问性行为', () => {
    // 兜底效果必须在非桌面态直接返回，不能无条件摘 inert
    expect(source).toMatch(/if\s*\(!isDesktop\)\s*return/)
  })

  it('初始化不得依赖 requestAnimationFrame（后台标签页不触发，桌面态判定会永久失效）', () => {
    // 匹配调用形式而非词本身——注释里正解释着「为什么不能用 rAF」，不该被自己的
    // 说明文字判红。
    expect(source).not.toMatch(/\brequestAnimationFrame\(/)
    expect(source).toMatch(/setMounted\(true\)/)
  })

  it('Payload 的 l 断点仍是 1440px —— 前提一旦变化，本修复的适用区间要重算', () => {
    // 断点硬编码在 @payloadcms/ui 的 Root provider 里，不可配置；升级若改了它，
    // 这里会红，提示重新评估 1024–1440 这个区间是否还需要我们兜底。
    const uiDist = resolve(here, '../node_modules/@payloadcms/ui/dist')
    const rootProvider = walk(uiDist).find(
      (file) => file.endsWith('.js') && file.includes(join('providers', 'Root')),
    )
    expect(rootProvider, '未找到 @payloadcms/ui 的 Root provider 产物').toBeDefined()
    const rootSource = readFileSync(rootProvider as string, 'utf8')
    expect(rootSource).toMatch(/l:\s*["']\(max-width:\s*1440px\)["']/)
  })
})
