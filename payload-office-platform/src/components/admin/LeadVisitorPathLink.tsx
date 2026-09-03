'use client'

import { useFormFields } from '@payloadcms/ui'

import { isVisitorRef } from '@/domain/inquiry/visitor-ref-shape'
import { resolveUmamiConfig } from '@/lib/frontend/analytics/umami-config'

/**
 * 线索详情的「转化前浏览路径」入口（OPT-067）
 *
 * 深链到 Umami 的会话视图，按该线索的假名标识过滤。**不在 Payload 内重绘**
 * 浏览路径——Umami 已经有做得更好的会话视图，重画一份只会多一份要维护的
 * 半成品，且必然落后于上游。
 *
 * ## URL 形状是实测出来的
 *
 * ```
 * {UMAMI_URL}/websites/{websiteId}/sessions?distinctId={visitorRef}
 * ```
 *
 * 2026-09-03 在 v3.3.1 上验过：带该参数打开 Sessions 页，界面显示
 * 「筛选器 · 唯一ID · 等于 · <值>」并按之过滤。API 接受某个参数**不代表**
 * UI 也接受，所以这条是直接在 UI 上验的，不是从 API 契约推的。
 *
 * ## 三种不渲染的情况
 *
 * - 该线索没有 visitorRef（OPT-067 之前的历史线索）→ 不渲染
 * - 未接入 Umami（`NEXT_PUBLIC_UMAMI_*` 未配）→ 不渲染，给不出可用链接
 * - 值形状不合法 → 不渲染，宁可没入口也不给一个必然 404 的链接
 */
export default function LeadVisitorPathLink(): React.ReactElement | null {
  const visitorRef = useFormFields(([fields]) => fields?.visitorRef?.value)
  const umami = resolveUmamiConfig()

  if (!umami || !isVisitorRef(visitorRef)) return null

  // umami.src 已由 resolveUmamiConfig 归一为 origin（只去尾斜杠），
  // 生产值是 https://umami-….tcloudbase.com，不含 /script.js——
  // 不加多余的路径剥离：那段永远不执行，却会让读者以为 src 可能带路径。
  const href = `${umami.src}/websites/${encodeURIComponent(umami.websiteId)}`
    + `/sessions?distinctId=${encodeURIComponent(visitorRef)}`

  return (
    <div className="lead-visitor-path">
      <a href={href} target="_blank" rel="noopener noreferrer">
        查看转化前浏览路径 ↗
      </a>
      <span className="lead-visitor-path__hint">
        在统计后台按该客户本次访问的假名标识过滤，展示提交咨询前浏览过的页面。
      </span>
    </div>
  )
}
