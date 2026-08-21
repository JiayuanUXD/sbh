import { normalizeBuildingName } from '@/domain/supply/building-dedup'

/**
 * 地理别名规范化：与楼盘名称规范化复用同一套规则（全角转半角、折叠空白、转小写），
 * 保证导入表里的地名写法差异（全角/半角、空格）不影响别名匹配。
 *
 * 最小实现：仅供 Task 1 的 LocationAliases 集合使用。Task 2 会在本文件补齐
 * 别名解析、候选匹配等其余函数，此处不预先实现。
 */
export function normalizeAliasText(value: unknown): string {
  return normalizeBuildingName(value)
}
