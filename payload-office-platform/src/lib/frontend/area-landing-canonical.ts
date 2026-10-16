import type { Metadata } from 'next'
import { areaLandingPath, type AreaLandingKind } from '@/domain/public-catalog/area-landing'
import type { AreaLandingEntry } from '@/domain/public-catalog/area-landing-facade'

/**
 * 筛选页 → 落地页的 canonical 合并（OPT-119 §2.2）。
 *
 * `/{city}/listings?district=xuhui` 与 `/{city}/area/xuhui` 回答的是同一个搜索意图。落地页是
 * 内容页，筛选页是工具页，所以**仅当**规范化后的查询恰好只有一个 `district` 或一个
 * `businessArea` 时，筛选页的 canonical 指向落地页；叠加了任何其它条件（类型 / 面积 / 价格 /
 * 等级 / 排序 / 页码 / 出售口径）都是不同的结果集，保持自 canonical，不动。
 *
 * 输入是各列表路由已经算好的 canonical 查询串（`buildCanonicalSearchParams` /
 * `buildBuildingCanonicalParams`），不是原始 URL，所以键序与默认值已经规范化。
 */

export type LocationFilterTarget = Readonly<{ kind: AreaLandingKind; slug: string }>

export function locationFilterTarget(canonicalQuery: string): LocationFilterTarget | null {
  const params = new URLSearchParams(canonicalQuery)
  const keys = [...params.keys()]
  if (keys.length !== 1) return null
  const [key] = keys
  const values = params.getAll(key)
  if (values.length !== 1 || values[0] === '') return null
  if (key === 'district') return { kind: 'district', slug: values[0] }
  if (key === 'businessArea') return { kind: 'business_area', slug: values[0] }
  return null
}

/** 目标落地页存在且达到收录门槛时返回它的路径；否则 null（保持自 canonical）。 */
export async function resolveAreaLandingCanonicalPath(
  citySlug: string,
  canonicalQuery: string,
  loadIndex: (citySlug: string) => Promise<readonly AreaLandingEntry[]>,
): Promise<string | null> {
  const target = locationFilterTarget(canonicalQuery)
  if (!target) return null
  try {
    const entry = (await loadIndex(citySlug)).find((item) => item.kind === target.kind && item.slug === target.slug)
    return entry?.indexable ? areaLandingPath(citySlug, entry.slug) : null
  } catch {
    // 统计查询失败只意味着少合并一次 canonical，不该拖垮筛选页本身——但要留痕，别静默吞掉。
    console.error('[area-landing] canonical_index_unavailable')
    return null
  }
}

/** 只替换 canonical 与 og:url，其余 metadata 原样保留。 */
export function withAreaLandingCanonical(metadata: Metadata, landingPath: string, siteOrigin: string): Metadata {
  return {
    ...metadata,
    alternates: { ...metadata.alternates, canonical: landingPath },
    ...(metadata.openGraph ? { openGraph: { ...metadata.openGraph, url: `${siteOrigin}${landingPath}` } } : {}),
  }
}
