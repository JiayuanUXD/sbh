import React from 'react'

import { MAX_PUBLIC_PAGE } from '@/domain/public-catalog/page-cap'

/**
 * OPT-128 §5.7 · 页码封顶提示 —— Server Component，渲染在 ListPager 之后。
 *
 * 真实总页数超过 MAX_PUBLIC_PAGE 时，分页器只显示前 MAX_PUBLIC_PAGE 页。
 * 这里如实说明「结果较多、只显示前 N 页」并引导加筛选条件，不得让用户
 * 误以为这套筛选总共就这么多。`capped` 来自分页元数据（Pagination.capped /
 * BuildingFilteredResult.capped），必填、无默认值：语境相关文案一律必填。
 */
export default function PagerCapNote(props: Readonly<{ capped: boolean }>): React.JSX.Element | null {
  if (!props.capped) return null
  return (
    <p className="ls-pager__capnote">
      结果较多，仅显示前 {MAX_PUBLIC_PAGE} 页，请增加筛选条件缩小范围。
    </p>
  )
}
