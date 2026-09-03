import type { Endpoint, PayloadRequest } from 'payload'

import { requireAdminContext, type RequestContext } from '@/domain/auth/access'
import { hasOperationPermission } from '@/domain/auth/permission-context'
import type { PermissionContext } from '@/domain/auth/permission-context'
import {
  computeMissRate,
  FUNNEL_ENTRY_PAGE_TYPES,
  INQUIRY_FUNNEL_SOURCE_PAGE_TYPES,
  isTrafficRange,
  resolveTrafficWindow,
  TRAFFIC_RANGES,
  type TrafficBlock,
  type TrafficOk,
  type TrafficRange,
  type TrafficUnavailableReason,
} from '@/domain/analytics/traffic'
import {
  createUmamiClient,
  missingUmamiEnvKeys,
  resolveUmamiServerConfig,
  type UmamiClient,
} from '@/domain/analytics/umami-client'

/**
 * 流量与转化漏斗 endpoint（OPT-066）
 *
 * 路由：`GET /api/traffic?range=yesterday|7d|30d`
 *
 * ## 缓存必须分层，不能整体按 range 缓存
 *
 * 响应里有两类数据，可缓存性完全不同：
 *
 * - **Umami 那部分**（PV/UV/series/来源/落地页/漏斗）与调用方无关 → 按 range
 *   做 60s 进程内缓存。只读缓存，多实例各自缓存无一致性问题。
 * - **`leadsInWindow` / `missRate`** 来自 `overrideAccess: false` 的 count，
 *   **随调用方的 dataScope 收窄** → 每次请求单独算，绝不进缓存。
 *
 * 整体按 range 缓存会把 A 销售的线索聚合在 60 秒内原样返回给 B 销售——
 * 这是真实越权，不是理论风险（Codex review P1）。
 *
 * ## 非 global 调用方直接拿 null
 *
 * 为使口径不随查看者漂移，非 global dataScope 的调用方，`leadsInWindow` 与
 * `missRate` **在服务端就是 null**，不是「前端隐藏那一行」——隐藏 UI 不是权限
 * 控制，直接打 API 照样能拿到别人范围内的聚合。
 */

/** Umami 段缓存 TTL */
const UMAMI_CACHE_TTL_MS = 60_000

interface UmamiSegment {
  pageviews: number
  visitors: number
  series: TrafficOk['series']
  topReferrers: TrafficOk['topReferrers']
  topPages: TrafficOk['topPages']
  funnel: TrafficOk['funnel']
}

interface CacheEntry {
  at: number
  value: UmamiSegment
}

/** 进程内缓存：key = range。**只放与调用方无关的 Umami 数据。** */
const umamiCache = new Map<TrafficRange, CacheEntry>()

/** 测试用：清空缓存，避免用例间互相污染 */
export function __clearTrafficCache(): void {
  umamiCache.clear()
}

function readCache(range: TrafficRange, now: number): UmamiSegment | null {
  const hit = umamiCache.get(range)
  if (!hit) return null
  if (now - hit.at > UMAMI_CACHE_TTL_MS) {
    umamiCache.delete(range)
    return null
  }
  return hit.value
}

/** 详情页浏览量 = page_type 分布里落在 FUNNEL_ENTRY_PAGE_TYPES 的部分之和 */
export function sumDetailPageViews(
  rows: ReadonlyArray<{ value: string; total: number }>,
): number {
  let sum = 0
  for (const row of rows) {
    if ((FUNNEL_ENTRY_PAGE_TYPES as readonly string[]).includes(row.value)) sum += row.total
  }
  return sum
}

/** 从事件名计数表里取一个事件的量；缺失记 0（没有该事件＝没发生过） */
function eventCount(rows: ReadonlyArray<{ x: string; y: number }>, name: string): number {
  for (const row of rows) {
    if (row.x === name) return row.y
  }
  return 0
}

/**
 * 拉取 Umami 段（与调用方无关，可缓存）。
 *
 * ## 逐项降级，不是全有或全无
 *
 * 初版用 `Promise.all`，任一查询失败整块 unavailable。线上因此被一个查询拖垮：
 * `/metrics` 的某个 `type` 取值 v3 不认，于是 PV/UV/趋势/漏斗**全都看不到**，
 * 尽管它们各自的查询是好的。
 *
 * 业务块早就是「单卡失败隔离」（resolveSingleCard），流量块没有理由更差。
 * 现在只有 `stats` 是硬依赖——PV/UV 都没有的话这一块没有意义；
 * 其余各自降级，失败项按类型单独记日志。
 *
 * 降级后的表示遵循同一条原则：**拿不到就是 null，不是 0**。
 * 漏斗某步为 null 表示「这一环没测到」，与「发生了 0 次」含义相反。
 */
/**
 * 收 thunk 而不是 Promise——**这个区别是必须的**。
 *
 * 初版收的是已创建的 Promise：`settle('x', client.x(w))`。这样调用发生在
 * settle 之外，一旦某个 `client.x` **同步抛**（例如桩缺方法、undefined 不是
 * 函数），`Promise.all(...)` 那一整句还没构造出来就炸了，数组里先创建的
 * Promise（stats）没人接管 → Node 报 unhandled rejection，vitest 直接判定
 * 整轮失败，而具体测试**照样显示通过**（端点把 TypeError 也当失败处理，
 * 断言恰好成立）。
 *
 * 收 thunk 后，调用本身在 try 内发生，同步抛与异步拒绝一视同仁。
 */
async function settle<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn()
  } catch (err) {
    console.error(
      `[traffic] ${label} 查询失败：`,
      err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    )
    return null
  }
}

export async function fetchUmamiSegment(
  client: UmamiClient,
  window: { startAt: number; endAt: number },
): Promise<UmamiSegment> {
  const [stats, series, referrers, pages, events, pageTypes] = await Promise.all([
    // stats 是硬依赖：失败就抛，让整块 unavailable。
    // 包一层 async IIFE 把同步抛也变成拒绝，避免它在数组构造阶段炸掉整句。
    (async () => client.stats(window))(),
    settle('pageviews', () => client.pageviews(window)),
    settle('metrics(referrer)', () => client.metrics('referrer', window)),
    // ⚠️ 是 'path' 不是 'url'。v3.3.1 实测：type=url 与 type=host 都返回
    // 400 Bad request，type=path 正常返回。取值是在 Umami 后台用它自己的
    // 会话逐个试出来的（合法：path/referrer/event/title/browser/os/device/
    // country/query/tag/channel；非法：url/host），不是照文档猜的。
    settle('metrics(path)', () => client.metrics('path', window)),
    settle('metrics(event)', () => client.metrics('event', window)),
    // 漏斗首步：city_page_view 事件里 page_type ∈ {listing-detail, building-detail} 的部分
    settle('event-data/values(city_page_view.page_type)', () =>
      client.eventDataValues('city_page_view', 'page_type', window),
    ),
  ])

  return {
    pageviews: stats.pageviews,
    visitors: stats.visitors,
    series: series ?? [],
    topReferrers: (referrers ?? []).slice(0, 10).map((r) => ({ name: r.x, visitors: r.y })),
    topPages: (pages ?? []).slice(0, 10).map((r) => ({ path: r.x, pageviews: r.y })),
    funnel: {
      // 首步：只数详情页。用 event-data/values 按 page_type 过滤，
      // 而不是拿「全部 city_page_view」顶替——后者会把首页与列表页的流量
      // 算进漏斗口（实测近 7 日 home=7、listings=2，而详情页只有 3），
      // 转化率会看起来低得离谱且没人能发现。
      // 查询失败时是 null（「没测到」），不是 0（「没人看详情页」）。
      detailView: pageTypes === null ? null : sumDetailPageViews(pageTypes),
      // 事件查询整个失败时，四步全是 null（「没测到」），不是 0（「没发生」）
      inquiryOpen: events ? eventCount(events, 'inquiry_open') : null,
      inquirySubmit: events ? eventCount(events, 'inquiry_submit') : null,
      inquirySuccess: events ? eventCount(events, 'inquiry_success') : null,
    },
  }
}

/**
 * 统计窗口内「咨询弹窗链路」的真实线索数。
 *
 * - `overrideAccess: false`：读取范围随 `leadReadAccess` 的 dataScope 收窄
 * - 非 global dataScope → 直接返回 null（见文件头注释）
 * - 判据用入口枚举而非「sourcePageType 非空」，理由见
 *   `traffic.ts` 的 `INQUIRY_FUNNEL_SOURCE_PAGE_TYPES` 注释
 */
export async function countFunnelLeads(
  req: PayloadRequest,
  permission: PermissionContext,
  window: { startAt: number; endAt: number },
): Promise<number | null> {
  if (permission.dataScope !== 'global') return null

  const result = (await req.payload.count({
    collection: 'leads',
    overrideAccess: false,
    req,
    where: {
      and: [
        { createdAt: { greater_than_equal: new Date(window.startAt).toISOString() } },
        { createdAt: { less_than: new Date(window.endAt).toISOString() } },
        // 字段是**顶层**的 sourcePageType，不是 source.sourcePageType——
        // Leads.ts 里它的上层容器全是 collapsible（纯展示，不产生数据层级），
        // 写入侧 /api/inquiries 也是扁平写 `sourcePageType: ...`。
        // 写成带层级的路径会被 Payload 拒绝（"path cannot be queried"），
        // 与 merchants.active 那个 deletedAt 是同一种 bug。
        { sourcePageType: { in: [...INQUIRY_FUNNEL_SOURCE_PAGE_TYPES] } },
      ],
    },
  })) as unknown as { totalDocs?: number }

  return typeof result.totalDocs === 'number' ? result.totalDocs : 0
}

/**
 * 可注入的依赖。生产不传，走真实实现；测试用它把 Umami 换成桩，
 * 从而能断言「Umami 段命中缓存、线索段每次重算」——那条是越权防线，
 * 必须在 handler 层验，光验纯函数覆盖不到。
 */
export interface TrafficEndpointDeps {
  resolveConfig?: typeof resolveUmamiServerConfig
  createClient?: (config: ReturnType<typeof resolveUmamiServerConfig>) => UmamiClient
  now?: () => Date
}

export function createTrafficEndpoint(deps: TrafficEndpointDeps = {}): Endpoint {
  const resolveConfig = deps.resolveConfig ?? resolveUmamiServerConfig
  const makeClient =
    deps.createClient ?? ((config) => createUmamiClient({ config: config! }))
  const clock = deps.now ?? (() => new Date())

  return {
    path: '/traffic',
    method: 'get',
    handler: async (req) => {
      let permission
      try {
        permission = await requireAdminContext(req as RequestContext)
      } catch (err) {
        const message = err instanceof Error ? err.message : '未登录'
        return Response.json({ ok: false, error: message }, { status: 401 })
      }

      if (!hasOperationPermission(permission, 'analytics:traffic')) {
        return Response.json({ ok: false, error: '无流量看板查看权限' }, { status: 403 })
      }

      const rangeRaw = req.searchParams?.get('range') ?? 'yesterday'
      if (!isTrafficRange(rangeRaw)) {
        return Response.json(
          { ok: false, error: `range 只接受 ${TRAFFIC_RANGES.join(' / ')}` },
          { status: 400 },
        )
      }
      const range: TrafficRange = rangeRaw

      const now = clock()
      const window = resolveTrafficWindow(range, now)

      // ── Umami 段（可缓存，与调用方无关）─────────────────────────────
      //
      // 降级必须留下诊断痕迹。初版这里是裸的 `catch { segment = null }`，
      // 上线首日就吃了亏：线上显示「暂不可用」，而「没配」「配了连不上」
      // 「凭据不对」在响应里长得一模一样，只能靠「响应耗时 38ms」这种间接证据
      // 倒推。静默降级 ≠ 优雅降级——不留线索的降级是把故障藏起来。
      let segment = readCache(range, now.getTime())
      let reason: TrafficUnavailableReason = 'upstream-error'

      if (!segment) {
        const config = resolveConfig()
        if (!config) {
          reason = 'not-configured'
          // 只打键名，绝不打值
          console.error(
            '[traffic] Umami 未配置，缺失的键：',
            missingUmamiEnvKeys().join(', ') || '(全部存在但解析失败)',
          )
        } else {
          try {
            segment = await fetchUmamiSegment(makeClient(config), window)
            umamiCache.set(range, { at: now.getTime(), value: segment })
          } catch (err) {
            // 原文留在服务端日志（可能含内部主机名或上游返回内容），响应只回枚举
            reason = 'upstream-error'
            console.error(
              '[traffic] 调用 Umami 失败：',
              err instanceof Error ? `${err.name}: ${err.message}` : String(err),
            )
            segment = null
          }
        }
      }

      if (!segment) {
        const traffic: TrafficBlock = { status: 'unavailable', reason }
        return Response.json({ ok: true, asOf: now.toISOString(), range, traffic })
      }

      // ── 线索段（每次请求单独算，绝不进缓存）──────────────────────────
      let leadsInWindow: number | null = null
      try {
        leadsInWindow = await countFunnelLeads(req, permission, window)
      } catch (err) {
        // 又一次静默 catch 的教训：上线后 global 范围管理员的 leadsInWindow
        // 恒为 null，而这里什么都没记，只能靠翻代码猜——实际是字段路径写错了。
        console.error(
          '[traffic] 线索计数失败：',
          err instanceof Error ? `${err.name}: ${err.message}` : String(err),
        )
        leadsInWindow = null
      }

      const traffic: TrafficOk = {
        status: 'ok',
        ...segment,
        leadsInWindow,
        missRate:
          segment.funnel.inquirySuccess === null
            ? null
            : computeMissRate(segment.funnel.inquirySuccess, leadsInWindow),
      }

      return Response.json({ ok: true, asOf: now.toISOString(), range, traffic })
    },
  }
}
