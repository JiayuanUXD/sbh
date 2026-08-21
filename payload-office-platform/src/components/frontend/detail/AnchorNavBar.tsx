'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * 吸附锚点导航条（OPT-037 Task 8，楼盘详情页）
 *
 * 设计依据：`docs/SBH设计任务讨论/楼盘详情.dc.html` 第 69–77 行 + specRows
 * 「吸附条 = sticky top 44 · 高 56 · 锚点导航 + 预约（楼盘页不带价格）」。
 *
 * ── 为什么不复用 `useAnchorVisibility`（也不 N 次调用它） ───────────────────
 * 那个 hook 的职责是「**一个**锚点是否与视口相交 → 一个布尔」。本条的职责是
 * 「**N 个**区块中哪一个是当前」。两者不是同一个问题的不同规模：滚动到任一
 * 时刻通常有 2–3 个区块同时与视口相交，N 个「相交/不相交」布尔里没有任何
 * 信息能回答「当前是哪个」——缺的正是**排序与择一规则**，而那恰恰是本文件
 * 唯一有价值的部分。合并只会把一个不带排序语义的 hook 撑成带排序语义的，
 * 让 `DetailMobileBarPrice` / `StickyInquiryBar` 两个真正共享样板的调用方
 * 背上与它们无关的复杂度。判据是职责相同与否，不是 API 长得像不像。
 *
 * ── 择一规则（本文件自己定的，连同边界一起写在这里） ───────────────────────
 * **当前区块 = 顶端已经越过「吸附线」的那些区块里、top 最大（即最靠下）的一个。**
 * 「吸附线」不写死成 100，而是运行时读本条自身的 `getBoundingClientRect().bottom`
 * ——本条吸附后其底边就是内容可见区的上沿（导航 44 + 本条 56），这样 CSS 侧
 * 改高度/改导航高度时 JS 不需要跟着改，也不会两处漂移。
 *
 * 规则**只依赖几何、不依赖 `items` 的数组顺序**（不取「最后一个越线的」而取
 * 「top 最大的越线者」），因此调用方即使把 items 顺序装配错了，高亮仍落在
 * 真正当前的区块上。
 *
 * 三条边界，逐条显式处理，不留隐式行为：
 *   1. **页面顶部，还没有任何区块越线** —— 兜底取「top 最小的存在区块」（即
 *      最靠上的那个）。导航永远有且只有一个当前项，不存在「全部不高亮」的
 *      空窗（那种空窗在 375 下看起来像组件坏了）。
 *   2. **滚到页面底部时最后一个区块可能永远不满足规则** —— 真实存在：最后一
 *      个区块很短、其下方页脚也很短时，页面已无可滚空间，它的 top 到不了吸附
 *      线，规则会一直把高亮停在倒数第二个。显式兜底：`scrollY > 0` 且
 *      已到底（±2px 容差）时直接取「top 最大的存在区块」。要求 `scrollY > 0`
 *      是为了排除「页面根本不可滚动」——那种页面上 `innerHeight >= scrollHeight`
 *      恒成立，不加这个条件会在页首就高亮最后一项。
 *   3. **items 里的 id 在 DOM 里找不到** —— 直接跳过，不参与择一、也不会被
 *      选中，不抛错。这不是纵容装配错误：本批的硬约束是「空态整段不渲染」，
 *      调用方装配 items 时理应同步剔除，这里只保证「万一漏了」的表现是
 *      「那一项永不高亮」而不是「整条导航崩掉」。
 *
 * ── 为什么用 rAF + scroll 几何而不是 IntersectionObserver ─────────────────
 * 择一规则要的是「所有区块 top 相对吸附线的排序」。IO 给的是每个元素各自的
 * 相交布尔/比例，要还原排序仍然得回头读几何——用 IO 只会变成「IO 回调里再
 * `getBoundingClientRect()`」，多一层没有收益的间接。直接在 rAF 里批量读一次
 * 几何更短、更好解释，而且**不依赖 IO 是否可用**：老浏览器 / IO 被禁用时本条
 * 只是不高亮，锚点链接本身是原生 `<a href="#id">`，照常可点可跳（不 fail-closed）。
 *
 * ── 平滑滚动走 CSS，不走 JS ──────────────────────────────────────────────
 * `styles.css` 已全局 `html { scroll-behavior: smooth }`，并在
 * `@media (prefers-reduced-motion: reduce)` 下回落 `auto`。原生 `#id` 跳转
 * 因此免费拿到「平滑 + 尊重 reduced-motion」，同时保留浏览器的 hash 更新与
 * 后退栈行为。改写成 JS `scrollIntoView` 要自己 `preventDefault`、自己
 * `matchMedia`、自己补 hash 与历史记录，是纯粹的净损失。落点靠 CSS
 * `.dt-anchor-target { scroll-margin-top }`（= 导航 44 + 本条 56），
 * 目标区块必须带这个类，否则会滚到吸附条底下。
 *
 * ── 与 `StickyInquiryBar` 的关系 ─────────────────────────────────────────
 * 只共享 CSS 外壳（`.dt-bar` / `.dt-bar__inner`：居中容器 / 高 56 / 毛玻璃 /
 * 底线），不共享组件。那一条的挂载条件是「决策卡离屏」，本条常驻——两条无关
 * 的触发条件绞进一个组件正是本项目栽过多次的形态。
 * 定位取值也**故意不同**：那一条用 `fixed`，唯一理由是它整体挂载/卸载，
 * sticky 会在挂载瞬间把下方内容顶下去 56px；本条常驻、从首帧就占位，用字面的
 * `position: sticky` 才对——照抄 `fixed` 会让下方内容被遮 56px。
 */

export type AnchorNavItem = Readonly<{
  /** 目标区块的 DOM id；该区块必须带 `.dt-anchor-target` 类（scroll-margin-top） */
  id: string
  /** 锚点文案，如「在租房源」 */
  label: string
}>

/**
 * 计算当前区块 id。规则与边界见文件头注释。
 *
 * 监听清理：卸载时移除 scroll/resize 监听并取消未执行的 rAF；`ids` 变化
 * （区块集合随数据变化）时整套重建——effect 依赖用 `ids.join('\n')` 而不是
 * 数组本身，避免调用方每次渲染新建数组导致的无谓重建。
 */
function useActiveAnchorId(
  ids: readonly string[],
  barRef: React.RefObject<HTMLDivElement | null>,
): string | null {
  const [activeId, setActiveId] = useState<string | null>(ids[0] ?? null)
  // '\n' 作分隔符：DOM id 不会包含换行，不存在 ['a','b'] 与 ['a\nb'] 撞键。
  const idsKey = ids.join('\n')

  useEffect(() => {
    const list = idsKey === '' ? [] : idsKey.split('\n')
    // 没有锚点项就不订阅任何东西，也不在这里 setState 复位：ids 为空时锚点组
    // 整个不渲染，activeId 不会被读到；在 effect 体里同步 setState 反而会触发
    // 一次无谓的级联渲染（eslint react-hooks 的 set-state-in-effect 正是这条）。
    if (list.length === 0) return

    let frame = 0

    const compute = () => {
      frame = 0
      const bar = barRef.current
      // 吸附线 = 本条底边。未吸附（页面顶部）时这个值偏大，但那种情形下
      // 通常没有区块越线，会走边界 1 的兜底，结果一致。
      const line = bar ? bar.getBoundingClientRect().bottom : 0

      // 一次性把存在的区块与其 top 读出来，避免在比较过程中反复触发回流。
      const measured: Array<{ id: string; top: number }> = []
      for (const id of list) {
        const el = document.getElementById(id)
        if (el) measured.push({ id, top: el.getBoundingClientRect().top })
      }
      if (measured.length === 0) return // 边界 3 的极端情况：一个都没渲染，保持原值

      const lowest = measured.reduce((a, b) => (b.top > a.top ? b : a))
      const highest = measured.reduce((a, b) => (b.top < a.top ? b : a))

      // 边界 2：已滚到底且页面确实可滚 → 最后一个区块（几何最靠下的）
      const doc = document.documentElement
      const atBottom = window.innerHeight + window.scrollY >= doc.scrollHeight - 2
      if (atBottom && window.scrollY > 0) {
        setActiveId(lowest.id)
        return
      }

      // 主规则：越线者中 top 最大的那个；一个都没越线 → 边界 1，取最靠上的
      const crossed = measured.filter((m) => m.top <= line + 1)
      setActiveId(
        crossed.length > 0 ? crossed.reduce((a, b) => (b.top > a.top ? b : a)).id : highest.id,
      )
    }

    const schedule = () => {
      if (frame === 0) frame = window.requestAnimationFrame(compute)
    }

    // 首次也走 rAF 而不是直接 compute()：挂载时页面未必在顶部（带 hash 进入、
    // 浏览器恢复滚动位置、或本条上方还有内容），必须量一次真实位置；但同步在
    // effect 体内 setState 会触发级联渲染，推迟一帧既正确又避开那条规则。
    schedule()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [idsKey, barRef])

  return activeId
}

export default function AnchorNavBar({
  title,
  items,
  cta,
}: Readonly<{
  /** 楼盘名，左起 15/600 */
  title: string
  /**
   * 锚点项，**由调用方按区块真实渲染与否装配**，不得硬编码。
   *
   * 本批硬约束是「空态整段不渲染」（无坐标不渲染地图区、供给三组全空不渲染
   * 供给区、同商圈无楼盘不渲染该区），硬编码 4 项会在这些页面上产出指向不
   * 存在元素的死锚点：点了不动、且高亮永远落不到它上面。接口是可以定的，
   * 所以先把接口定对，而不是事后在组件里猜哪些区块存在。
   *
   * 顺序建议与文档顺序一致（可读性），但择一规则不依赖它（见文件头）。
   */
  items: ReadonlyArray<AnchorNavItem>
  /**
   * 「预约看房」触发器。与页面其它询价入口传同一个 `InquiryModal`
   * 配置——本文件不实现第二套询价逻辑（同 `StickyInquiryBar` 的 `cta` 做法）。
   */
  cta?: ReactNode
}>) {
  const barRef = useRef<HTMLDivElement>(null)
  // 锚点组只在 ≥2 项时渲染（见下），因此 <2 项时不必建立任何监听。
  const showLinks = items.length > 1
  const activeId = useActiveAnchorId(showLinks ? items.map((i) => i.id) : [], barRef)

  // 全空 = 既没有锚点项、也没有 CTA → 整条不渲染（一条只有楼盘名的吸附条
  // 不提供任何操作，只是白占 56px 并遮住内容）。
  // 注意与「items.length <= 1 → 不渲染锚点组」是两条不同的规则：只剩一个
  // 区块时导航本身无意义，但吸附条本体与「预约看房」仍要在。
  if (items.length === 0 && cta == null) return null

  return (
    <div ref={barRef} className="dt-bar dt-anchor-bar">
      <div className="dt-container dt-bar__inner dt-anchor-bar__inner">
        <span className="dt-anchor-bar__title">{title}</span>
        {showLinks && (
          <nav className="dt-anchor-bar__links" aria-label="楼盘内容导航">
            {items.map((item) => (
              <a
                key={item.id}
                className="dt-anchor-bar__link"
                href={`#${item.id}`}
                // aria-current 而非 aria-pressed：这些是真实的页内导航链接，
                // aria-pressed 只在 role="button" 下有效，而给 <a href="#id">
                // 加 role="button" 会把「跳转」谎报成「按钮」，同时废掉浏览器
                // 原生的 hash 跳转语义。取值用 "true"（ARIA 1.2 也允许更精确的
                // "location"，但 "true" 的 AT 支持面最广，且这里只需要表达
                // 「就是这一项」）。非当前项完全不输出该属性，不写 "false"。
                aria-current={activeId === item.id ? 'true' : undefined}
              >
                {item.label}
              </a>
            ))}
          </nav>
        )}
        {cta != null && <div className="dt-anchor-bar__cta">{cta}</div>}
      </div>
    </div>
  )
}
