import type { PublicationStatus } from '@/domain/review/publication-status'

/**
 * 后台「发布状态」标签的配色，房源列表与编辑页动作条共用（OPT-086 PR1）。
 *
 * 单独抽一份的理由：同一个发布态在列表和编辑页必须是同一个颜色，否则运营会
 * 以为是两种东西。此前两处各存了一份字面量表，改一处不会让另一处红——
 * 只有真的把两个页面并排看才发现得了，属于最容易长期漂移的那类重复。
 *
 * 键类型钉成 `PublicationStatus`：状态枚举加一个值而这里没跟上，typecheck 直接红。
 * 取值前请先用 `isPublicationStatus` 收窄，未知值一律回落 'gray'。
 *
 * 值是 Arco Tag 的 color（预设色名，不是十六进制），与 Arco 主题联动。
 */
export const PUBLICATION_STATUS_TAG_COLORS: Record<PublicationStatus, string> = {
  draft: 'gray',
  published: 'green',
  unpublished: 'orange',
  leased: 'arcoblue',
  sold: 'purple',
}
