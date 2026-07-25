'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import React, { useEffect, useId, useRef, useState } from 'react'

/**
 * 移动端筛选抽屉（F3.4）
 *
 * 设计依据：specs/frontend-mvp/design.md §7.1、§7.4、§14.2
 *           Page PRD: FP-02 §4.2
 *
 * 守护不变量：
 *   - 暂存条件与已应用条件区分：抽屉内编辑为暂存，点击「查看房源」才提交应用；
 *   - 「查看 N 套房源」使用服务端传入的当前已应用条件 totalDocs；
 *   - 焦点锁定在抽屉内（Tab/Shift+Tab 循环）；
 *   - Esc 关闭抽屉，滚动恢复到打开前位置；
 *   - 软键盘适配：使用 dvh 单位 + viewport 高度回退；
 *   - 提交后页码重置为 1。
 *
 * 可访问性：
 *   - role="dialog" + aria-modal + aria-labelledby；
 *   - 打开时焦点移至抽屉标题；
 *   - 关闭后焦点归还触发按钮；
 *   - body 滚动锁（overflow: hidden）。
 */

type District = { id: string | number; slug: string; name: string }

type Props = {
  districts: readonly District[]
  /** 当前已应用条件下的房源总数（服务端传入） */
  totalDocs: number
}

const TYPE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'traditional-office', label: '传统办公' },
  { value: 'serviced-office', label: '服务式办公' },
  { value: 'coworking', label: '共享办公' },
  { value: 'full-floor', label: '整层办公' },
]

const RENT_UNIT_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'rmb-month', label: '元/月' },
  { value: 'rmb-sqm-day', label: '元/㎡/天' },
  { value: 'rmb-seat-month', label: '元/工位/月' },
]

const SORT_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'recommended', label: '推荐' },
  { value: 'newest', label: '最新' },
  { value: 'rent-asc', label: '价格升序' },
  { value: 'rent-desc', label: '价格降序' },
]

function toIntOrNull(v: string): number | null {
  if (!v.trim()) return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : null
}

export default function MobileFilterDrawer({ districts, totalDocs }: Props) {
  const router = useRouter()
  const sp = useSearchParams()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 暂存条件（打开抽屉时从 URL 回填）
  const [q, setQ] = useState('')
  const [district, setDistrict] = useState('')
  const [type, setType] = useState('')
  const [rentMin, setRentMin] = useState('')
  const [rentMax, setRentMax] = useState('')
  const [rentUnit, setRentUnit] = useState('')
  const [areaMin, setAreaMin] = useState('')
  const [areaMax, setAreaMax] = useState('')
  const [availableBefore, setAvailableBefore] = useState('')
  const [sort, setSort] = useState('recommended')

  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const titleRef = useRef<HTMLHeadingElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const titleId = useId()

  // 打开抽屉时从当前 URL 回填暂存条件
  function openDrawer() {
    setQ(sp.get('q') || '')
    setDistrict(sp.get('district') || '')
    setType(sp.get('type') || '')
    setRentMin(sp.get('rentMin') || '')
    setRentMax(sp.get('rentMax') || '')
    setRentUnit(sp.get('rentUnit') || '')
    setAreaMin(sp.get('areaMin') || '')
    setAreaMax(sp.get('areaMax') || '')
    setAvailableBefore(sp.get('availableBefore') || '')
    setSort(sp.get('sort') || 'recommended')
    setError(null)
    setOpen(true)
  }

  function closeDrawer() {
    setOpen(false)
    window.requestAnimationFrame(() => triggerRef.current?.focus())
  }

  // Esc 关闭 + 焦点锁定 + 滚动锁 + 滚动恢复
  useEffect(() => {
    if (!open) return
    const dialog = dialogRef.current
    if (!dialog) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeDrawer()
        return
      }
      if (e.key === 'Tab') {
        // 焦点锁定：在抽屉内循环
        const focusables = dialog.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        )
        if (focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    const prevOverflow = document.body.style.overflow
    const prevScrollY = window.scrollY
    document.body.style.overflow = 'hidden'
    window.requestAnimationFrame(() => titleRef.current?.focus())

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = prevOverflow
      // 滚动恢复
      window.scrollTo(0, prevScrollY)
    }
  }, [open])

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const params = new URLSearchParams()

    const rentMinN = toIntOrNull(rentMin)
    const rentMaxN = toIntOrNull(rentMax)
    const areaMinN = toIntOrNull(areaMin)
    const areaMaxN = toIntOrNull(areaMax)

    if (rentMinN != null && rentMaxN != null && rentMinN > rentMaxN) {
      setError('租金最低不能高于最高')
      return
    }
    if (areaMinN != null && areaMaxN != null && areaMinN > areaMaxN) {
      setError('面积最低不能高于最高')
      return
    }

    let finalSort = sort
    if ((sort === 'rent-asc' || sort === 'rent-desc') && !rentUnit) {
      finalSort = 'recommended'
    }

    setError(null)

    const qNormalized = q.trim().slice(0, 60)
    if (qNormalized) params.set('q', qNormalized)
    if (district) params.set('district', district)
    if (type) params.set('type', type)
    if (rentMinN != null) params.set('rentMin', String(rentMinN))
    if (rentMaxN != null) params.set('rentMax', String(rentMaxN))
    if (rentUnit) params.set('rentUnit', rentUnit)
    if (areaMinN != null) params.set('areaMin', String(areaMinN))
    if (areaMaxN != null) params.set('areaMax', String(areaMaxN))
    if (availableBefore) params.set('availableBefore', availableBefore)
    if (finalSort && finalSort !== 'recommended') params.set('sort', finalSort)

    const qs = params.toString()
    router.push(qs ? `/listings?${qs}` : '/listings')
    setOpen(false)
  }

  function reset() {
    setQ('')
    setDistrict('')
    setType('')
    setRentMin('')
    setRentMax('')
    setRentUnit('')
    setAreaMin('')
    setAreaMax('')
    setAvailableBefore('')
    setSort('recommended')
    setError(null)
  }

  const isPriceSort = sort === 'rent-asc' || sort === 'rent-desc'

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="filter-bar__mobile-trigger btn btn--ghost"
        onClick={openDrawer}
        aria-expanded={open}
        aria-controls={titleId}
      >
        筛选
      </button>

      {open && (
        <div
          ref={dialogRef}
          className="filter-drawer"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
        >
          <div className="filter-drawer__handle" aria-hidden="true" />
          <div className="filter-drawer__header">
            <h2 id={titleId} ref={titleRef} tabIndex={-1} className="filter-drawer__title">
              筛选条件
            </h2>
            <button
              type="button"
              className="filter-drawer__close"
              onClick={closeDrawer}
              aria-label="关闭筛选"
            >
              ×
            </button>
          </div>

          <form className="filter-drawer__form" onSubmit={submit}>
            <div className="filter-bar__field">
              <label className="filter-bar__label" htmlFor="mf-q">关键词</label>
              <input
                id="mf-q"
                className="filter-bar__input"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="如：江景、整层"
                maxLength={60}
              />
            </div>

            <div className="filter-bar__field">
              <label className="filter-bar__label" htmlFor="mf-district">区域</label>
              <select
                id="mf-district"
                className="filter-bar__select"
                value={district}
                onChange={(e) => setDistrict(e.target.value)}
              >
                <option value="">全部</option>
                {districts.map((d) => (
                  <option key={d.id} value={d.slug}>{d.name}</option>
                ))}
              </select>
            </div>

            <div className="filter-bar__field">
              <label className="filter-bar__label" htmlFor="mf-type">类型</label>
              <select
                id="mf-type"
                className="filter-bar__select"
                value={type}
                onChange={(e) => setType(e.target.value)}
              >
                <option value="">全部</option>
                {TYPE_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            <div className="filter-bar__field">
              <label className="filter-bar__label" htmlFor="mf-rent-unit">租金单位</label>
              <select
                id="mf-rent-unit"
                className="filter-bar__select"
                value={rentUnit}
                onChange={(e) => setRentUnit(e.target.value)}
                aria-describedby={isPriceSort && !rentUnit ? 'mf-rent-unit-hint' : undefined}
              >
                <option value="">不限</option>
                {RENT_UNIT_OPTIONS.map((u) => (
                  <option key={u.value} value={u.value}>{u.label}</option>
                ))}
              </select>
              {isPriceSort && !rentUnit && (
                <span id="mf-rent-unit-hint" className="filter-bar__hint filter-bar__hint--warn">
                  价格排序需选定单位
                </span>
              )}
            </div>

            <div className="filter-bar__field">
              <label className="filter-bar__label">租金（元）</label>
              <div className="filter-bar__rent-group">
                <input
                  className="filter-bar__input"
                  value={rentMin}
                  onChange={(e) => setRentMin(e.target.value)}
                  placeholder="最低"
                  inputMode="numeric"
                  aria-label="租金最低"
                />
                <span aria-hidden="true">–</span>
                <input
                  className="filter-bar__input"
                  value={rentMax}
                  onChange={(e) => setRentMax(e.target.value)}
                  placeholder="最高"
                  inputMode="numeric"
                  aria-label="租金最高"
                />
              </div>
            </div>

            <div className="filter-bar__field">
              <label className="filter-bar__label">面积（㎡）</label>
              <div className="filter-bar__rent-group">
                <input
                  className="filter-bar__input"
                  value={areaMin}
                  onChange={(e) => setAreaMin(e.target.value)}
                  placeholder="最低"
                  inputMode="numeric"
                  aria-label="面积最低"
                />
                <span aria-hidden="true">–</span>
                <input
                  className="filter-bar__input"
                  value={areaMax}
                  onChange={(e) => setAreaMax(e.target.value)}
                  placeholder="最高"
                  inputMode="numeric"
                  aria-label="面积最高"
                />
              </div>
            </div>

            <div className="filter-bar__field">
              <label className="filter-bar__label" htmlFor="mf-available">可入驻时间</label>
              <input
                id="mf-available"
                type="date"
                className="filter-bar__input"
                value={availableBefore}
                onChange={(e) => setAvailableBefore(e.target.value)}
                aria-label="可入驻时间上限"
              />
            </div>

            <div className="filter-bar__field">
              <label className="filter-bar__label" htmlFor="mf-sort">排序</label>
              <select
                id="mf-sort"
                className="filter-bar__select"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
              >
                {SORT_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>

            {error && (
              <p className="filter-bar__error" role="alert">{error}</p>
            )}

            <div className="filter-drawer__actions">
              <button type="button" className="btn btn--ghost" onClick={reset}>
                重置
              </button>
              <button type="submit" className="btn btn--primary filter-drawer__submit">
                查看 {totalDocs} 套房源
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}
