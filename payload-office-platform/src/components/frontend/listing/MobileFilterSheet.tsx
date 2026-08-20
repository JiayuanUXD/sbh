'use client'

import Link from 'next/link'
import React, { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { buildHref, cloneSearchParams } from '@/lib/frontend/listing-url'
import type { FilterRow, FilterSwitch } from './FilterFormC'
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
 * ## 焦点管理：照抄 Modal.tsx，`triggerRef` 必填（code review 后改为必填）
 *
 * 与 `src/components/frontend/ui/Modal.tsx` 同一套做法：Esc 关闭、Tab 焦点
 * 锁定在弹层内、body 滚动锁定、关闭后归还焦点到触发器。这份焦点陷阱/Esc/
 * 滚动锁定逻辑与 Modal.tsx **各自维护一份**（两个组件的 chrome——一个居中
 * 卡片、一个底部抽屉——差异大到字面复用不现实），今天两份实现没有分叉，但
 * 以后改其中一个（比如 Tab 键循环的边界条件）不会自动同步到另一个，谁改了
 * 一处都要记得回去检查另一处。
 *
 * `triggerRef` **必填**，不是可选加固：这是移动专属组件，触摸是主要交互
 * 方式，而 iOS Safari 的 `<button>` 触摸激活本来就不会自动把焦点移上去——
 * 这不是「鼠标点击的边角情形」，是移动端的主路径。组件内部另外维护了
 * `document.activeElement` 捕获作为兜底（多数桌面浏览器 + 键盘操作下有效），
 * 但触摸场景下这个捕获大概率拿不到值，唯一可靠的办法是调用方把触发按钮的
 * 真实 DOM 节点传进来。`MobileFilterTrigger` 已经用 `forwardRef` 暴露了
 * 内部 `<button>`，Task 11/12 接线时把同一个 `ref` 分别传给
 * `<MobileFilterTrigger ref={...}>` 和 `<MobileFilterSheet triggerRef={...}>`
 * 即可（示例见 `dev-story/opt036/MobileFilterPreview.tsx`）。
 *
 * ## 抽屉内筛选项点击后的处置（brief 允许调用方自行决定，含理由）
 *
 * **不自动关闭。** 选项本身仍是导航 `<Link>`——点击立即改 URL、删 `page`
 * （与 FilterFormC/PriceUnitSegment 同一套约定），但不调用 `onClose`。
 * 理由：comp 的抽屉允许一次勾选多个分组（区域 + 类型 + 价格……）再统一查看
 * 结果，若每点一项就关闭，用户势必要来回重新打开好几次。
 *
 * **这是一条对调用方的硬约束，不是本组件自己就能兑现的既定事实**：
 * 「导航后抽屉仍开着、结果数随之刷新」要成立，前提是 Task 11/12 接线时，
 * 持有 `open` 状态的那个 client 组件在路由变化前后必须是**同一个组件实例、
 * 挂在树里同一个位置**——不能带随 searchParams 变化的 `key`，也不能被套在
 * 一个会因 searchParams 变化而重新 suspend 的 `<Suspense>` 边界里面重新
 * 挂载。这两种情况都会让 React 卸载再重建这个组件，`open` 状态被重置为
 * 初始值，效果等同于「每选一个条件抽屉就关一次，用户要反复重开」——
 * 与这里写的设计意图正好相反，且不会报错，只会在真机上表现为体验很差。
 *
 * 本文件的 Playwright 验证只跑在 `MobileFilterPreview.tsx` 这个静态预览
 * 壳上（`rows`/`totalDocs`/`currentParams` 是本地 state，从不因路由变化而
 * 更新），因此「点选项 → 导航 → 抽屉仍开着 → 结果数已刷新」这条完整链路
 * **在本次交付里没有被验证过**，只验证了「点了选项之后抽屉组件本身没有
 * 主动调用 onClose」。Task 11/12 接线完成后必须补一次针对真实路由的验证：
 * 在真实 `/[city]/listings` 页面上打开抽屉、点一个筛选项，断言（a）URL 确
 * 实带上了新参数、（b）抽屉 DOM 节点没有被卸载重建（例如给抽屉根节点或
 * 触发按钮打一个稳定属性，断言同一个节点实例在导航前后引用不变，而不是
 * 只看"抽屉还在屏幕上"——卸载后立刻用相同 props 重新挂载,视觉上会和"没关"
 * 一模一样）、（c）底栏「查看 N 套」的数字确实变成了新结果数。这条验证
 * 不能用另一个静态 fixture 顶替，必须挂在真实页面路由上跑。
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

/**
 * 重置：清空本组件渲染的所有 rows 对应的参数（不限于 visibleRows——理由同
 * FilterFormC 的 buildClearAllHref），**开关行的键也要一起删**：漏掉它会出现
 * 「点了重置，结果仍然只看有在租」这种同名不同义的出口。
 */
function buildResetHref(
  basePath: string,
  currentParams: URLSearchParams,
  rows: readonly FilterRow[],
  switchRow: FilterSwitch | undefined,
): string {
  const sp = cloneSearchParams(currentParams)
  sp.delete('page')
  for (const row of rows) sp.delete(row.key)
  if (switchRow) sp.delete(switchRow.paramKey)
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
  /**
   * 触发按钮的真实 DOM 节点，关闭后焦点归还到这里——必填，见上方「焦点
   * 管理」注释：iOS Safari 触摸激活 `<button>` 不会自动移动焦点，这是移动
   * 端主路径而非边角情形，组件内部的 `document.activeElement` 捕获救不回
   * 触摸场景。配合 `MobileFilterTrigger` 的 `forwardRef` 使用。
   */
  triggerRef: React.RefObject<HTMLElement | null>
  /**
   * 开关型筛选行（楼盘页「仅看有在租」），渲染在抽屉最上方——comp 楼盘列表
   * 「移动 375 · 筛选抽屉」第一段就是它（52 高行 + 44×26 开关）。省略则不渲染。
   * 桌面 `FilterFormC` 已经有同一个开关，但移动端筛选按 comp 全部收进抽屉，
   * 少了它抽屉就少一个真实维度（而不是「移动端不支持这个筛选」）。
   */
  switchRow?: FilterSwitch
}>): React.JSX.Element | null {
  const { rows, open, onClose, basePath, currentParams, totalDocs, countNoun, triggerRef, switchRow } = props
  const sheetRef = useRef<HTMLDivElement | null>(null)
  const capturedFocusRef = useRef<HTMLElement | null>(null)
  // 「归还焦点」只有在**真的开过一次**之后才成立，见下方该 effect 的注释。
  const hasBeenOpenRef = useRef(false)
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

  // 关闭时归还焦点：优先用调用方传入的必填 triggerRef（触摸场景下唯一可靠的来源），
  // triggerRef.current 意外为空时（例如调用方 ref 还没挂载完成）退化到打开时捕获的元素。
  //
  // `hasBeenOpenRef` 门槛不是防御性冗余，是修一个真实缺陷（OPT-036 Task 11 审查发现）：
  // 首次挂载时 `open` 本来就是 `false`，这个 effect 照样会跑，于是**每次进入列表页**
  // 焦点都会被抢到那个 `position: fixed` 的底部悬浮「筛选」按钮上——移动端每次访问
  // `/[city]/listings`、`/[city]/sale` 都会：Tab 从页面最后一个控件开始、整页内容被
  // 跳过，读屏软件一进页面就念「筛选」。这在静态预览壳里看不出来（那里组件不是页面
  // 挂载即存在的），也没有任何截图能显示焦点环，只有接进真实路由才会暴露。
  // 「归还焦点」这个动作只有在真的开过一次之后才有意义，因此用 ref 记录开合历史。
  useEffect(() => {
    if (open) {
      hasBeenOpenRef.current = true
      return
    }
    if (!hasBeenOpenRef.current) return
    ;(triggerRef.current ?? capturedFocusRef.current)?.focus()
  }, [open, triggerRef])

  if (!open || typeof document === 'undefined') return null

  const visibleRows = rows.filter((row) => row.options.length > 0)
  const pickCount =
    visibleRows.reduce((n, row) => (findActiveOption(row) ? n + 1 : n), 0) +
    (switchRow?.active ? 1 : 0)
  const resetHref = buildResetHref(basePath, currentParams, rows, switchRow)

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
          {switchRow ? (
            <div className="ls-msheet__group">
              <Link
                href={switchRow.href}
                aria-current={switchRow.active ? 'true' : undefined}
                className={
                  switchRow.active ? 'ls-msheet__switch ls-msheet__switch--on' : 'ls-msheet__switch'
                }
              >
                <span className="ls-msheet__switch-text">
                  <span className="ls-msheet__switch-label">{switchRow.optionLabel}</span>
                  {switchRow.subLabel ? (
                    <span className="ls-msheet__switch-sub sf-num">{switchRow.subLabel}</span>
                  ) : null}
                </span>
                <span className="ls-msheet__switch-track" aria-hidden="true">
                  <span className="ls-msheet__switch-knob" />
                </span>
              </Link>
            </div>
          ) : null}
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
