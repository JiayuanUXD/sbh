import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 后台左侧导航的两条**静默失效**契约（OPT-049）。
 *
 * 两者都不报错、不警告，只是「页面看起来多了点东西」——所以只能靠测试守：
 *
 *   1. **CSS 选择器失效**：`custom.scss` 用 `display:none` 隐藏 Payload 原生元素，
 *      而选择器写的是 Payload 2 的 BEM 类名（`.nav__groups` / `.nav__controls`），
 *      3.86 下一个元素都匹配不到。CSS 匹配不到**不报错**，是最典型的跨依赖隐式
 *      契约断裂：依赖升级改了类名，样式静默失效，没人会立刻发现。
 *
 *   2. **集合落进默认「集合」分组**：漏写 `admin.group: false` 的集合会被 Payload
 *      塞进 `i18n.t('general:collections')` 分组，在自定义导航下方渲染成一个风格
 *      断裂的区块。详见下方 describe 的注释。
 *
 * ## 两条都断言「集合为空」，而不是「当前有几个」
 *
 * 反面写法是 `expect(leaked.length).toBe(2)`——那是把现状固化成期望，下次再漏一个
 * 照样绿。（同一条教训见 OPT-045 §10.5.3：验 X 的症状，不是验导致 X 的数据结构
 * 长什么样。）
 */

const here = fileURLToPath(new URL('.', import.meta.url))
const CUSTOM_SCSS = resolve(here, '../src/app/(payload)/custom.scss')

/** 递归收集目录下所有文件路径。 */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

/** `@payloadcms/ui` 的产物目录（pnpm 的 hash 目录名不可硬编码）。 */
function resolvePayloadUiDist(): string {
  const pnpmDir = resolve(here, '../node_modules/.pnpm')
  const match = readdirSync(pnpmDir).find((d) => d.startsWith('@payloadcms+ui@'))
  if (!match) throw new Error('找不到 @payloadcms/ui —— 依赖布局变了，本守卫需要同步更新')
  return join(pnpmDir, match, 'node_modules/@payloadcms/ui/dist')
}

describe('custom.scss 隐藏 Payload 原生导航的选择器必须真实存在', () => {
  /**
   * 只检查带 `!important` 的 `display: none` ——那些是「刻意隐藏 Payload 原生元素」的，
   * 与项目自有组件的普通样式区分开（自有类名不在 payload/ui 里是正常的）。
   */
  const TARGET_SELECTORS = ['nav-group', 'nav__log-out'] as const

  it('选择器写在 custom.scss 里', () => {
    const scss = readFileSync(CUSTOM_SCSS, 'utf8')
    for (const sel of TARGET_SELECTORS) {
      expect(scss, `custom.scss 里找不到 .${sel} —— 隐藏规则被删了？`).toContain(`.${sel}`)
    }
  })

  it('每个选择器都能在 @payloadcms/ui 的产物里找到（否则 CSS 匹配不到任何元素）', () => {
    const files = walk(resolvePayloadUiDist()).filter(
      (f) => f.endsWith('.js') || f.endsWith('.css') || f.endsWith('.scss'),
    )
    const haystack = files.map((f) => readFileSync(f, 'utf8')).join('\n')

    /**
     * BEM 类名在产物里往往是**模板串拼出来的**，整串搜不到：
     *   Logout/index.js 里是 `${baseClass}__log-out`，而 baseClass = 'nav'，
     *   所以 'nav__log-out' 这个完整字符串在产物中根本不存在。
     *
     * 因此按 BEM 拆开找：`block__element` 要求 block 与 `__element` 各自出现。
     * 这仍然能抓到真正的失效——Payload 把 `nav-group` 改名时，'nav-group' 整串会消失；
     * 把 `__log-out` 改成别的时，那一半也会消失。
     */
    const present = (selector: string): boolean => {
      if (haystack.includes(selector)) return true
      const bem = /^([a-z0-9-]+)__([a-z0-9-]+)$/.exec(selector)
      if (!bem) return false
      const [, block, element] = bem
      return haystack.includes(`'${block}'`) && haystack.includes(`__${element}`)
    }

    const missing = TARGET_SELECTORS.filter((sel) => !present(sel))
    expect(
      missing,
      `这些类名在 Payload 3.86 里不存在，对应的 display:none 规则形同虚设：${missing.join('、')}。` +
        'Payload 升级改类名时会走到这里——去 @payloadcms/ui 的产物里查新类名并更新 custom.scss。',
    ).toEqual([])
  })

  it('反向守卫：Payload 2 的旧类名不得再作为选择器使用', () => {
    // 这两个在 3.86 中已不存在，留着只会让人以为「隐藏规则还在生效」。
    const STALE = ['nav__groups', 'nav__controls']
    const scss = readFileSync(CUSTOM_SCSS, 'utf8')

    // 只看**行首的选择器**，不看注释——注释里提到旧类名是刻意的（说明为什么改），
    // 按纯文本匹配会把那段说明本身判成违规。
    const selectorLines = scss
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => !line.startsWith('//') && !line.startsWith('*') && !line.startsWith('/*'))

    const found = STALE.filter((sel) =>
      selectorLines.some((line) => new RegExp(`(^|[\\s,>+~])\\.${sel}\\b`).test(line)),
    )
    expect(found, `custom.scss 仍在用已失效的旧类名作选择器：${found.join('、')}`).toEqual([])
  })
})

describe('没有集合会落进 Payload 默认的「集合」分组', () => {
  /**
   * ## 这才是「左下角那个风格不一致的区块」的真正成因
   *
   * Payload 3.86 的 `groupNavItems`：
   *
   * ```js
   * if (entityToGroup.entity?.admin?.group === false) return groups  // 直接跳过
   * ...
   * label: i18n.t('general:collections')   // 没有 group 的落进这里，中文就是「集合」
   * ```
   *
   * 所以只有**既没设 `admin.group`（或设成字符串）、也没 `hidden`** 的集合才会
   * 被塞进那个默认分组。本项目用自定义导航（挂在 `beforeNavLinks`，是**加在**
   * 原生导航之前而非替换它），原生的任何残留都是重复入口 + 风格断裂。
   *
   * 实测踩到：`location-aliases` 与 `supply-import-batches` 漏了 `group: false`，
   * 于是它们俩组成了那个「集合 / 导入批次 / 地理别名」区块——而 OPT-045 D4
   * 把它们收编进自定义导航**并不能让它消失**，收编只让它们同时出现在两处。
   *
   * ## 断言的是「集合为空」
   *
   * 不写 `toBe(2)` 之类把现状固化成期望的断言——那样下次再漏一个照样绿。
   */
  it('每个集合都必须显式 group:false 或 hidden:true', { timeout: 30_000 }, async () => {
    const { default: configPromise } = await import('@/payload.config')
    const cfg = await configPromise

    const leaked = (cfg.collections ?? [])
      .filter((c) => c.admin?.group !== false && c.admin?.hidden !== true)
      .map((c) => c.slug)

    expect(
      leaked,
      `这些集合会落进 Payload 默认的「集合」分组，在后台左侧渲染成一个与自定义导航` +
        `风格不一致的区块：${leaked.join('、')}。` +
        '给它们的 admin 加 `group: false`（保留直达路由）或 `hidden: true`（连路由入口也藏）。',
    ).toEqual([])
  })
})
