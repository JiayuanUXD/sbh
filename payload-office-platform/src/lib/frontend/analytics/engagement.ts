/**
 * 页面活跃停留时长与浏览深度（`page_engagement`，OPT-064）
 *
 * ## 为什么要自埋，而不是用 Umami 自带的访问时长
 *
 * Umami 按**相邻两次 pageview 的时间差**推算停留时长，所以**会话的最后一页恒缺失**
 * ——没有后继事件可减。upstream issue #3518 讨论的就是这件事，至今未解决。
 * 而「用户在房源详情页停留多久」恰恰是本项目最想知道的指标之一，最后一页又常常
 * 就是详情页，用它自带的数会系统性偏低。
 *
 * ## 三个上报触发点，缺一不可
 *
 * 1. **客户端路由变化** —— App Router 的站内跳转（`next/link`）**既不触发
 *    `pagehide` 也不触发 `visibilitychange`**。列表页卡片全是 `next/link`，
 *    所以「列表 → 详情 → 下一套」这条主路径上，只靠 ②③ 会丢掉几乎全部数据。
 * 2. `pagehide` —— 关标签页 / 真正的文档卸载。
 * 3. `visibilitychange` → hidden —— 移动端切后台后进程可能直接被杀，`pagehide`
 *    不一定跑得到。
 *
 * ## 为什么是「增量」而不是「累计」
 *
 * 同一次浏览可能上报多条（切走一次报一次，回来接着看再报一次）。每条带的是
 * **自上次上报以来新增的活跃毫秒数**，分析端对同一次浏览求和即可。
 * 若改成每次报累计值，切走再回来就会重复计入前半段。
 *
 * ## 「活跃」的定义
 *
 * 页面可见 **且** 距最近一次真实交互（pointer / scroll / key）不超过 60 秒。
 * 不加这条，一个挂在后台或摊在桌上没人看的标签页会贡献几小时"停留"，
 * 把中位数彻底污染。上限 30 分钟同理，防极端值。
 */

import { getCityPageType } from '@/lib/frontend/city-routes'

/** 纳入统计的页面类型：转化链路上的六类（spec D11） */
export const ENGAGEMENT_PAGE_TYPES = [
  'listings',
  'listing-detail',
  'buildings',
  'building-detail',
  'entrust',
  'publish',
] as const

export type EngagementPageType = (typeof ENGAGEMENT_PAGE_TYPES)[number]

export function isEngagementPageType(value: unknown): value is EngagementPageType {
  return typeof value === 'string'
    && (ENGAGEMENT_PAGE_TYPES as readonly string[]).includes(value)
}

/** 从 pathname 解析出纳入统计的页面类型；不在六类内返回 null。 */
export function resolveEngagementPageType(pathname: string): EngagementPageType | null {
  // 复用既有的路由解析（城市前缀、旧路径都已在那边处理），不另写一份映射
  const pageType = getCityPageType(pathname)
  return isEngagementPageType(pageType) ? pageType : null
}

/** 距最近交互超过这个时长就不再计入活跃 */
export const IDLE_TIMEOUT_MS = 60_000
/** 单页活跃时长上限，防极端值 */
export const ACTIVE_CAP_MS = 30 * 60_000
/** 小于这个增量不值得单独上报（避免路由抖动产生一堆 0ms 记录） */
export const MIN_REPORT_MS = 1_000

/** 浏览深度分桶。到达过的最大值向下取桶。 */
export const SCROLL_BUCKETS = [0, 25, 50, 75, 90] as const

export function toScrollBucket(percent: number): number {
  if (!Number.isFinite(percent)) return 0
  let bucket = 0
  for (const b of SCROLL_BUCKETS) {
    if (percent >= b) bucket = b
  }
  return bucket
}

/**
 * 由文档尺寸算滚动百分比。
 *
 * **不可滚动的页面（内容不足一屏）记 100** ——整页本来就全在视野内，
 * 记 0 会让「短页面」和「进来就没往下看」混为一谈，而这两件事含义完全相反。
 */
export function computeScrollPercent(input: {
  scrollY: number
  innerHeight: number
  scrollHeight: number
}): number {
  const { scrollY, innerHeight, scrollHeight } = input
  if (!Number.isFinite(scrollHeight) || !Number.isFinite(innerHeight)) return 0
  if (scrollHeight <= innerHeight) return 100
  const seen = ((scrollY + innerHeight) / scrollHeight) * 100
  return Math.max(0, Math.min(100, seen))
}

// ────────────────────────────────────────────────────────────
// 计时账本（纯逻辑，时钟由调用方注入，可脱离 DOM 单测）
// ────────────────────────────────────────────────────────────

export interface EngagementIncrement {
  activeMs: number
  scrollBucket: number
}

export interface EngagementAccountant {
  setVisible: (visible: boolean, now: number) => void
  noteInteraction: (now: number) => void
  noteScrollPercent: (percent: number) => void
  activeMs: (now: number) => number
  scrollBucket: () => number
  /** 取自上次上报以来的增量；不足 MIN_REPORT_MS 返回 null */
  takeIncrement: (now: number) => EngagementIncrement | null
}

export interface AccountantOptions {
  visible?: boolean
  idleMs?: number
  capMs?: number
  minReportMs?: number
}

export function createEngagementAccountant(
  startNow: number,
  options: AccountantOptions = {},
): EngagementAccountant {
  const idleMs = options.idleMs ?? IDLE_TIMEOUT_MS
  const capMs = options.capMs ?? ACTIVE_CAP_MS
  const minReportMs = options.minReportMs ?? MIN_REPORT_MS

  let visible = options.visible ?? true
  let accumulated = 0
  // 当前活跃计时段的起点；null 表示当前不在计时
  let segmentStart: number | null = visible ? startNow : null
  // 进入页面本身就是一次「注意力事件」，从这一刻起算 60 秒空闲预算
  let lastInteractionAt = startNow
  let maxScrollPercent = 0
  let reported = 0

  /** 当前计时段已累计的活跃毫秒；上界是「最近交互 + 空闲超时」，超时后自动停表 */
  function segmentMs(now: number): number {
    if (segmentStart === null) return 0
    const end = Math.min(now, lastInteractionAt + idleMs)
    return Math.max(0, end - segmentStart)
  }

  function closeSegment(now: number): void {
    accumulated += segmentMs(now)
    segmentStart = null
  }

  return {
    setVisible(next, now) {
      if (next === visible) return
      if (next) {
        // 切回来：重新给足空闲预算并起表
        lastInteractionAt = now
        segmentStart = now
      } else {
        closeSegment(now)
      }
      visible = next
    },

    noteInteraction(now) {
      if (visible) {
        // 先按**旧的**空闲上界结掉当前段，再以 now 起新段——
        // 这样「空闲 5 分钟后又动了一下」只计入 60 秒，而不是 5 分钟
        closeSegment(now)
        lastInteractionAt = now
        segmentStart = now
      } else {
        lastInteractionAt = now
      }
    },

    noteScrollPercent(percent) {
      if (Number.isFinite(percent) && percent > maxScrollPercent) {
        maxScrollPercent = percent
      }
    },

    activeMs(now) {
      return Math.min(capMs, accumulated + segmentMs(now))
    },

    scrollBucket() {
      return toScrollBucket(maxScrollPercent)
    },

    takeIncrement(now) {
      const total = Math.min(capMs, accumulated + segmentMs(now))
      const delta = total - reported
      if (delta < minReportMs) return null
      reported = total
      return { activeMs: Math.round(delta), scrollBucket: toScrollBucket(maxScrollPercent) }
    },
  }
}

// ────────────────────────────────────────────────────────────
// 追踪器：把账本与事件上报串起来（仍不碰 DOM）
// ────────────────────────────────────────────────────────────

export type EngagementTrack = (name: 'page_engagement', props: {
  page_type: EngagementPageType
  active_ms: number
  scroll_bucket: number
}) => void

export interface EngagementTracker {
  /** 进入某个 pathname：先把上一页的增量报掉，再对新页重新起表 */
  enter: (pathname: string) => void
  /** 报当前页的增量（pagehide / 切后台时调用） */
  flush: () => void
  setVisible: (visible: boolean) => void
  noteInteraction: () => void
  noteScrollPercent: (percent: number) => void
  /** 测试观察用：当前正在统计的页面类型 */
  readonly currentPageType: EngagementPageType | null
}

export function createEngagementTracker(deps: {
  track: EngagementTrack
  now?: () => number
  accountantOptions?: AccountantOptions
}): EngagementTracker {
  const now = deps.now ?? (() => Date.now())
  let pageType: EngagementPageType | null = null
  let accountant: EngagementAccountant | null = null

  function report(): void {
    if (!accountant || !pageType) return
    const inc = accountant.takeIncrement(now())
    if (!inc) return
    deps.track('page_engagement', {
      page_type: pageType,
      active_ms: inc.activeMs,
      scroll_bucket: inc.scrollBucket,
    })
  }

  return {
    enter(pathname) {
      report()
      const next = resolveEngagementPageType(pathname)
      pageType = next
      // 不在六类页面上就不起表，省掉无意义的计时与监听开销
      accountant = next ? createEngagementAccountant(now(), deps.accountantOptions) : null
    },
    flush: report,
    setVisible(visible) {
      accountant?.setVisible(visible, now())
    },
    noteInteraction() {
      accountant?.noteInteraction(now())
    },
    noteScrollPercent(percent) {
      accountant?.noteScrollPercent(percent)
    },
    get currentPageType() {
      return pageType
    },
  }
}

// ────────────────────────────────────────────────────────────
// DOM 接线（唯一碰 window/document 的地方）
// ────────────────────────────────────────────────────────────

/**
 * 量一次当前文档的滚动深度并喂给 tracker。
 *
 * **每次进入新页面后都必须调一次**，不能只在挂载时调：客户端导航后
 * `enter()` 会换一本新账本，而如果用户在目标页从不滚动（点的是首屏就能看到的
 * 结果、或目标页内容不足一屏），就再也不会有 scroll 事件——那页会恒报
 * `scroll_bucket: 0`，把「整页都看完了」误报成「进来就没往下看」。
 * 这是 Codex review P2 指出的，初版只在 attach 时量了一次。
 *
 * SSR 环境是安全 no-op。
 */
export function sampleScrollDepth(tracker: EngagementTracker): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  tracker.noteScrollPercent(
    computeScrollPercent({
      scrollY: window.scrollY,
      innerHeight: window.innerHeight,
      scrollHeight: document.documentElement.scrollHeight,
    }),
  )
}

/** 交互信号：这几类事件都表示人还在看。`scroll` 与 `keydown` 用 passive 减少主线程压力。 */
const INTERACTION_EVENTS = ['pointerdown', 'keydown', 'scroll', 'wheel', 'touchstart'] as const

/**
 * 订阅 DOM 事件驱动 tracker，返回退订函数。
 *
 * SSR 或缺 window 时是安全 no-op，调用方不必判环境。
 */
export function attachEngagementListeners(tracker: EngagementTracker): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => {}
  }

  const onInteraction = () => tracker.noteInteraction()
  const onScroll = () => {
    tracker.noteInteraction()
    sampleScrollDepth(tracker)
  }
  const onVisibility = () => {
    const visible = document.visibilityState === 'visible'
    tracker.setVisible(visible)
    // 切到后台时立刻结账：移动端后续可能连 pagehide 都跑不到
    if (!visible) tracker.flush()
  }
  const onPageHide = () => {
    tracker.setVisible(false)
    tracker.flush()
  }

  for (const type of INTERACTION_EVENTS) {
    const handler = type === 'scroll' ? onScroll : onInteraction
    window.addEventListener(type, handler, { passive: true })
  }
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('pagehide', onPageHide)

  // 首屏先量一次；后续每次客户端导航由 AnalyticsInit 在 enter() 之后再量
  // （见 sampleScrollDepth 的注释）
  sampleScrollDepth(tracker)

  return () => {
    for (const type of INTERACTION_EVENTS) {
      const handler = type === 'scroll' ? onScroll : onInteraction
      window.removeEventListener(type, handler)
    }
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('pagehide', onPageHide)
  }
}
