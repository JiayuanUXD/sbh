/**
 * 指标下钻 URL 生成（tasks.md M7.1 / R7）
 *
 * 设计目标：
 *   - 同一指标编码 + 同一查询上下文 → 下钻 URL 一致
 *   - 下钻参数仅由 metric.drilldown.filterKeys 决定，不允许客户端拼装
 *   - URL 路径中只能包含已 sanitize 的过滤键
 *
 * 业务不变量：卡片 = 图表点击 = 明细数量（design.md §7.3）
 */

import type { MetricDefinition, MetricQueryContext, MetricBucket } from './metric-types'

/** 下钻 URL 构建结果 */
export interface DrilldownUrl {
  /** 完整 URL 路径（含 query string） */
  url: string
  /** 目标 Collection slug（如 'listings' / 'tasks'），供前端校验 */
  collection?: string
}

/**
 * 构建下钻 URL。
 *
 * pathTemplate 支持的占位符：
 *   - {{collection}}：metric.drilldown.collection
 *   - {{filter_keys}}：自动拼接 sanitize 后的过滤参数（如 cityIds=1&cityIds=2）
 *   - {{bucket.label}}：当前桶标签（仅 series 类型下钻使用）
 *   - {{bucket.value}}：当前桶值
 *   - {{ctx.userId}}：调用者 ID
 *   - {{ctx.asOf}}：查询时间锚点 ISO
 *
 * @param metric 指标定义（必须含 drilldown）
 * @param ctx 查询上下文
 * @param bucket 当前桶（series 类型下钻时传入）
 */
export function buildDrilldownUrl(
  metric: MetricDefinition,
  ctx: MetricQueryContext,
  bucket?: MetricBucket,
): DrilldownUrl | null {
  if (!metric.drilldown) return null
  const d = metric.drilldown

  const replacements: Record<string, string> = {
    collection: d.collection ?? '',
    filter_keys: buildFilterQuery(ctx, d.filterKeys),
    'ctx.userId': String(ctx.permission.userId),
    'ctx.asOf': ctx.asOf.toISOString(),
  }

  if (bucket) {
    replacements['bucket.label'] = encodeURIComponent(bucket.label)
    replacements['bucket.value'] = String(bucket.value)
    // 把 bucket.metadata 平铺为 bucket.metadata.<key>
    if (bucket.metadata) {
      for (const [k, v] of Object.entries(bucket.metadata)) {
        if (v !== null && v !== undefined) {
          replacements[`bucket.metadata.${k}`] = encodeURIComponent(String(v))
        }
      }
    }
  }

  const url = replaceTemplate(d.pathTemplate, replacements)
  return {
    url,
    collection: d.collection,
  }
}

// ────────────────────────────────────────────────────────────
// 内部辅助
// ────────────────────────────────────────────────────────────

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g

function replaceTemplate(
  template: string,
  replacements: Record<string, string>,
): string {
  return template.replace(PLACEHOLDER_RE, (full, key: string) => {
    if (Object.prototype.hasOwnProperty.call(replacements, key)) {
      return replacements[key]
    }
    // 未知占位符保留原样（便于调试 / 后续扩展）
    return full
  })
}

/**
 * 按 filterKeys 顺序拼接过滤参数为 URL query string。
 *
 * 仅允许 metric.drilldown.filterKeys 中声明的键，禁止客户端拼装其他键。
 */
function buildFilterQuery(
  ctx: MetricQueryContext,
  filterKeys: ReadonlyArray<string>,
): string {
  const parts: string[] = []
  const filters = ctx.filters

  for (const key of filterKeys) {
    switch (key) {
      case 'cityIds':
        for (const id of filters.cityIds) {
          parts.push(`cityIds=${encodeURIComponent(String(id))}`)
        }
        break
      case 'teamIds':
        for (const id of filters.teamIds) {
          parts.push(`teamIds=${encodeURIComponent(String(id))}`)
        }
        break
      case 'merchantIds':
        for (const id of filters.merchantIds) {
          parts.push(`merchantIds=${encodeURIComponent(String(id))}`)
        }
        break
      case 'assigneeId':
        if (filters.assigneeId !== null) {
          parts.push(`assigneeId=${encodeURIComponent(String(filters.assigneeId))}`)
        }
        break
      case 'rangeStart':
        if (filters.range) {
          parts.push(`rangeStart=${encodeURIComponent(filters.range.start.toISOString())}`)
        }
        break
      case 'rangeEnd':
        if (filters.range) {
          parts.push(`rangeEnd=${encodeURIComponent(filters.range.end.toISOString())}`)
        }
        break
      default:
        // 未声明的 key 一律忽略（防止客户端注入）
        break
    }
  }

  return parts.join('&')
}
