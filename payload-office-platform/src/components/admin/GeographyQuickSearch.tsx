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
  const [activeIndex, setActiveIndex] = useState(0)

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

  // 打开时清空并聚焦
  useEffect(() => {
    if (open) {
      setQ('')
      setResults([])
      setActiveIndex(0)
    }
  }, [open])

  // 防抖搜索：q 去空格后 <2 不打库
  useEffect(() => {
    if (!open) return
    const keyword = q.trim()
    if (keyword.length < 2) {
      setResults([])
      setActiveIndex(0)
      return
    }
    let cancelled = false
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/locations/search?q=${encodeURIComponent(keyword)}&limit=20`)
        const data = await res.json()
        if (!cancelled) {
          setResults(data?.results ?? [])
          setActiveIndex(0)
        }
      } catch {
        if (!cancelled) setResults([])
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