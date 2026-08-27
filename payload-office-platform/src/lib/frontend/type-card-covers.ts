import type { MediaViewModel } from '@/domain/public-catalog/contracts'
import { mapMedia } from '@/domain/public-catalog/mappers'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

/**
 * 「按类型浏览」的单城封面覆盖（OPT-060）。
 *
 * **刻意不返回 MappingResult。** 本文件其余映射失败会让整份 profile 变 null,
 * 那对必填的结构性字段是对的；但封面覆盖是纯装饰性的运营配置，配错一行不该
 * 让整座城市首页降级。所以这里的策略是**逐行丢弃**：不合格的行不进结果，
 * 其余行照常。
 *
 * 同槽位重复配置时取**首次出现**的那行（与 orderByFeaturedRegions 处理重复
 * slug 的口径一致）。
 */
export function mapTypeCardOverrides(
  value: unknown,
): readonly Readonly<{ slot: string; coverImage: MediaViewModel }>[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const rows: Array<{ slot: string; coverImage: MediaViewModel }> = []
  for (const raw of value) {
    if (!isRecord(raw)) continue
    const slot = raw.slot
    if (typeof slot !== 'string' || slot.length === 0 || seen.has(slot)) continue
    // mapMedia 是 URL 白名单，映射不出安全 URL 就丢这一行
    const cover = mapMedia(raw.coverImage, slot)
    if (!cover) continue
    seen.add(slot)
    rows.push({ slot, coverImage: cover })
  }
  return rows
}
