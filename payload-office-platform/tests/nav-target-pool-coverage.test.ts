/**
 * OPT-054：导航目标池与实际路由的**双向**一致性
 *
 * ## 为什么必须双向
 *
 * 单向只能防一半：
 *
 *   - **池 → 路由**（池子里的目标都能解析到真实路由）：防运营配出死链。
 *   - **路由 → 池**（每个顶层公开路由要么在池里、要么在豁免名单里）：
 *     防**池子静默过期**——新增了页面忘了加进池子，运营就配不出那个入口，
 *     而没有任何东西会提醒。
 *
 * 第二条是这个守卫真正的价值。`OPT-049` 就是这么烂掉的：`custom.scss` 里隐藏
 * Payload 原生导航的选择器写的是 Payload 2 的类名，在 3.86 下一个都匹配不到，
 * CSS 选择器匹配不上不报错、不告警，那段死代码在线上挂了很久没人发现。
 *
 * ## 豁免必须写理由
 *
 * 否则名单会退化成「往里塞就绿了」，守卫等于不存在。
 */
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { NAV_TARGETS } from '@/lib/frontend/nav-targets'

const FRONTEND = fileURLToPath(new URL('../src/app/(frontend)/', import.meta.url))

/**
 * 不作为导航目标的顶层路由，**每条都要写理由**。
 *
 * 写理由不是形式：没有理由的豁免无法判断它哪天该被移除，等同于永久欠账。
 */
const EXEMPT: Readonly<Record<string, string>> = {
  '[city]': '城市前缀段，不是独立页面——它下面的页面由同名的顶层路由承载',
  'api': '接口路由，不面向导航',
  'dev-story': '开发演示页，不对外',
  'pages': '动态 CMS 页（/pages/[slug]），目标由内容决定而非固定入口',
}

/**
 * 顶层路由目录。
 *
 * 判据是「目录下有没有 page.tsx / route.ts」，**不是「是不是目录」**——
 * `(frontend)/styles/` 放的是 CSS，把它当路由会让守卫报一个永远修不掉的假阳性，
 * 而假阳性最终会让人把整个守卫注释掉。
 */
async function topLevelRoutes(): Promise<string[]> {
  const entries = await readdir(FRONTEND, { withFileTypes: true })
  const routes: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('_')) continue
    const inner = await readdir(join(FRONTEND, entry.name), { recursive: true }).catch(
      () => [] as string[],
    )
    // 分隔符两种都要认：Windows 的 readdir 返回反斜杠。只写 `/` 的话本守卫在
    // 本地会漏判 api / pages 这类只有嵌套页面的路由，而在 CI（Linux）上正常——
    // 平台相关的假阴性最难发现，因为两边跑出来的结论不一样。
    const hasPage = inner.some(
      (f) => typeof f === 'string' && /(^|[\\/])(page\.tsx|route\.ts)$/.test(f),
    )
    if (hasPage) routes.push(entry.name)
  }
  return routes
}

describe('导航目标池与实际路由双向一致', () => {
  it('池 → 路由：每个目标的 href 都指向真实存在的顶层路由', async () => {
    const routes = new Set(await topLevelRoutes())
    const broken = NAV_TARGETS.filter((t) => {
      // 只取路径首段，忽略 query（带参目标的参数合法性由下一条用例守）
      const first = t.href.split('?')[0].split('/').filter(Boolean)[0]
      return first !== undefined && !routes.has(first)
    })

    expect(
      broken.map((t) => `${t.id} → ${t.href}`),
      '这些导航目标指向不存在的路由，运营一旦选中就是线上死链',
    ).toEqual([])
  })

  /**
   * 根路径目标（`/`）拆不出首段，会被上一条用例的 `first !== undefined` 直接跳过——
   * 也就是说它**根本没被那条守卫覆盖**。加「首页」目标时才暴露出这个盲区：
   * 上一条不是"验过了通过"，而是"没验"。这两种结果在测试报告里长得一模一样，
   * 正是最容易骗过人的一类假绿。
   */
  it('池 → 路由：根路径目标必须对应真实存在的首页文件', async () => {
    const rootTargets = NAV_TARGETS.filter(
      (t) => t.href.split('?')[0].split('/').filter(Boolean).length === 0,
    )
    if (rootTargets.length === 0) return

    const rootPage = await stat(join(FRONTEND, 'page.tsx')).catch(() => null)
    expect(
      rootPage?.isFile() ?? false,
      `${rootTargets.map((t) => t.id).join(' / ')} 指向根路径，但 (frontend)/page.tsx 不存在`,
    ).toBe(true)
  })

  it('路由 → 池：每个顶层公开路由要么可选为导航目标，要么在豁免名单里', async () => {
    const routes = await topLevelRoutes()
    const covered = new Set(
      NAV_TARGETS.map((t) => t.href.split('?')[0].split('/').filter(Boolean)[0]).filter(
        (v): v is string => v !== undefined,
      ),
    )

    const orphans = routes.filter((r) => !covered.has(r) && !(r in EXEMPT))

    expect(
      orphans,
      `这些路由既不在导航目标池里、也没写豁免理由。\n` +
        `新增页面后忘了加进池子，运营就配不出那个入口，而没有任何东西会提醒——\n` +
        `要么把它加进 NAV_TARGETS，要么在本文件的 EXEMPT 里写清为什么不需要。`,
    ).toEqual([])
  })

  it('豁免名单里不留已经消失的路由（否则它会一直挡着后来的同名路由）', async () => {
    const routes = new Set(await topLevelRoutes())
    const stale = Object.keys(EXEMPT).filter((name) => !routes.has(name))
    expect(stale, '这些豁免项对应的路由已不存在，应删除').toEqual([])
  })

  it('目标 id 唯一——重复 id 会让配置行指向哪个目标变得不确定', () => {
    const ids = NAV_TARGETS.map((t) => t.id)
    expect(ids).toEqual([...new Set(ids)])
  })
})
