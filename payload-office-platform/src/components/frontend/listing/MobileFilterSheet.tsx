'use client'

import Link from 'next/link'
import React, { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { buildHref, cloneSearchParams } from '@/lib/frontend/listing-url'
import type { FilterRow } from './FilterFormC'
import FilterPill from './FilterPill'

/**
 * 移动筛选抽屉（MobileFilterSheet）—— OPT-036 Task 10，client component。
 *
 * 设计依据：docs/SBH设计任务讨论/房源列表.dc.html「移动 375 · 筛选抽屉」区块 +
 * specRows「移动抽屉」：高 88% · 顶部圆角 24 · 底栏 48 高按钮 · 分组间距 24 +
 * 1px 分隔线；「移动状态栏留白」：标题栏 padding-top 未在本组件内实现——那是
 * 页面自身状态栏/吸顶条的留白，与抽屉内头部（本组件的 `.ls-msheet__head`）
 * 是两回事，抽屉从遮罩层顶部算起不需要再让出灵动岛。
 *
 * ## 为什么是独立 UI，不是桌面 FilterFormC 的等比缩小
 *
 * 桌面形态 C 是「结果比控件重要」的产品判断——横条不吸顶，随页面滚走，不占
 * 结果区视口（见 FilterFormC.tsx 顶部注释）。移动端屏幕本就小，筛选控件长期
 * 占屏更亏，于是产品判断反过来：默认完全不占用视口，靠底部悬浮 pill
 * （`MobileFilterTrigger`）随时召唤，召唤出来才用 88% 整屏承载。两种设备上
 * 「筛选常驻程度」的判断刚好相反，因此没有共享同一份组件实现的意义。
 *
 * ## 焦点管理：照抄 Modal.tsx，一处必要的偏离
 *
 * 与 `src/components/frontend/ui/Modal.tsx` 同一套做法：Esc 关闭、Tab 焦点
 * 锁定在弹层内、body 滚动锁定、关闭后归还焦点。**唯一不同**：Modal.tsx 靠
 * 调用方传入的 `triggerRef` 归还焦点；本组件的触发器是另一个独立组件
 * （`MobileFilterTrigger`），brief 给定的接口不携带 triggerRef，因此默认
 * 改为在打开的同一个 effect 里读 `document.activeElement` 并存起来——
 * `onOpen` 由触发器按钮的 onClick 同步调用，React 状态更新到这个 effect
 * 跑之间浏览器不会改变焦点，`document.activeElement` 在那一刻就是被点击的
 * 触发器按钮，多数浏览器下与显式 triggerRef 等价。
 *
 * 已知差距：Safari 的鼠标点击不会把焦点移到 `<button>`（键盘 Enter/Space
 * 激活则会），这种情况下 `document.activeElement` 捕获不到触发器，关闭后
 * 焦点归还会静默失败（不会报错，只是焦点留在 body）。为此仍然暴露可选的
 * `triggerRef` prop（与 Modal.tsx 同名同形状）：Task 11/12 接线如果愿意让
 * `MobileFilterTrigger` 用 `forwardRef` 暴露内部按钮，可以传进来获得与
 * Modal.tsx 完全一致的健壮性；不传时走上面的捕获兜底，不阻塞本任务交付。
 *
 * ## 抽屉内筛选项点击后的处置（brief 允许调用方自行决定，含理由）
 *
 * **不自动关闭。** 选项本身仍是导航 `<Link>`——点击立即改 URL、删 `page`
 * （与 FilterFormC/PriceUnitSegment 同一套约定），但不调用 `onClose`。
 * 理由：comp 的抽屉允许一次勾选多个分组（区域 + 类型 + 价格……）再统一查看
 * 结果，若每点一项就关闭，用户势必要来回重新打开好几次；而每次导航后页面
 * Server Component 重新渲染，`totalDocs` / `rows` 这两个 prop 会带着新值
 * 传回来（App Router 客户端过渡，不是整页刷新），抽屉里能看到结果数随点击
 * 实时变化——这正好对应 comp 底栏「查看 168 套」按钮上的活数字。
 *
 * 真正的关闭出口只有三个：点击遮罩、Esc、点击底栏「查看 N {countNoun}」——
 * 三者都不改变 URL，只是把已经通过导航写入地址栏的筛选状态收起来查看。不存在
 * 「仅存在于内存里、没有反映到 URL」的筛选态（brief 明令禁止的那种）。
 *
 * 头部与底栏各有一个「重置」（与 comp 一致，见 房源列表.dc.html:631,689）：
 * 两者语义相同（清空本组件渲染的所有 rows 对应的参数 + 删 page），都不
 * 自动关闭——重置后用户可能想立刻挑别的条件，强制关闭会打断这个流程。
 */

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'

/** 单个选项的 href：与 FilterFormC.buildOptionHref 同一语义（同一行内互斥、再点已选即取消）。 */
function buildOptionHref(
  basePath: string,
  currentParams: URLSearchParams,
  rowKey: string,
  optionValue: string,
  isActive: boolean,
): string {
  const sp = cloneSearchParams(currentParams)
  sp.delete('page')
  sp.delete(rowKey)
  if (!isActive) sp.set(rowKey, optionValue)
  return buildHref(basePath, sp)
}

/** 重置：清空本组件渲染的所有 rows 对应的参数（不限于 visibleRows——理由同 FilterFormC 的 buildClearAllHref）。 */
function buildResetHref(basePath: string, currentParams: URLSearchParams, rows: readonly FilterRow[]): string {
  const sp = cloneSearchParams(currentParams)
  sp.delete('page')
  for (const row of rows) sp.delete(row.key)
  return buildHref(basePath, sp)
}

function findActiveOption(row: FilterRow): FilterRow['options'][number] | undefined {
  if (row.activeValue == null) return undefined
  return row.options.find((option) => option.value === row.activeValue)
}

export default function MobileFilterSheet(props: Readonly<{
  rows: readonly FilterRow[]
  open: boolean
  onClose: () => void
  basePath: string
  currentParams: URLSearchParams
  totalDocs: number
  /**
   * 底栏「查看 N {countNoun}」的计数名词——与 `FilterFormC.countNoun` /
   * `MobileFilterTrigger.countNoun` 同一约定：必填、无默认值。brief 给的
   * 接口没有这个字段；没有它底栏按钮只能写「查看 N」这种不完整文案，属于
   * 本批次明令禁止的「接口没给这个信息就把文案降级」，因此开宽接口。
   * Task 11/12 接线必须提供（房源列表传「套」，楼盘列表传「个楼盘」）。
   */
  countNoun: string
  /** 见上方「焦点管理」注释：可选，不传时退化为捕获 document.activeElement。 */
  triggerRef?: React.RefObject<HTMLElement | null>
}>): React.JSX.Element | null {
  const { rows, open, onClose, basePath, currentParams, totalDocs, countNoun, triggerRef } = props
  const sheetRef = useRef<HTMLDivElement | null>(null)
  const capturedFocusRef = useRef<HTMLElement | null>(null)
  const titleId = useId()

  // Esc 关闭 + 焦点锁定（照抄 Modal.tsx 的实现）
  useEffect(() => {
    if (!open) return

    capturedFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
      if (e.key === 'Tab') {
        const sheet = sheetRef.current
        if (!sheet) return
        const focusable = Array.from(sheet.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
          (el) => el.offsetParent !== null,
        )
        if (focusable.length === 0) {
          e.preventDefault()
          return
        }
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const sheet = sheetRef.current
    if (sheet) {
      const first = sheet.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
      first?.focus()
    }

    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onClose])

  // 关闭时归还焦点：优先用调用方传入的 triggerRef，否则退化为打开时捕获的元素
  useEffect(() => {
    if (open) return
    ;(triggerRef?.current ?? capturedFocusRef.current)?.focus()
  }, [open, triggerRef])

  if (!open || typeof document === 'undefined') return null

  const visibleRows = rows.filter((row) => row.options.length > 0)
  const pickCount = visibleRows.reduce((n, row) => (findActiveOption(row) ? n + 1 : n), 0)
  const resetHref = buildResetHref(basePath, currentParams, rows)

  return createPortal(
    <div className="ls-msheet__overlay" onClick={onClose}>
      <div
        ref={sheetRef}
        className="ls-msheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ls-msheet__head">
          <span className="ls-msheet__grabber" aria-hidden="true" />
          <div className="ls-msheet__head-row">
            <span className="ls-msheet__picked">{pickCount > 0 ? `已选 ${pickCount} 项` : ''}</span>
            <h2 id={titleId} className="ls-msheet__title">筛选</h2>
            <Link href={resetHref} className="ls-msheet__reset">重置</Link>
          </div>
        </div>

        <div className="ls-msheet__body">
          {visibleRows.map((row) => (
            <div className="ls-msheet__group" key={row.key}>
              <span className="ls-msheet__group-label">{row.label}</span>
              <div className="ls-msheet__group-opts">
                {row.options.map((option) => {
                  const isActive = row.activeValue === option.value
                  return (
                    <FilterPill
                      key={option.value}
                      href={buildOptionHref(basePath, currentParams, row.key, option.value, isActive)}
                      label={option.label}
                      active={isActive}
                      count={option.count}
                    />
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="ls-msheet__footer">
          <Link href={resetHref} className="ls-msheet__footer-reset">重置</Link>
          <button type="button" className="ls-msheet__footer-apply" onClick={onClose}>
            查看 <span className="ls-msheet__footer-count">{totalDocs}</span> {countNoun}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
