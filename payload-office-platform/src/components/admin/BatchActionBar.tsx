'use client'

import type { ReactNode } from 'react'
import { Typography } from '@arco-design/web-react'

/**
 * 列表批量操作条（OPT-113，楼盘库与房源列表共用）。
 *
 * 单独占一行放在筛选行与表格之间，而不是挤在筛选行右侧：楼盘库有上下架 + 启停两组按钮，
 * 1440 视口下与五个筛选控件放在同一行会把筛选和按钮一起挤到折行（实测）。
 * 按钮由调用方按权限传入；没有任何批量权限时调用方整条不渲染。
 */
export default function BatchActionBar({
  selectedCount,
  children,
}: {
  selectedCount: number
  children: ReactNode
}) {
  return (
    <div
      style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}
    >
      <Typography.Text type="secondary" style={{ fontSize: 13, marginRight: 4 }}>
        已选 {selectedCount} 项
      </Typography.Text>
      {children}
    </div>
  )
}
