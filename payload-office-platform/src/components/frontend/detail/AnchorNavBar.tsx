'use client'

import { useEffect, useState, type ReactNode } from 'react'

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
 * **当前区块 = 顶端已经到达/越过「自己的落点」的那些区块里、top 最大（即最靠下）
 * 的一个。**
 * 「落点」= 该区块自己的 `scroll-margin-top`（CSS 侧 `.dt-anchor-target` 定义为
 * 导航 44 + 吸附条 56 + 12 呼吸），运行时用 `getComputedStyle` 读，JS 这边一个
 * 字面量都不写。
 *
 * 为什么以「落点」而不是「吸附条底边」为线（这条踩过）：点击锚点后浏览器把区块
 * 停在**它的 scroll-margin-top 处**，也就是条底边再往下 12px（那 12px 是审查
 * Issue 7 要求补的呼吸）。若线取条底边，刚点完的那个区块 `top = 线 + 12` 反而
 * **不算越线**，高亮会停在上一项——实测过：点「周边与交通」，高亮亮的是「在租
 * 房源」，四个锚点整体错位一格。两个数必须同源，而它们唯一的共同定义在 CSS 里，
 * 所以直接读 CSS。
 * 附带收益：规则不再依赖本条自身的 rect，「条脱离吸附态 → 线变成大负数 → 高亮
 * 跳回第一项」那条边界从根上不存在了（见下方边界 3）。
 *
 * 规则**只依赖几何、不依赖 `items` 的数组顺序**（不取「最后一个越线的」而取
 * 「top 最大的越线者」），因此调用方即使把 items 顺序装配错了，高亮仍落在
 * 真正当前的区块上。
 *
 * 四条边界，逐条显式处理，不留隐式行为：
 *   1. **页面顶部，还没有任何区块到达落点** —— 兜底取「top 最小的存在区块」（即
 *      最靠上的那个）。导航永远有且只有一个当前项，不存在「全部不高亮」的
 *      空窗（那种空窗在 375 下看起来像组件坏了）。
 *   2. **滚到页面底部时最后一个区块可能永远不满足规则** —— 真实存在：最后一
 *      个区块很短、其下方页脚也很短时，页面已无可滚空间，它的 top 到不了自己的
 *      落点，规则会一直把高亮停在倒数第二个。显式兜底：`scrollY > 0` 且
 *      已到底（容差 `BOTTOM_EPSILON_PX`）时直接取「top 最大的存在区块」。
 *      要求 `scrollY > 0` 是为了排除「页面根本不可滚动」——那种页面上
 *      `innerHeight >= scrollHeight` 恒成立，不加这个条件会在页首就高亮最后一项。
 *      **已知残留缺口**：这条兜底只救得了几何最靠下的那**一个**区块。若页尾
 *      连着两个都够不到自己落点的短区块，倒数第二个仍然永远拿不到高亮——主规则
 *      要求「到达落点」，兜底只认「最后一个」，中间那个两头不靠。没有把它一起修掉
 *      是因为任何修法都要引入第二套「区块占了视口多少」的度量，那会让择一规则
 *      从「一条几何序」变成「两条互相打架的启发式」；此处如实记录，不假装覆盖完整。
 *   3. **本条脱离吸附态（滚过其包含块末尾）** —— 线取自各区块自己的落点，
 *      与本条的 rect 无关，所以条脱附后择一规则照常成立：所有区块都已越过
 *      落点 → `crossed` 是全集 → 取 top 最大者 = 最后一项，不会跳回第一项。
 *      （早先线取本条 `getBoundingClientRect().bottom`，条被推出视口后
 *      `bottom` 变成大负数、`crossed` 全空、走 `highest` → 高亮跳回第一项。
 *      审查给的修法是把 `line` 夹下限 0；改用落点后这条依赖整个消失，
 *      不需要夹。）
 *      **接线契约（Task 10 唯一会踩的坑，现在是视觉要求而非正确性要求）**：
 *      本条的**包含块必须覆盖全部被锚点指向的区块**——sticky 的粘附范围就是
 *      包含块，包含块比区块集合短，条会在还有区块没读完时就从屏幕上消失
 *      （高亮仍然是对的，但用户看不到导航了）。实操上：把本条与所有目标区块
 *      放进同一个父元素（或干脆都挂在页面根一级），不要把本条塞进某个只包住
 *      前半段内容的 wrapper。
 *   4. **items 里的 id 在 DOM 里找不到** —— 直接跳过，不参与择一、也不会被
 *      选中，不抛错。这不是纵容装配错误：本批的硬约束是「空态整段不渲染」，
 *      调用方装配 items 时理应同步剔除，这里只保证「万一漏了」的表现是
 *      「那一项永不高亮」而不是「整条导航崩掉」。
 *
 * ── 为什么用 rAF + scroll 几何而不是 IntersectionObserver ─────────────────
 * 择一规则要的是「所有区块 top 相对各自落点的排序」。IO 给的是每个元素各自的
 * 相交布尔/比例，要还原排序仍然得回头读几何——用 IO 只会变成「IO 回调里再
 * `getBoundingClientRect()`」，多一层没有收益的间接。直接在 rAF 里批量读一次
 * 几何更短、更好解释，而且**不依赖 IO 是否可用**：老浏览器 / IO 被禁用时本条
 * 只是不高亮，锚点链接本身是原生 `<a href="#id">`，照常可点可跳（不 fail-closed）。
 *
 * ── 跳转是**瞬时**的，不是平滑的（2026-09-04 起）─────────────────────────
 * 本条曾写着「平滑滚动走 CSS 不走 JS」，依据是 `styles.css` 的全局
 * `html { scroll-behavior: smooth }`。那条规则**已被移除**：它给根元素上每一次
 * 程序化滚动都加动画，其中包括浏览器的历史滚动恢复——从详情页按返回时，首页
 * 恢复滚动位置那一下会一路平滑滑过去，看起来像页面自己在动。产品权衡后选择
 * 用「一处锚点的平滑效果」换掉这个风险（理由全文见 styles.css 的 html 规则上方）。
 * 所以这里的原生 `#id` 跳转现在是瞬时的。
 *
 * 仍然**不要**改写成 JS `scrollIntoView`：那要自己 `preventDefault`、自己
 * `matchMedia`、自己补 hash 与历史记录，原来的判断在这一点上没变。真要恢复平滑，
 * 正解是只在锚点点击那一刻临时打开 scroll-behavior，且必须先验证它与浏览器
 * 历史恢复的先后顺序。落点仍靠 CSS
 * `.dt-anchor-target { scroll-margin-top }`（= 导航 44 + 本条 56 + 12 呼吸），
 * 目标区块必须带这个类，否则会滚到吸附条底下——而且择一规则的「落点」也读它，
 * 漏加会让高亮与落点一起偏。
 *
 * ── 全幅：外层全幅块 + 内层容器居中（稿子第 69 行的两层结构） ─────────────
 * `.dt-bar`（外层）负责毛玻璃与底线，**必须横贯整个视口宽**，否则玻璃与底线
 * 会在容器边界断掉、与正上方全幅的站点 header 脱节；`.dt-bar__inner` 带
 * `.dt-container` 负责把内容收回 `--dt-w` 并居中。`.dt-sticky-bar` 是靠
 * `fixed + left:0/right:0` 顺带拿到全幅的；本条用 `sticky` 留在文档流里，
 * 宽度由**父元素**决定——所以有一条硬性接线契约：
 *   **本条必须挂在一个全幅块下，不能塞进 `.dt-container` 之类的定宽容器里。**
 * 全幅由页面根 `.dt-page` 提供（它自己先破掉 `.site-main` 的 max-width 与
 * 24px 内边距，做法照抄首页 `.hm-home`）；本条自身不写破容器的负 margin，
 * 那会在父级已经全幅时反过来溢出视口。
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
 * 「已滚到页面底部」的判定容差（px）。
 *
 * 不用 0：`scrollHeight` 是取整的 CSS 像素，而 `scrollY` 在
 * devicePixelRatio ≠ 1 / 浏览器缩放 / 分数像素高度下是小数，
 * `innerHeight + scrollY` 与 `scrollHeight` 在「已经滚到底、再也滚不动」时
 * 仍可能差出一两个像素——容差取 0 会让边界 2 的兜底在真实设备上悄悄失效。
 * 取 4 而不是更大：页面本来就只能滚动几个像素时（`scrollY > 0` 挡不住的
 * 那种极短页），容差越大越容易在页首就误判成「已到底」。
 */
const BOTTOM_EPSILON_PX = 4

/**
 * 计算当前区块 id。规则与边界见文件头注释。
 *
 * 监听清理：卸载时移除 scroll/resize 监听、断开 ResizeObserver 并取消未执行
 * 的 rAF；`ids` 变化（区块集合随数据变化）时整套重建——effect 依赖用
 * `ids.join('\n')` 而不是数组本身，避免调用方每次渲染新建数组导致的无谓重建。
 */
function useActiveAnchorId(ids: readonly string[]): string | null {
  const [activeId, setActiveId] = useState<string | null>(ids[0] ?? null)
  // '\n' 作分隔符：DOM id 不会包含换行，不存在 ['a','b'] 与 ['a\nb'] 撞键。
  const idsKey = ids.join('\n')

  useEffect(() => {
    const list = idsKey === '' ? [] : idsKey.split('\n')
    // 没有锚点项就不订阅任何东西，也不在这里 setState 复位：ids 为空时锚点组
    // 整个不渲染，activeId 不会被读到；在 effect 体里同步 setState 反而会触发
    // 一次无谓的级联渲染（eslint react-hooks 的 set-state-in-effect 正是这条）。
    if (list.length === 0) return

    if (process.env.NODE_ENV !== 'production') {
      // 契约：items 的 id 必须互不相同（既是 React key，也是择一规则的主键）。
      // 重复 id 会撞 key，且 `document.getElementById` 只会返回第一个匹配元素，
      // 高亮永远落不到后一个上。开发期直接报出来，不在生产环境付出这次遍历。
      const dupes = list.filter((id, i) => list.indexOf(id) !== i)
      if (dupes.length > 0) {
        console.error(`[AnchorNavBar] items 含重复 id：${[...new Set(dupes)].join(', ')}`)
      }
    }

    let frame = 0

    const compute = () => {
      frame = 0

      // 一次性把存在的区块、它的 top、以及它相对**自己落点**的位移读出来，
      // 避免在比较过程中反复触发回流。
      // `passed <= 0` 即「这个区块已经到达/越过点击锚点时它会停的位置」。
      // 落点取自 CSS 的 scroll-margin-top（`.dt-anchor-target`），JS 不重写一份
      // 「44 + 56 + 12」——那正是两个事实源。调用方漏加 `.dt-anchor-target` 时
      // 读到 0，退化成「以视口顶边为线」：高亮晚 12px 切换，但不会崩，
      // 与那种情况下点击落点本来就是错的这件事表现一致。
      const measured: Array<{ id: string; top: number; passed: number }> = []
      for (const id of list) {
        const el = document.getElementById(id)
        if (!el) continue
        const top = el.getBoundingClientRect().top
        const landing = Number.parseFloat(getComputedStyle(el).scrollMarginTop) || 0
        measured.push({ id, top, passed: top - landing })
      }
      if (measured.length === 0) return // 边界 4 的极端情况：一个都没渲染，保持原值

      const lowest = measured.reduce((a, b) => (b.top > a.top ? b : a))
      const highest = measured.reduce((a, b) => (b.top < a.top ? b : a))

      // 边界 2：已滚到底且页面确实可滚 → 最后一个区块（几何最靠下的）
      const doc = document.documentElement
      const atBottom =
        window.innerHeight + window.scrollY >= doc.scrollHeight - BOTTOM_EPSILON_PX
      if (atBottom && window.scrollY > 0) {
        setActiveId(lowest.id)
        return
      }

      // 主规则：到达落点者中 top 最大的那个；一个都没到 → 边界 1，取最靠上的。
      // +1 的容差是分数像素：点击后 `top` 与 scroll-margin-top 理应相等，
      // 但两者在缩放/非整数布局下会差出零点几个像素。
      const crossed = measured.filter((m) => m.passed <= 1)
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

    // 内容尺寸变化也要重算：楼盘页有一批**异步撑高**的内容——高德地图 SDK 到
    // 位后地图容器换高、画廊图片加载完、供给区换组/筛选后表格行数变——这些都
    // 不产生 scroll 也不产生 resize 事件，但区块的 top 全变了，只监听那两个
    // 事件会让高亮停在旧值上。观察 document.body（而不是逐个观察区块）：区块
    // 集合随数据变化，body 是唯一稳定的、一定覆盖全部区块的观察对象。
    // 可选链式守卫：SSR 不会走到这里，但老浏览器可能没有 ResizeObserver，
    // 缺了它只是少一条触发源，不能因此让整个 effect 抛错（不 fail-closed）。
    const ro =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => schedule())
    ro?.observe(document.body)

    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      ro?.disconnect()
    }
  }, [idsKey])

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
   * 本批硬约束是「**结构性空壳**整段不渲染」（无坐标不渲染地图区、同商圈无
   * 楼盘不渲染该区、参数与特色全空不渲染参数区），硬编码 4 项会在这些页面上
   * 产出指向不存在元素的死锚点：点了不动、且高亮永远落不到它上面。接口是可以
   * 定的，所以先把接口定对，而不是事后在组件里猜哪些区块存在。
   *
   * ⚠️ 订正（2026-08-22）：这里原本还写着「供给三组全空不渲染供给区」。
   * **那是已撤回的裁定**，别照着它去加守卫。`#supply` 是恒渲染的
   * （`BuildingDetailLayout` 把 `{id:'supply'}` 放在所有条件之外），供给三组
   * 全空时由 `BuildingSupplyBrowser` 的「当前暂无公开可选空间」承担**诚实
   * 空态**，`tests/e2e/detail-pages.spec.ts` 已把这条锁死——加了守卫 e2e 直接红。
   * 「结构性空壳不渲染」与「诚实空态必须渲染」是两条不同的规则：前者针对
   * 渲染出来一无所获的壳（无坐标的地图容器、全是「—」的参数货架），后者针对
   * 「确实查过了，答案是没有」这件本身就是信息的事。
   *
   * 顺序建议与文档顺序一致（可读性），但择一规则不依赖它（见文件头）。
   *
   * **id 必须互不相同**：它同时是 React key 与择一规则的主键，重复时
   * `document.getElementById` 只认第一个，后一项永远拿不到高亮。开发环境下
   * 组件会在 effect 里 `console.error` 报出重复项。
   */
  items: ReadonlyArray<AnchorNavItem>
  /**
   * 「预约看房」触发器。与页面其它询价入口传同一个 `InquiryModal`
   * 配置——本文件不实现第二套询价逻辑（同 `StickyInquiryBar` 的 `cta` 做法）。
   */
  cta?: ReactNode
}>) {
  // 锚点组只在 ≥2 项时渲染（见下），因此 <2 项时不必建立任何监听。
  const showLinks = items.length > 1
  const activeId = useActiveAnchorId(showLinks ? items.map((i) => i.id) : [])

  // 全空 = 既没有锚点项、也没有 CTA → 整条不渲染（一条只有楼盘名的吸附条
  // 不提供任何操作，只是白占 56px 并遮住内容）。
  // 注意与「items.length <= 1 → 不渲染锚点组」是两条不同的规则：只剩一个
  // 区块时导航本身无意义，但吸附条本体与「预约看房」仍要在。
  if (items.length === 0 && cta == null) return null

  return (
    <div
      // `--no-links` 不是样式修饰符，是把「本条渲没渲出锚点组」这件**只有
      // 组件知道的事实**暴露给 CSS：≤767 断点下 `__title` 与 `__cta` 都被
      // 藏起来，锚点组又不渲染时，剩下的是一条不含任何内容、却常驻吸附并
      // 遮住内容的 56px 玻璃条。「空态整段不渲染」这条硬约束必须落在**最终
      // 可见性**上而不是 props 上，而断点只有 CSS 知道——所以判断留在 CSS
      // 的 media query 里（见 detail.css `.dt-anchor-bar--no-links`），
      // 组件这边只负责如实汇报，不把断点搬进 JS 造出第二个事实源。
      //
      // 这条规则的**边界**（2026-08-22 补，因为同一批次、同一页面上的
      // `BuildingSupplyBrowser.tsx` 用 `matchMedia('(max-width: 767px)')` 在 JS
      // 里决定渲染表格还是卡片，两条规则并存会让后来者无从判断该跟哪条）：
      //   - **默认走这条**——JS 需要知道的只是「在某个断点下要不要显示」时，
      //     CSS 自己就能做到（`display:none`），把断点值抄进 JS 是纯多出来的
      //     第二个事实源，改一处忘一处必然漂移。本条即是：`--no-links` 只是把
      //     组件独有的事实（渲没渲锚点组）交给 CSS，断点仍只有 CSS 知道。
      //   - **例外**：两个断点下要渲染的是**结构不同的 DOM**（表格 vs 卡片列表）
      //     而不是同一份 DOM 的显隐时，CSS 做不到——两份都渲染再各自 display:none
      //     会让隐藏的那份仍进 DOM、进无障碍树、进埋点，并重复一遍图片请求。
      //     这时才允许 JS 读 `matchMedia`，且断点值必须与 CSS 里那个逐字相同、
      //     两边互相注明（`BuildingSupplyBrowser.tsx` 的 `isMobile` 即此例）。
      //   一句话判据：**「同一份 DOM 显不显示」归 CSS；「渲染哪一份 DOM」才归 JS。**
      className={`dt-bar dt-anchor-bar${showLinks ? '' : ' dt-anchor-bar--no-links'}`}
    >
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
        {/* dt-bar__cta 是与 StickyInquiryBar 共享的 CTA 尺寸落点（同 dt-bar /
            dt-bar__inner 那两层共享外壳的做法）——两条吸附栏高度都是 56，
            按钮分量必须由构造保证一致，而不是各传各的 btn 尺寸档。 */}
        {cta != null && <div className="dt-bar__cta dt-anchor-bar__cta">{cta}</div>}
      </div>
    </div>
  )
}
