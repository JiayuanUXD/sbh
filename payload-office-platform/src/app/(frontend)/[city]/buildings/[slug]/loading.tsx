import React from 'react'
import { Skeleton } from '@/components/frontend/ui/States'

/**
 * 楼盘详情路由骨架（OPT-068）。
 *
 * 从楼盘列表点进详情，服务端渲染完成前浏览器停在上一页（线上冷开 2.8–4.1 秒）。
 * 有了这份 `loading.tsx`，Next 立刻切页并显示骨架，用户看到的是「进来了、正在加载」
 * 而不是「点了没反应」。
 *
 * 骨架结构对齐真实首屏（标题 → 画廊 16:10 → 右侧决策卡 → 概况面板两列），
 * 避免真实内容到达时版式跳动。整块 `aria-hidden`，只由外层的 `aria-busy` +
 * `aria-label` 向辅助技术宣告状态，不让屏幕阅读器逐块念占位。
 */
export default function BuildingDetailLoading() {
  return (
    <div className="dt-page" aria-busy="true" aria-label="正在加载楼盘详情">
      <div className="dt-container dt-titlebar" aria-hidden="true">
        <Skeleton width="320px" height="14px" />
        <div style={{ marginTop: 12 }}>
          <Skeleton width="60%" height="30px" />
        </div>
      </div>
      <div className="dt-container dt-core" aria-hidden="true">
        <Skeleton height="420px" radius="var(--r-card)" />
        <div style={{ display: 'grid', gap: 12 }}>
          <Skeleton height="180px" radius="var(--r-card)" />
          <Skeleton height="120px" radius="var(--r-card)" />
        </div>
      </div>
      <div className="dt-container dt-section" aria-hidden="true">
        <Skeleton width="120px" height="24px" />
        <div style={{ marginTop: 16, display: 'grid', gap: 10 }}>
          <Skeleton height="18px" />
          <Skeleton height="18px" width="85%" />
          <Skeleton height="18px" width="70%" />
        </div>
      </div>
    </div>
  )
}
