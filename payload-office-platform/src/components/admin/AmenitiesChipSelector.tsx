'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Badge,
  Button,
  Empty,
  Input,
  Radio,
  Space,
  Spin,
  Tag,
  Typography,
} from '@arco-design/web-react'
import { IconCheck, IconClose, IconSearch } from '@arco-design/web-react/icon'
import { useDocumentInfo, useField } from '@payloadcms/ui'

const { Text } = Typography

export interface AmenityDoc {
  id: number
  name: string
  category?: 'office-service' | 'space' | 'building' | 'lifestyle' | null
}

const AMENITY_CATEGORY_LABELS: Record<string, string> = {
  building: '楼宇配套',
  lifestyle: '交通生活',
  'office-service': '办公服务',
  space: '空间设施',
}

function toId(val: unknown): number | null {
  if (val === null || val === undefined) return null
  if (typeof val === 'number') return val
  if (typeof val === 'string') {
    const n = Number(val)
    return isNaN(n) ? null : n
  }
  if (typeof val === 'object' && 'id' in val) {
    const id = (val as { id: unknown }).id
    return typeof id === 'number' ? id : typeof id === 'string' ? Number(id) : null
  }
  return null
}

/**
 * 楼宇配套点亮面板组件（Amenities Chip Selector）
 *
 * 替代原生关系下拉框逐条搜索的繁琐体验，提供：
 *   1. 图标化分类标签矩阵；
 *   2. 一键点选即亮/熄灭；
 *   3. 实时关键字搜索与分组筛选；
 *   4. 已选数量快速统计与一键清空。
 */
export default function AmenitiesChipSelector(props?: { path?: string }) {
  const fieldPath = props?.path || 'amenities'
  const { data } = useDocumentInfo()
  const { value = [], setValue } = useField<(number | { id: number })[]>({ path: fieldPath })

  // 当进入已保存楼盘的编辑页时，如果 form value 尚未同步但 data.amenities 存在，初始化同步。
  // 只做一次：否则用户「清空已选」把 value 置空后，本 effect 会立刻用 data.amenities 塞回去。
  const initializedRef = useRef(false)
  useEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true
    if (
      (!value || (Array.isArray(value) && value.length === 0)) &&
      Array.isArray(data?.amenities) &&
      data.amenities.length > 0
    ) {
      setValue(data.amenities as (number | { id: number })[])
    }
  }, [data?.amenities, value, setValue])

  // 初始化之后一律以表单 value 为准；不能在 value 为空时回退读 data.amenities，
  // 否则「清空」与「取消最后一个」在界面上永远不生效。
  const selectedIds = useMemo(() => {
    const list: unknown[] = Array.isArray(value) ? value : []
    const ids = list.map(toId).filter((id): id is number => id !== null)
    return new Set(ids)
  }, [value])

  const [loading, setLoading] = useState(true)
  const [amenities, setAmenities] = useState<AmenityDoc[]>([])
  const [searchKeyword, setSearchKeyword] = useState('')
  const [activeCategory, setActiveCategory] = useState<string>('all')

  useEffect(() => {
    let cancelled = false
    // loading 初值即 true，此处无需再同步 setState（effect 依赖为空只跑一次）；
    // 在 effect 里同步调用 setState 会触发级联渲染（react-hooks/set-state-in-effect）。

    fetch('/api/amenities?limit=200&depth=0')
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return
        const docs = (data?.docs || []) as AmenityDoc[]
        setAmenities(docs)
        setLoading(false)
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const toggleAmenity = useCallback(
    (id: number) => {
      const next = new Set(selectedIds)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      setValue(Array.from(next))
    },
    [selectedIds, setValue],
  )

  const clearAll = useCallback(() => {
    setValue([])
  }, [setValue])

  const filteredAmenities = useMemo(() => {
    return amenities.filter((item) => {
      const matchKeyword =
        !searchKeyword ||
        item.name.toLowerCase().includes(searchKeyword.trim().toLowerCase())
      const matchCategory =
        activeCategory === 'all' || (item.category || 'building') === activeCategory
      return matchKeyword && matchCategory
    })
  }, [activeCategory, amenities, searchKeyword])

  const grouped = useMemo(() => {
    const map: Record<string, AmenityDoc[]> = {
      building: [],
      lifestyle: [],
      'office-service': [],
      space: [],
    }
    for (const item of filteredAmenities) {
      const cat = item.category && map[item.category] ? item.category : 'building'
      map[cat].push(item)
    }
    return map
  }, [filteredAmenities])

  return (
    <div
      style={{
        background: 'var(--theme-elevation-50, #fafafa)',
        border: '1px solid var(--theme-elevation-150, #e5e5e5)',
        borderRadius: 8,
        padding: 20,
        marginBottom: 24,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
          marginBottom: 16,
        }}
      >
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--theme-text, #1d2129)' }}>
            楼宇配套设施选择
          </div>
          <Text type="secondary" style={{ fontSize: 13 }}>
            点击标签一键点亮或取消，支持按分类筛选与关键字快速查找
          </Text>
        </div>

        <Space size="medium">
          <Input.Search
            size="small"
            placeholder="搜索配套设施..."
            value={searchKeyword}
            onChange={(val) => setSearchKeyword(val)}
            style={{ width: 180 }}
            allowClear
          />
          {selectedIds.size > 0 && (
            <Button size="small" type="text" status="danger" onClick={clearAll}>
              清空已选 ({selectedIds.size})
            </Button>
          )}
        </Space>
      </div>

      {/* 分类快速筛选 */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {[
          { key: 'all', label: `全部配套 (${amenities.length})` },
          { key: 'building', label: '楼宇配套' },
          { key: 'lifestyle', label: '交通生活' },
          { key: 'office-service', label: '办公服务' },
          { key: 'space', label: '空间设施' },
        ].map((tab) => {
          const isActive = activeCategory === tab.key
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveCategory(tab.key)}
              style={{
                padding: '4px 12px',
                borderRadius: 6,
                fontSize: 12,
                fontWeight: isActive ? 600 : 400,
                cursor: 'pointer',
                border: isActive
                  ? '1px solid var(--theme-primary-500, #165dff)'
                  : '1px solid var(--theme-elevation-150, #e5e5e5)',
                background: isActive
                  ? 'var(--theme-primary-500, #165dff)'
                  : 'var(--theme-elevation-100, #f2f3f5)',
                color: isActive ? '#ffffff' : 'var(--theme-text, #1d2129)',
                transition: 'all 0.15s ease-in-out',
              }}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '32px 0' }}>
          <Spin />
        </div>
      ) : filteredAmenities.length === 0 ? (
        <Empty description="未找到匹配的配套设施" style={{ padding: '24px 0' }} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {Object.entries(grouped).map(([categoryKey, list]) => {
            if (list.length === 0) return null
            return (
              <div
                key={categoryKey}
                style={{
                  background: 'var(--theme-elevation-0, #fff)',
                  borderRadius: 6,
                  padding: 12,
                  border: '1px solid var(--theme-elevation-150, #e5e5e5)',
                }}
              >
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--theme-text, #1d2129)',
                    marginBottom: 10,
                  }}
                >
                  {AMENITY_CATEGORY_LABELS[categoryKey] || categoryKey}
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {list.map((amenity) => {
                    const isSelected = selectedIds.has(amenity.id)
                    return (
                      <div
                        key={amenity.id}
                        onClick={() => toggleAmenity(amenity.id)}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '6px 12px',
                          borderRadius: 6,
                          fontSize: 13,
                          cursor: 'pointer',
                          userSelect: 'none',
                          transition: 'all 0.2s cubic-bezier(0.34, 0.69, 0.1, 1)',
                          background: isSelected
                            ? 'var(--theme-primary-500, #165dff)'
                            : 'var(--theme-elevation-100, #f2f3f5)',
                          color: isSelected ? '#ffffff' : 'var(--theme-text, #1d2129)',
                          border: isSelected
                            ? '1px solid var(--theme-primary-500, #165dff)'
                            : '1px solid var(--theme-elevation-150, #e5e5e5)',
                          boxShadow: isSelected ? '0 2px 6px rgba(22,93,255,0.25)' : 'none',
                          transform: isSelected ? 'scale(1.02)' : 'scale(1)',
                        }}
                      >
                        {isSelected && <IconCheck style={{ fontSize: 12 }} />}
                        <span>{amenity.name}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
