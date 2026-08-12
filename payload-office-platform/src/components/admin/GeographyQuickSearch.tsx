'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Input, Tag } from '@arco-design/web-react'
import { IconSearch } from '@arco-design/web-react/icon'

import { LOCATION_TYPE_LABELS, type LocationType } from '@/domain/geography/location-hierarchy'
import { locationSearchTarget, type LocationSearchResult } from '@/domain/geography/location-search'

/**
 * 全局地理搜索（Task 13）
 *
 * 挂在 admin.components.actions，Cmd/Ctrl+K 唤起。结果按城市分组并显示类型标签，
 * 回车进对应模块的编辑入口、Esc 关闭、上下键导航。preventDefault 避免与浏览器
 * 默认行为冲突。搜索走 GET /api/locations/search（登录态 + 数据权限）。
 */
export default function GeographyQuickSearch() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<LocationSearchResult[]>([])
  const [error, setError] = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)

  // 打开时清空搜索结果：在渲染期调整状态（React 官方「You Might Not Need an Effect」
  // 推荐的 reset-on-open 模式），避免在 effect 里同步 setState 触发级联渲染。
  // 守卫条件保证重置一次后即满足，不会无限循环。
  if (open && (q !== '' || results.length > 0 || error !== null || activeIndex !== 0)) {
    setQ('')
    setResults([])
    setError(null)
    setActiveIndex(0)
  }

  // Cmd/Ctrl+K 全局唤起
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 防抖搜索：q 去空格后 <2 不打库。渲染层已按 q.trim().length<2 优先展示「输入至少 2 个字符」
  // 提示（不依赖 results/error 状态），故此处直接 return，不在此同步清状态（避免级联渲染）。
  useEffect(() => {
    if (!open) return
    const keyword = q.trim()
    if (keyword.length < 2) return
    let cancelled = false
    const timer = setTimeout(async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/locations/search?q=${encodeURIComponent(keyword)}&limit=20`)
        const data = await res.json().catch(() => null)
        if (cancelled) return
        // 审核修复 P3-1：失败必须与「无结果」区分开。
        // 原实现既不看 res.ok，catch 里也只 setResults([])，于是 401/403/500 与网络
        // 中断全都渲染成「无匹配结果」——用户以为搜不到，实际是没权限或服务出错。
        if (!res.ok || data?.ok === false) {
          setResults([])
          setError(
            typeof data?.error === 'string' && data.error
              ? data.error
              : `搜索失败（HTTP ${res.status}）`,
          )
          return
        }
        setResults(Array.isArray(data?.results) ? data.results : [])
        setActiveIndex(0)
      } catch (err) {
        if (cancelled) return
        setResults([])
        setError(err instanceof Error ? `搜索失败：${err.message}` : '搜索失败：网络错误')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [q, open])

  const go = useCallback(
    (r: LocationSearchResult) => {
      router.push(locationSearchTarget(r))
      setOpen(false)
    },
    [router],
  )

  const onInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, results.length - 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const target = results[activeIndex]
      if (target) go(target)
    }
  }

  if (!open) return null

  // 按城市分组（保持结果顺序）
  const groups: { cityName: string; items: { r: LocationSearchResult; index: number }[] }[] = []
  const groupByCity = new Map<string, number>()
  let flatIndex = 0
  for (const r of results) {
    const key = r.cityName || '未知城市'
    const g = groupByCity.get(key)
    if (g === undefined) {
      groupByCity.set(key, groups.length)
      groups.push({ cityName: key, items: [{ r, index: flatIndex }] })
    } else {
      groups[g].items.push({ r, index: flatIndex })
    }
    flatIndex++
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        justifyContent: 'center',
        paddingTop: '12vh',
      }}
      onClick={() => setOpen(false)}
    >
      <div
        style={{
          width: 560,
          maxWidth: '92vw',
          background: '#fff',
          borderRadius: 12,
          boxShadow: '0 8px 30px rgba(0,0,0,0.2)',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 16px',
            borderBottom: '1px solid #e5e6eb',
          }}
        >
          <IconSearch style={{ color: '#86909c', flexShrink: 0 }} />
          <Input
            autoFocus
            value={q}
            onChange={setQ}
            onKeyDown={onInputKeyDown}
            placeholder="搜索城市 / 行政区 / 商圈 / 地铁线路 / 站点（名称或区域代码）"
            style={{ border: 'none', boxShadow: 'none' }}
          />
        </div>
        <div style={{ maxHeight: '60vh', overflowY: 'auto', padding: '4px 0' }}>
          {loading ? (
            <div style={{ padding: 16, textAlign: 'center', color: '#86909c' }}>搜索中…</div>
          ) : q.trim().length < 2 ? (
            <div style={{ padding: 16, textAlign: 'center', color: '#86909c' }}>输入至少 2 个字符开始搜索</div>
          ) : error ? (
            <div style={{ padding: 16, textAlign: 'center', color: '#f53f3f' }} role="alert">
              {error}
            </div>
          ) : groups.length === 0 ? (
            <div style={{ padding: 16, textAlign: 'center', color: '#86909c' }}>无匹配结果</div>
          ) : (
            groups.map((g) => (
              <div key={g.cityName}>
                <div
                  style={{
                    padding: '6px 16px',
                    fontSize: 12,
                    color: '#86909c',
                    background: '#f7f8fa',
                    position: 'sticky',
                    top: 0,
                  }}
                >
                  {g.cityName}
                </div>
                {g.items.map(({ r, index }) => {
                  const active = index === activeIndex
                  return (
                    <div
                      key={r.id}
                      onClick={() => go(r)}
                      onMouseEnter={() => setActiveIndex(index)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '8px 16px',
                        background: active ? '#f0f3ff' : '#fff',
                        cursor: 'pointer',
                      }}
                    >
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontWeight: 500 }}>
                          {r.parentName ? `${r.parentName} / ${r.name}` : r.name}
                        </span>
                      </span>
                      <Tag size="small">
                        {LOCATION_TYPE_LABELS[r.type as LocationType] ?? r.type}
                      </Tag>
                      <span style={{ color: '#86909c', fontSize: 12 }}>{r.immutableCode}</span>
                    </div>
                  )
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}