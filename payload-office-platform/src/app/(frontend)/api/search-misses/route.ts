/**
 * 站内搜索未命中词采集端点（OPT-126 P1，POST /api/search-misses）。
 *
 * 由 SearchMissBeacon 用 `navigator.sendBeacon` 调用，只收 `{ city, q }`。
 *
 * 守护不变量：
 *   - 仅 POST + application/json + 同源（缺 Origin 即拒）；body ≤ 2KB；
 *   - 限流每 IP 每分钟 20 次，键 `search-miss:` 前缀，与询盘 / 纠错配额隔离；
 *     PG 限流表不可用时放行（failOpen），统计宁可少记也不拦用户；
 *   - 结果数不信客户端，服务端用搜索页同一组 cached 查询复核；
 *   - 文本只进自有表，且只存脱敏归一化词；响应与日志里没有任何查询文本；
 *   - 处理过的请求（无论是否入库）一律 204，不向调用方暴露分类结果；
 *   - 保留期清理（§9）顺带在此执行：每实例每小时一次 DELETE，失败只记 warn，不影响响应。
 */

import { getPayload } from 'payload'
import { NextResponse } from 'next/server'

import config from '@/payload.config'
import { resolveCityContext } from '@/app/(frontend)/_lib/city-context'
import { hashIpForLog } from '@/domain/corrections'
import { clientIp, extractPgPool, isSameOriginHost, isStrictJsonContentType } from '@/lib/api/request-guards'
import {
  getCachedSiteSearchArticles,
  getCachedSiteSearchBuildings,
  getCachedSiteSearchListings,
} from '@/lib/frontend/cached-queries'
import { runDistributedRateLimit, type PruneTimestampRef } from '@/lib/rate-limit-distributed'
import { SEARCH_MISS_RATE_LIMIT_CONFIG } from '@/lib/rate-limit-config'
import { createPgRateLimitDeps, type PoolLike } from '@/lib/rate-limit-pg'
import {
  parseSearchMissBody,
  recordSearchMiss,
  type RecordSearchMissDeps,
} from '@/lib/search-miss/record-search-miss'
import { maybePruneSearchMissTerms } from '@/lib/search-miss/prune-search-miss'
import { upsertSearchMiss } from '@/lib/search-miss/upsert-search-miss'

import { searchMissPruneRef } from './prune-state'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** body 上限：`{city,q}` 最长也就几百字节，2KB 足够。 */
const MAX_BODY_BYTES = 2 * 1024

/** 跨请求共享的 TTL 清理时间戳（模块级）。 */
const ratePruneRef: PruneTimestampRef = { value: 0 }

function noContent(): Response {
  return new Response(null, { status: 204 })
}

function reject(status: number, headers?: HeadersInit): Response {
  return new Response(null, { status, headers })
}

export async function POST(req: Request): Promise<Response> {
  if (!isSameOriginHost(req)) return reject(403)
  if (!isStrictJsonContentType(req.headers.get('content-type'))) return reject(415)
  if (Number(req.headers.get('content-length') ?? '0') > MAX_BODY_BYTES) return reject(413)

  let body: unknown
  try {
    const raw = await req.text()
    if (raw.length > MAX_BODY_BYTES) return reject(413)
    body = JSON.parse(raw)
  } catch {
    return reject(400)
  }
  const input = parseSearchMissBody(body)
  if (!input) return reject(400)

  const payload = await getPayload({ config })
  const pool = extractPgPool(payload.db)

  try {
    // 限流：PG 异常由 failOpen 放行；pool 取不到则跳过限流（后面的 upsert 也会失败，不会落库）。
    if (pool) {
      const ipHash = hashIpForLog(clientIp(req), new Date().toISOString().slice(0, 10))
      const rate = await runDistributedRateLimit(
        createPgRateLimitDeps(pool as PoolLike),
        SEARCH_MISS_RATE_LIMIT_CONFIG,
        `search-miss:${ipHash}`,
        ratePruneRef,
      )
      if (rate.failedOpen) {
        payload.logger.warn('search_miss_rate_limit_store_unavailable_fail_open')
      }
      if (!rate.allowed) {
        return reject(429, { 'Retry-After': String(rate.retryAfterSeconds) })
      }
    }

    const deps: RecordSearchMissDeps = {
      resolveCollectableCity: async (slug) => {
        const city = await resolveCityContext(slug)
        return city && city.serviceStatus !== 'coming-soon' ? city.slug : null
      },
      loadResults: async (citySlug, q) => {
        // 与 /[city]/search 渲染同一组查询、同一组缓存键（page=1）。
        const [listings, buildings, articles] = await Promise.all([
          getCachedSiteSearchListings(citySlug, q, 1),
          getCachedSiteSearchBuildings(citySlug, q, 1),
          getCachedSiteSearchArticles(q, 1),
        ])
        return {
          counts: {
            listings: listings?.result.pagination.totalDocs ?? 0,
            buildings: buildings?.result.totalDocs ?? 0,
            news: articles?.totalDocs ?? 0,
          },
          relaxed: listings?.relaxed ?? false,
        }
      },
      upsert: async (row) => {
        if (!pool) throw new Error('search_miss_pool_unavailable')
        await upsertSearchMiss(pool as PoolLike, row)
      },
    }

    const outcome = await recordSearchMiss(input, deps)
    // 只记结果枚举：被丢弃的按原因计数（`dropped:*`），日志里没有任何查询文本。
    payload.logger.info({ outcome }, 'search_miss_outcome')

    // 保留期清理：放在响应之前但独立 try，失败不改变结果；每实例每小时最多一次。
    if (pool) {
      try {
        const pruned = await maybePruneSearchMissTerms(pool as PoolLike, searchMissPruneRef, Date.now())
        if (pruned.ran) payload.logger.info({ deleted: pruned.deleted }, 'search_miss_pruned')
      } catch (error) {
        payload.logger.warn({ err: error }, 'search_miss_prune_failed')
      }
    }
    return noContent()
  } catch (error) {
    payload.logger.error({ err: error }, 'search_miss_failed')
    return reject(500)
  }
}

function methodNotAllowed(): Response {
  return reject(405, { Allow: 'POST' })
}

export const GET = methodNotAllowed
export const PUT = methodNotAllowed
export const PATCH = methodNotAllowed
export const DELETE = methodNotAllowed
