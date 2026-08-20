'use client'

import React, { useRef, useState } from 'react'
import type { FilterRow } from '@/components/frontend/listing/FilterFormC'
import MobileFilterSheet from '@/components/frontend/listing/MobileFilterSheet'
import MobileFilterTrigger from '@/components/frontend/listing/MobileFilterTrigger'

/**
 * OPT-036 Task 10（MobileFilterSheet / MobileFilterTrigger）可交互预览壳。
 *
 * 为什么单独拆一个 client 文件，而不是像其它九个区块那样直接写进
 * `dev-story/opt036/page.tsx`：那个页面是 Server Component（用到
 * `notFound()` 做生产环境 404 门槛），而 Trigger/Sheet 的开合是真实
 * `useState`——Esc 关闭、焦点归还、背景滚动锁定这几条验收断言都要求「真的
 * 点了会关」，硬编码 `open` 常量 + 空 `onClose` 会让断言测的是假行为。只把
 * 这一个区块单独抽成 client 组件，其余九个区块继续留在 Server Component 里，
 * 不需要把整页面标 `'use client'`。
 *
 * 两个组件本身都用真实 `position: fixed`（相对浏览器视口，不是相对某个容器）
 * ——这与生产环境行为一致，也是本仓库既有惯例（见
 * `artifacts/verification/OPT-036/task3/home-375-full.png`：此前的移动态
 * 截图都是把 Playwright viewport 整体设成 375×812 后截全页，不是在桌面视口
 * 里拿一个裁切容器伪造「看起来像手机」）。因此本组件不做设备框 mock，截图
 * 验收时请把 viewport 设为 375×812 再进入本页滚动到这个区块。
 */

const ROWS_WITH_PICKS: readonly FilterRow[] = [
  {
    key: 'district',
    label: '区域',
    activeValue: 'jingan',
    options: [
      { value: 'jingan', label: '静安', count: 412 },
      { value: 'huangpu', label: '黄浦', count: 286 },
      { value: 'xuhui', label: '徐汇', count: 241 },
      { value: 'pudong', label: '浦东', count: 508 },
      { value: 'changning', label: '长宁', count: 176 },
    ],
  },
  {
    key: 'type',
    label: '类型',
    activeValue: 'full-floor',
    options: [
      { value: 'traditional-office', label: '传统办公', count: 946 },
      { value: 'full-floor', label: '整层办公', count: 318 },
      { value: 'serviced-office', label: '独栋办公', count: 94 },
    ],
  },
  {
    key: 'priceBucket',
    label: '价格',
    options: [
      { value: 'lt-3', label: '3 元以下' },
      { value: '3-5', label: '3-5 元' },
      { value: '5-8', label: '5-8 元' },
      { value: 'gt-8', label: '8 元以上' },
    ],
  },
  {
    key: 'availableWithin',
    label: '可入驻时间不晚于',
    options: [
      { value: 'any', label: '随时' },
      { value: '1m', label: '1 个月内' },
      { value: '3m', label: '3 个月内' },
    ],
  },
]

const ROWS_EMPTY: readonly FilterRow[] = ROWS_WITH_PICKS.map((row) => ({ ...row, activeValue: undefined }))

const PARAMS_WITH_PICKS = new URLSearchParams([
  ['district', 'jingan'],
  ['type', 'full-floor'],
])

export default function MobileFilterPreview(): React.JSX.Element {
  const [hasPicks, setHasPicks] = useState(true)
  const [open, setOpen] = useState(false)
  // MobileFilterSheet.triggerRef 必填：同一个 ref 分别交给 Trigger 的
  // forwardRef（拿到真实按钮节点）和 Sheet（关闭后归还焦点用），示例见
  // MobileFilterSheet.tsx 顶部「焦点管理」注释。
  const triggerButtonRef = useRef<HTMLButtonElement>(null)

  const rows = hasPicks ? ROWS_WITH_PICKS : ROWS_EMPTY
  const activeCount = rows.reduce((n, row) => (row.activeValue != null ? n + 1 : n), 0)
  const totalDocs = hasPicks ? 168 : 1893
  const currentParams = hasPicks ? PARAMS_WITH_PICKS : new URLSearchParams()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--ink-3, var(--ink-2))' }}>
          演示用切换（不是组件本身的 UI，仅用于分别截图「有条件」/「无条件」两态）：
        </span>
        <button
          type="button"
          data-testid="demo-toggle-picks"
          onClick={() => setHasPicks((v) => !v)}
          style={{
            height: 28, padding: '0 12px', borderRadius: 980, border: '1px solid var(--line)',
            background: 'var(--bg-subtle)', color: 'var(--ink)', fontSize: 12, cursor: 'pointer',
          }}
        >
          {hasPicks ? '切到：无条件（悬浮入口不应显示徽标）' : '切到：有条件（2 项，悬浮入口应显示徽标）'}
        </button>
      </div>

      <MobileFilterTrigger
        ref={triggerButtonRef}
        activeCount={activeCount}
        totalDocs={totalDocs}
        countNoun="套"
        onOpen={() => setOpen(true)}
      />

      <MobileFilterSheet
        rows={rows}
        open={open}
        onClose={() => setOpen(false)}
        basePath="/shanghai/listings"
        currentParams={currentParams}
        totalDocs={totalDocs}
        countNoun="套"
        triggerRef={triggerButtonRef}
      />
    </div>
  )
}
