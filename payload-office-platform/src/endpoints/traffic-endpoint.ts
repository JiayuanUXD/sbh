import type { Endpoint, PayloadRequest } from 'payload'

import { requireAdminContext, type RequestContext } from '@/domain/auth/access'
import { hasOperationPermission } from '@/domain/auth/permission-context'
import type { PermissionContext } from '@/domain/auth/permission-context'
import {
  computeMissRate,
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
async function settle<T>(label: string, p: Promise<T>): Promise<T | null> {
  try {
    return await p
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
  // stats 是硬依赖：失败就抛，让整块 unavailable
  const statsPromise = client.stats(window)

  const [stats, series, referrers, pages, events] = await Promise.all([
    statsPromise,
    settle('pageviews', client.pageviews(window)),
    settle('metrics(referrer)', client.metrics('referrer', window)),
    settle('metrics(url)', client.metrics('url', window)),
    settle('metrics(event)', client.metrics('event', window)),
  ])

  return {
    pageviews: stats.pageviews,
    visitors: stats.visitors,
    series: series ?? [],
    topReferrers: (referrers ?? []).slice(0, 10).map((r) => ({ name: r.x, visitors: r.y })),
    topPages: (pages ?? []).slice(0, 10).map((r) => ({ path: r.x, pageviews: r.y })),
    funnel: {
      // ⚠️ 首步暂缺：`city_page_view` 在所有城市页都会打（首页/列表/详情），
      // 要取「仅详情页」那部分必须按事件属性 page_type 过滤，而属性过滤走
      // Umami 的 event-data API——该接口在本次实测中**鉴权先于参数校验**
      // （type=bogus 直接回 401），没有凭据无法确定其参数契约。
      //
      // 宁可缺一环也不给错数：拿「全部 city_page_view」冒充「详情页浏览」会把
      // 首页与列表页的流量算进漏斗口，转化率看起来低得离谱，且没人能发现。
      // 配齐 UMAMI_* 四个服务端 env 后用真凭据验出契约再补。
      detailView: null,
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
        { 'source.sourcePageType': { in: [...INQUIRY_FUNNEL_SOURCE_PAGE_TYPES] } },
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
      } catch {
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
