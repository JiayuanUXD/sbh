'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  Card,
  Empty,
  Image,
  Message,
  Modal,
  Popconfirm,
  Progress,
  Radio,
  Select,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from '@arco-design/web-react'
import {
  IconArrowLeft,
  IconArrowRight,
  IconCheck,
  IconDelete,
  IconDragArrow,
  IconEye,
  IconFileImage,
  IconFileVideo,
  IconPlus,
  IconStar,
  IconStarFill,
  IconUpload,
} from '@arco-design/web-react/icon'
import { useDocumentInfo, useField, useForm } from '@payloadcms/ui'

const { Text } = Typography

export interface BuildingMediaItem {
  id?: string
  resource: number | { id: number; url?: string; filename?: string; mimeType?: string }
  kind: 'image' | 'floor-plan' | 'video'
  category: 'exterior' | 'lobby' | 'common-area' | 'facilities'
  alt: string
  capturedAt?: string | null
  isSchematic?: boolean | null
}

const CATEGORY_LABELS: Record<BuildingMediaItem['category'], string> = {
  exterior: '外立面/建筑外观',
  lobby: '大堂/前台',
  'common-area': '公区/电梯厅',
  facilities: '配套设施/周边',
}

const KIND_LABELS: Record<BuildingMediaItem['kind'], string> = {
  image: '图片',
  'floor-plan': '空间图',
  video: '视频',
}

/** 与 file input 的 accept 保持一致：拖放路径也必须按同一白名单收口。 */
const ACCEPTED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/quicktime',
]
/** 单次批量上传上限，与界面文案一致。 */
const MAX_BATCH_UPLOAD = 20
/** 与 Buildings.mediaItems 的 maxRows 保持一致，改一处要同步另一处。 */
const MAX_MEDIA_ROWS = 40

function getResourceId(
  res: number | { id: number } | null | undefined,
): number | null {
  if (!res) return null
  if (typeof res === 'number') return res
  if (typeof res === 'object' && 'id' in res) return Number(res.id)
  return null
}

interface FluidDragState {
  fromOriginalIndex: number
  fromFilteredIndex: number
  startX: number
  startY: number
  currentX: number
  currentY: number
  hoverFilteredIndex: number
  slotRects: { left: number; top: number; width: number; height: number }[]
  isSettling: boolean
}

/**
 * 楼盘媒体工作台组件（直接绑定 Collection mediaItems 字段）
 *
 * 功能说明：
 *   1. 多文件批量拖拽 / 点击上传并自动关联媒体；
 *   2. 分类过滤与快捷筛选（全部 / 外立面 / 大堂 / 公区 / 配套）；
 *   3. 缩略图即时预览与大图弹窗；
 *   4. 一键设为封面（联动 coverImage 字段）；
 *   5. 卡片级快速切换分类、拖拽/按钮调序与批量操作。
 */
export default function BuildingMediaManager(props?: { path?: string; schemaPath?: string }) {
  const fieldPath = props?.path || 'mediaItems'
  const fieldSchemaPath = props?.schemaPath || 'buildings.mediaItems'
  const { data } = useDocumentInfo()
  const { addFieldRow, dispatchFields, moveFieldRow, removeFieldRow } = useForm()
  const buildingName = typeof data?.name === 'string' ? data.name : '楼盘'

  const { value = [] } = useField<BuildingMediaItem[]>({ path: fieldPath })
  const { value: coverValue, setValue: setCoverValue } = useField<number | null | { id: number }>({
    path: 'coverImage',
  })

  // 文档侧的媒体列表：直接派生，不进 state。
  // 早期版本用 useEffect + setItems 做初始化，既在 effect 里同步 setState
  //（react-hooks/set-state-in-effect，会触发级联渲染），又在 data 晚到时可能漏初始化。
  // 注意不回写表单：回写会立刻把文档标记为已修改，用户什么都没改就触发「未保存的更改」拦截。
  const docItems = useMemo<BuildingMediaItem[]>(() => {
    if (Array.isArray(value) && value.length > 0) return value
    if (Array.isArray(data?.mediaItems) && data.mediaItems.length > 0) {
      return data.mediaItems as BuildingMediaItem[]
    }
    return []
  }, [data, value])

  // 本地改动（增删改序）只累积在这里；尚无改动时回落到文档基线。
  const [localItems, setLocalItems] = useState<BuildingMediaItem[] | null>(null)
  const items = localItems ?? docItems
  const setItems = useCallback(
    (
      updater:
        | BuildingMediaItem[]
        | ((prev: BuildingMediaItem[]) => BuildingMediaItem[]),
    ) => {
      setLocalItems((prev) =>
        typeof updater === 'function' ? updater(prev ?? docItems) : updater,
      )
    },
    [docItems],
  )

  const currentCoverId = useMemo(() => {
    if (coverValue) {
      if (typeof coverValue === 'number') return coverValue
      if (typeof coverValue === 'object' && 'id' in coverValue) return Number(coverValue.id)
    }
    if (data?.coverImage) {
      if (typeof data.coverImage === 'number') return data.coverImage
      if (typeof data.coverImage === 'object' && 'id' in data.coverImage) return Number(data.coverImage.id)
    }
    return null
  }, [coverValue, data?.coverImage])

  const [activeCategoryFilter, setActiveCategoryFilter] = useState<string>('all')
  const [defaultUploadCategory, setDefaultUploadCategory] =
    useState<BuildingMediaItem['category']>('exterior')
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 })
  const [fetchedPreviews, setFetchedPreviews] = useState<
    Record<number, { url: string; filename: string; mimeType?: string }>
  >({})
  // 记录是否为视频由 item.kind 决定，不能靠 URL 后缀猜：
  // COS 返回的签名地址带 query（....mp4?q-sign-algorithm=...），后缀正则匹配不到。
  const [previewModal, setPreviewModal] = useState<{ url: string; isVideo: boolean } | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const gridContainerRef = useRef<HTMLDivElement>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [fluidDrag, setFluidDrag] = useState<FluidDragState | null>(null)
  const fluidDragRef = useRef<FluidDragState | null>(null)

  // Payload 把 array 字段拆成 `<path>.<行号>.<子字段>` 的扁平状态，`<path>` 自身在有行时
  // 会被标记 disableFormData 并存行数，提交时整体跳过。所以增删改序一律走行级 action，
  // 绝不能用 setValue 往 `<path>` 写整个数组——那样写进去的内容根本不会被提交。
  const buildRowState = useCallback((item: BuildingMediaItem) => {
    const rid = getResourceId(item.resource)
    const isSchematic = item.isSchematic ?? false
    return {
      resource: { initialValue: rid, valid: true, value: rid },
      kind: { initialValue: item.kind, valid: true, value: item.kind },
      category: { initialValue: item.category, valid: true, value: item.category },
      alt: { initialValue: item.alt, valid: true, value: item.alt },
      isSchematic: { initialValue: isSchematic, valid: true, value: isSchematic },
    }
  }, [])

  // resource 已是完整对象时，url 直接从 items 派生，不必进 state。
  // 早期版本在 effect 里对这类条目同步 setPreviewMediaMap，既触发级联渲染
  //（react-hooks/set-state-in-effect），又因把 previewMediaMap 列为依赖而反复重跑。
  const embeddedPreviews = useMemo(() => {
    const map: Record<number, { url: string; filename: string; mimeType?: string }> = {}
    for (const item of items) {
      const rid = getResourceId(item.resource)
      const resObj =
        typeof item.resource === 'object' && item.resource !== null ? item.resource : null
      if (rid && resObj?.url) {
        map[rid] = {
          url: resObj.url,
          filename: resObj.filename || '',
          mimeType: resObj.mimeType,
        }
      }
    }
    return map
  }, [items])

  // 只有需要异步补全的条目才进 state（在 .then/.catch 里设置，非同步 setState）
  const previewMediaMap = useMemo(
    () => ({ ...embeddedPreviews, ...fetchedPreviews }),
    [embeddedPreviews, fetchedPreviews],
  )

  // 补全 resource 仅为 ID 的缩略图与 URL
  useEffect(() => {
    const missingIds = items
      .map((item) => getResourceId(item.resource))
      .filter(
        (rid): rid is number =>
          rid !== null && !embeddedPreviews[rid] && !fetchedPreviews[rid],
      )

    if (missingIds.length > 0) {
      let cancelled = false
      const uniqueMissing = Array.from(new Set(missingIds))
      fetch(`/api/media?where[id][in]=${uniqueMissing.join(',')}&limit=${uniqueMissing.length}&depth=0`)
        .then((res) => res.json())
        .then((json) => {
          if (cancelled) return
          const newMap: Record<number, { url: string; filename: string; mimeType?: string }> = {}
          for (const doc of json?.docs || []) {
            newMap[Number(doc.id)] = {
              url: doc.url || doc.thumbnailURL || '',
              filename: doc.filename || '',
              mimeType: doc.mimeType,
            }
          }
          // 没查到的 id（素材库里已被删除）也要落一个空条目，
          // 否则卡片会永远停在加载中，运营无法判断是慢还是已失效。
          for (const id of uniqueMissing) {
            if (!newMap[id]) newMap[id] = { url: '', filename: '' }
          }
          setFetchedPreviews((prev) => ({ ...prev, ...newMap }))
        })
        .catch(() => {
          if (cancelled) return
          const failedMap: Record<number, { url: string; filename: string }> = {}
          for (const id of uniqueMissing) failedMap[id] = { url: '', filename: '' }
          setFetchedPreviews((prev) => ({ ...prev, ...failedMap }))
        })

      return () => {
        cancelled = true
      }
    }
  }, [items, embeddedPreviews, fetchedPreviews])

  // 批量上传核心处理
  const handleBatchUpload = useCallback(
    async (files: FileList | File[]) => {
      const picked = Array.from(files)
      const accepted = picked.filter((f) => ACCEPTED_MIME_TYPES.includes(f.type))
      const rejectedCount = picked.length - accepted.length
      if (rejectedCount > 0) {
        Message.warning(`已忽略 ${rejectedCount} 个不支持的文件（仅支持 JPG/PNG/WEBP/MP4/MOV）`)
      }
      if (accepted.length === 0) {
        Message.warning('请选择图片（JPG/PNG/WEBP）或视频（MP4/MOV）文件')
        return
      }

      // 数量上限在上传前收口：超限文件若先传进 COS 再被服务端 maxRows 拒绝，
      // 会既保存不了、又在对象存储里留下无人引用的孤儿文件。
      const remainingRows = Math.max(0, MAX_MEDIA_ROWS - items.length)
      if (remainingRows === 0) {
        Message.warning(`媒体数量已达上限 ${MAX_MEDIA_ROWS} 个，请先删除部分媒体再上传`)
        return
      }
      const allowedCount = Math.min(accepted.length, MAX_BATCH_UPLOAD, remainingRows)
      if (allowedCount < accepted.length) {
        Message.warning(
          `本次仅上传前 ${allowedCount} 个文件（单次上限 ${MAX_BATCH_UPLOAD} 个，剩余可用 ${remainingRows} 个）`,
        )
      }
      const fileArray = accepted.slice(0, allowedCount)

      setIsUploading(true)
      setUploadProgress({ current: 0, total: fileArray.length })

      const newUploadedItems: BuildingMediaItem[] = []
      const failedFiles: string[] = []
      const newPreviews: Record<number, { url: string; filename: string; mimeType?: string }> = {}

      for (let i = 0; i < fileArray.length; i++) {
        const file = fileArray[i]
        const isVideo = file.type.startsWith('video/')
        const kind: BuildingMediaItem['kind'] = isVideo ? 'video' : 'image'
        const category = defaultUploadCategory
        const alt = `${buildingName} ${CATEGORY_LABELS[category]} ${items.length + i + 1}`

        const formData = new FormData()
        formData.append('file', file)
        formData.append('_payload', JSON.stringify({ alt }))

        try {
          const res = await fetch('/api/media', {
            method: 'POST',
            body: formData,
          })
          // 非 2xx 会正常 resolve（413 超大 / 403 无权限 / 422 校验失败），
          // 不显式判断就会静默丢文件，用户只看到数量对不上却不知缺了哪几个。
          if (!res.ok) {
            failedFiles.push(`${file.name}（HTTP ${res.status}）`)
          } else {
            const docRes = await res.json()
            const doc = docRes?.doc
            if (doc && doc.id) {
              const mediaId = Number(doc.id)
              newPreviews[mediaId] = {
                url: doc.url || doc.thumbnailURL || '',
                filename: doc.filename || file.name,
                mimeType: file.type,
              }
              newUploadedItems.push({
                resource: mediaId,
                kind,
                category,
                alt,
                isSchematic: false,
              })
            } else {
              failedFiles.push(`${file.name}（服务端未返回媒体记录）`)
            }
          }
        } catch {
          failedFiles.push(`${file.name}（网络错误）`)
        }
        setUploadProgress({ current: i + 1, total: fileArray.length })
      }

      setFetchedPreviews((prev) => ({ ...prev, ...newPreviews }))

      if (newUploadedItems.length > 0) {
        // 逐条 ADD_ROW：只有行级 action 才会生成 `<path>.<行号>.<子字段>` 扁平状态，
        // 新上传的媒体才会真正进入提交数据。
        newUploadedItems.forEach((item, offset) => {
          addFieldRow({
            path: fieldPath,
            rowIndex: items.length + offset,
            schemaPath: fieldSchemaPath,
            subFieldState: buildRowState(item),
          })
        })
        setItems((prev) => [...prev, ...newUploadedItems])

        if (!currentCoverId) {
          const firstImage = newUploadedItems.find((it) => it.kind === 'image')
          const rid = getResourceId(firstImage?.resource)
          if (rid) setCoverValue(rid)
        }
        Message.success(`成功上传 ${newUploadedItems.length} 个媒体文件`)
      }

      if (failedFiles.length > 0) {
        Message.error(`${failedFiles.length} 个文件上传失败：${failedFiles.join('、')}`)
      }

      setIsUploading(false)
    },
    [
      addFieldRow,
      buildRowState,
      buildingName,
      currentCoverId,
      defaultUploadCategory,
      fieldPath,
      fieldSchemaPath,
      items.length,
      setCoverValue,
    ],
  )

  // 设为封面
  const handleSetCover = useCallback(
    (resourceId: number | null) => {
      if (!resourceId) return
      setCoverValue(resourceId)
      Message.success('已设为楼盘封面图')
    },
    [setCoverValue],
  )

  // 删除单项
  const handleDeleteItem = useCallback(
    (index: number) => {
      const target = items[index]
      if (!target) return
      const targetRid = getResourceId(target.resource)
      const next = items.filter((_, idx) => idx !== index)

      // 只走 REMOVE_ROW：行级 action 才是提交数据的事实来源。
      // 本地 items 与表单行现在一一对应（上传走 ADD_ROW），索引可直接复用。
      removeFieldRow({ path: fieldPath, rowIndex: index })
      setItems(next)

      if (targetRid && targetRid === currentCoverId) {
        const nextImage = next.find((it) => it.kind === 'image')
        setCoverValue(getResourceId(nextImage?.resource) ?? null)
      }
      Message.info('已移除该媒体')
    },
    [currentCoverId, fieldPath, items, removeFieldRow, setCoverValue],
  )

  // 修改单项分类
  const handleCategoryChange = useCallback(
    (index: number, category: BuildingMediaItem['category']) => {
      if (!items[index]) return
      // 直接更新该行的子字段路径，而不是把整个数组写回父路径。
      dispatchFields({
        type: 'UPDATE',
        path: `${fieldPath}.${index}.category`,
        value: category,
      })
      setItems((prev) => {
        const next = [...prev]
        if (next[index]) {
          next[index] = { ...next[index], category }
        }
        return next
      })
    },
    [dispatchFields, fieldPath, items],
  )

  // 调序：向左 / 向上
  const handleMoveLeft = useCallback(
    (index: number) => {
      if (index <= 0) return
      // 只交给 MOVE_ROW 应用一次；本地 items 仅作展示投影同步。
      moveFieldRow({ path: fieldPath, moveFromIndex: index, moveToIndex: index - 1 })
      setItems((prev) => {
        const next = [...prev]
        const temp = next[index - 1]
        next[index - 1] = next[index]
        next[index] = temp
        return next
      })
    },
    [fieldPath, moveFieldRow],
  )

  // 调序：向右 / 向下
  const handleMoveRight = useCallback(
    (index: number) => {
      if (index >= items.length - 1) return
      moveFieldRow({ path: fieldPath, moveFromIndex: index, moveToIndex: index + 1 })
      setItems((prev) => {
        const next = [...prev]
        const temp = next[index + 1]
        next[index + 1] = next[index]
        next[index] = temp
        return next
      })
    },
    [fieldPath, items.length, moveFieldRow],
  )

  // 过滤当前展示项
  const filteredItems = useMemo(() => {
    if (activeCategoryFilter === 'all') {
      return items.map((item, originalIndex) => ({ item, originalIndex }))
    }
    return items
      .map((item, originalIndex) => ({ item, originalIndex }))
      .filter(({ item }) => item.category === activeCategoryFilter)
  }, [activeCategoryFilter, items])

  // 分类统计数据
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {
      all: items.length,
      exterior: 0,
      lobby: 0,
      'common-area': 0,
      facilities: 0,
    }
    for (const item of items) {
      if (counts[item.category] !== undefined) {
        counts[item.category]++
      }
    }
    return counts
  }, [items])

  // 移动端 App 图标级流体网格拖拽核心处理
  const handlePointerDown = useCallback(
    (
      e: React.PointerEvent,
      originalIndex: number,
      filteredIndex: number,
    ) => {
      // 过滤掉点击在交互控件或其内部的事件
      const target = e.target as HTMLElement
      if (
        target.closest(
          'button, .arco-btn, .arco-select, .arco-popconfirm, input, .arco-tag, .arco-modal, .arco-tooltip',
        )
      ) {
        return
      }

      if (!gridContainerRef.current) return
      const children = Array.from(gridContainerRef.current.children) as HTMLElement[]
      if (children.length === 0) return

      const slotRects = children.map((c) => {
        const r = c.getBoundingClientRect()
        return { left: r.left, top: r.top, width: r.width, height: r.height }
      })

      const targetEl = e.currentTarget as HTMLElement
      try {
        targetEl.setPointerCapture(e.pointerId)
      } catch {}

      const initialDrag: FluidDragState = {
        fromOriginalIndex: originalIndex,
        fromFilteredIndex: filteredIndex,
        startX: e.clientX,
        startY: e.clientY,
        currentX: e.clientX,
        currentY: e.clientY,
        hoverFilteredIndex: filteredIndex,
        slotRects,
        isSettling: false,
      }

      fluidDragRef.current = initialDrag
      setFluidDrag(initialDrag)

      const onPointerMove = (moveEvt: PointerEvent) => {
        const cur = fluidDragRef.current
        if (!cur || cur.isSettling) return

        const currentX = moveEvt.clientX
        const currentY = moveEvt.clientY

        let closestIdx = cur.fromFilteredIndex
        let minDistance = Infinity

        for (let i = 0; i < cur.slotRects.length; i++) {
          const r = cur.slotRects[i]
          const centerX = r.left + r.width / 2
          const centerY = r.top + r.height / 2
          const dist = Math.hypot(currentX - centerX, currentY - centerY)
          if (dist < minDistance) {
            minDistance = dist
            closestIdx = i
          }
        }

        const updated: FluidDragState = {
          ...cur,
          currentX,
          currentY,
          hoverFilteredIndex: closestIdx,
        }
        fluidDragRef.current = updated
        setFluidDrag(updated)
      }

      const onPointerUp = (upEvt: PointerEvent) => {
        try {
          targetEl.releasePointerCapture(upEvt.pointerId)
        } catch {}
        window.removeEventListener('pointermove', onPointerMove)
        window.removeEventListener('pointerup', onPointerUp)
        window.removeEventListener('pointercancel', onPointerUp)

        const finalState = fluidDragRef.current
        if (!finalState) return

        const { fromOriginalIndex, fromFilteredIndex, hoverFilteredIndex } = finalState

        if (fromFilteredIndex === hoverFilteredIndex) {
          fluidDragRef.current = null
          setFluidDrag(null)
          return
        }

        const targetOriginalIndex = filteredItems[hoverFilteredIndex]?.originalIndex
        if (typeof targetOriginalIndex !== 'number' || fromOriginalIndex === targetOriginalIndex) {
          fluidDragRef.current = null
          setFluidDrag(null)
          return
        }

        const settlingState: FluidDragState = {
          ...finalState,
          isSettling: true,
        }
        fluidDragRef.current = settlingState
        setFluidDrag(settlingState)

        setTimeout(() => {
          // 只应用一次移动：表单侧交给 MOVE_ROW，本地 items 仅同步展示顺序。
          moveFieldRow({
            path: fieldPath,
            moveFromIndex: fromOriginalIndex,
            moveToIndex: targetOriginalIndex,
          })
          setItems((prev) => {
            const next = [...prev]
            const [moved] = next.splice(fromOriginalIndex, 1)
            next.splice(targetOriginalIndex, 0, moved)
            return next
          })
          fluidDragRef.current = null
          setFluidDrag(null)
          Message.success('已调整图片排序')
        }, 220)
      }

      window.addEventListener('pointermove', onPointerMove)
      window.addEventListener('pointerup', onPointerUp)
      window.addEventListener('pointercancel', onPointerUp)
    },
    [fieldPath, filteredItems, moveFieldRow],
  )

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
      {/* 顶部标题与批量上传参数 */}
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
            楼盘媒体工作台
          </div>
          <Text type="secondary" style={{ fontSize: 13 }}>
            支持图片/视频批量拖拽上传、智能格式识别、九宫格调序与一键封面设定
          </Text>
        </div>

        <Space size="medium">
          <span style={{ fontSize: 13, color: 'var(--theme-text-muted, #86909c)' }}>
            上传默认归类：
          </span>
          <Select
            size="small"
            value={defaultUploadCategory}
            onChange={(val) => setDefaultUploadCategory(val)}
            style={{ width: 140 }}
          >
            {Object.entries(CATEGORY_LABELS).map(([k, label]) => (
              <Select.Option key={k} value={k}>
                {label}
              </Select.Option>
            ))}
          </Select>
          <Button
            type="primary"
            size="small"
            icon={<IconPlus />}
            onClick={() => fileInputRef.current?.click()}
            loading={isUploading}
          >
            批量上传媒体
          </Button>
          <input
            type="file"
            ref={fileInputRef}
            style={{ display: 'none' }}
            multiple
            accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
            onChange={(e) => {
              if (e.target.files) handleBatchUpload(e.target.files)
              e.target.value = ''
            }}
          />
        </Space>
      </div>

      {/* 拖拽上传区（OPT-030 P2：键盘可达--role=button + Enter/Space 触发文件选择） */}
      <div
        role="button"
        tabIndex={0}
        aria-label="上传媒体：点击或按 Enter 选择文件，也可将图片视频拖拽到此处"
        onDragOver={(e) => {
          e.preventDefault()
          setIsDragOver(true)
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setIsDragOver(false)
          if (e.dataTransfer.files) handleBatchUpload(e.dataTransfer.files)
        }}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            fileInputRef.current?.click()
          }
        }}
        style={{
          border: `2px dashed ${isDragOver ? 'var(--theme-primary-500, #165dff)' : 'var(--theme-elevation-200, #c9cdd4)'}`,
          background: isDragOver
            ? 'rgba(22, 93, 255, 0.12)'
            : 'var(--theme-elevation-0, #fff)',
          borderRadius: 8,
          padding: '24px 16px',
          textAlign: 'center',
          cursor: 'pointer',
          transition: 'all 0.2s',
          marginBottom: 16,
        }}
      >
        <Space direction="vertical" align="center" size="small">
          <div style={{ fontSize: 28, color: 'var(--theme-primary-500, #165dff)' }}>
            <IconUpload />
          </div>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--theme-text, #1d2129)' }}>
            点击选择文件，或直接将多个图片 / 视频拖拽到此处
          </div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            支持 JPG、PNG、WEBP、MP4、MOV 等，单次最多上传 20 个文件
          </Text>
        </Space>
      </div>

      {/* 上传进度条 */}
      {isUploading && (
        <div
          style={{
            marginBottom: 16,
            padding: '12px 16px',
            background: 'var(--theme-elevation-0, #fff)',
            border: '1px solid var(--theme-elevation-150, #e5e5e5)',
            borderRadius: 6,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <Text>正在上传媒体资源...</Text>
            <Text type="secondary">
              {uploadProgress.current} / {uploadProgress.total}
            </Text>
          </div>
          <Progress
            percent={
              uploadProgress.total > 0
                ? Math.round((uploadProgress.current / uploadProgress.total) * 100)
                : 0
            }
            animation
          />
        </div>
      )}

      {/* 分类过滤 Tab */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 8,
          marginBottom: 16,
          borderBottom: '1px solid var(--theme-elevation-150, #e5e5e5)',
          paddingBottom: 12,
        }}
      >
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[
            { key: 'all', label: `全部 (${categoryCounts.all})` },
            { key: 'exterior', label: `外立面 (${categoryCounts.exterior})` },
            { key: 'lobby', label: `大堂 (${categoryCounts.lobby})` },
            { key: 'common-area', label: `公区 (${categoryCounts['common-area']})` },
            { key: 'facilities', label: `配套 (${categoryCounts.facilities})` },
          ].map((tab) => {
            const isActive = activeCategoryFilter === tab.key
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveCategoryFilter(tab.key)}
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

        <Text type="secondary" style={{ fontSize: 12 }}>
          共 {items.length} 个媒体资源（拖拽或使用箭头调序）
        </Text>
      </div>

      {/* 媒体卡片九宫格 */}
      {filteredItems.length === 0 ? (
        <Empty
          description={
            items.length === 0
              ? '暂无媒体资源，请在上方拖拽或点击批量上传'
              : '该分类下暂无媒体资源'
          }
          style={{ padding: '32px 0' }}
        />
      ) : (
        <div
          ref={gridContainerRef}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
            gap: 12,
            position: 'relative',
          }}
        >
          {filteredItems.map(({ item, originalIndex }, filteredIndex) => {
            const rid = getResourceId(item.resource)
            const isCover = Boolean(rid && rid === currentCoverId)
            const preview = rid ? previewMediaMap[rid] : null
            const isVideo = item.kind === 'video'
            
            const isCurrentActive = fluidDrag?.fromFilteredIndex === filteredIndex
            const isSettling = Boolean(fluidDrag?.isSettling && isCurrentActive)

            let dynamicTransform = 'none'
            let dynamicTransition = 'none'
            let dynamicZIndex = 1

            if (fluidDrag) {
              const {
                fromFilteredIndex,
                hoverFilteredIndex,
                startX,
                startY,
                currentX,
                currentY,
                slotRects,
              } = fluidDrag

              if (isCurrentActive) {
                if (!fluidDrag.isSettling) {
                  dynamicTransform = `translate3d(${currentX - startX}px, ${currentY - startY}px, 0) scale(1.06) rotate(1deg)`
                  dynamicTransition = 'none'
                  dynamicZIndex = 99
                } else {
                  const fromRect = slotRects[fromFilteredIndex]
                  const targetRect = slotRects[hoverFilteredIndex]
                  if (fromRect && targetRect) {
                    const dx = targetRect.left - fromRect.left
                    const dy = targetRect.top - fromRect.top
                    dynamicTransform = `translate3d(${dx}px, ${dy}px, 0) scale(1) rotate(0deg)`
                    dynamicTransition = 'transform 0.2s cubic-bezier(0.2, 0.9, 0.3, 1), box-shadow 0.2s ease'
                    dynamicZIndex = 99
                  }
                }
              } else {
                dynamicTransition = 'transform 0.24s cubic-bezier(0.2, 0.9, 0.3, 1)'
                if (
                  fromFilteredIndex < hoverFilteredIndex &&
                  filteredIndex > fromFilteredIndex &&
                  filteredIndex <= hoverFilteredIndex
                ) {
                  const curRect = slotRects[filteredIndex]
                  const targetSlotRect = slotRects[filteredIndex - 1]
                  if (curRect && targetSlotRect) {
                    const dx = targetSlotRect.left - curRect.left
                    const dy = targetSlotRect.top - curRect.top
                    dynamicTransform = `translate3d(${dx}px, ${dy}px, 0)`
                  }
                } else if (
                  fromFilteredIndex > hoverFilteredIndex &&
                  filteredIndex >= hoverFilteredIndex &&
                  filteredIndex < fromFilteredIndex
                ) {
                  const curRect = slotRects[filteredIndex]
                  const targetSlotRect = slotRects[filteredIndex + 1]
                  if (curRect && targetSlotRect) {
                    const dx = targetSlotRect.left - curRect.left
                    const dy = targetSlotRect.top - curRect.top
                    dynamicTransform = `translate3d(${dx}px, ${dy}px, 0)`
                  }
                }
              }
            }

            return (
              <div
                key={item.id || `${rid}-${originalIndex}`}
                className={`media-card-spring-wrapper ${isCurrentActive ? 'is-active-dragging' : ''} ${isSettling ? 'is-settling' : ''}`}
                onPointerDown={(e) => handlePointerDown(e, originalIndex, filteredIndex)}
                style={{
                  transform: dynamicTransform,
                  transition: dynamicTransition,
                  zIndex: dynamicZIndex,
                  cursor: isCurrentActive ? 'grabbing' : 'grab',
                }}
              >
                <Card
                  bodyStyle={{ padding: 8, background: 'var(--theme-elevation-0, #fff)' }}
                  style={{
                    borderRadius: 8,
                    border: isCurrentActive
                      ? '2px solid var(--theme-primary-500, #165dff)'
                      : isCover
                        ? '2px solid var(--theme-warning-500, #ff7d00)'
                        : '1px solid var(--theme-elevation-150, #e5e5e5)',
                    boxShadow: isCurrentActive
                      ? '0 20px 40px rgba(0, 0, 0, 0.22), 0 0 0 2px rgba(22, 93, 255, 0.3)'
                      : isCover
                        ? '0 2px 8px rgba(255,125,0,0.2)'
                        : '0 1px 4px rgba(0,0,0,0.04)',
                    position: 'relative',
                    overflow: 'hidden',
                    background: 'var(--theme-elevation-0, #fff)',
                    transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
                  }}
                >
                  {/* 封面指示或设为封面 */}
                  <div
                    onMouseDown={(e) => e.stopPropagation()}
                    style={{
                      position: 'absolute',
                      top: 6,
                      left: 6,
                      zIndex: 2,
                    }}
                  >
                  {isCover ? (
                    <Tag
                      color="orange"
                      icon={<IconStarFill />}
                      style={{ fontSize: 11, padding: '0 4px', height: 20, lineHeight: '18px' }}
                    >
                      封面图
                    </Tag>
                  ) : (
                    <Tooltip content="设为楼盘封面图">
                      <Button
                        size="mini"
                        type="secondary"
                        shape="round"
                        icon={<IconStar />}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleSetCover(rid)
                        }}
                        style={{
                          height: 20,
                          padding: '0 6px',
                          fontSize: 11,
                          background: 'var(--theme-elevation-50, #fafafa)',
                          border: '1px solid var(--theme-elevation-200, #c9cdd4)',
                          color: 'var(--theme-text, #1d2129)',
                        }}
                      >
                        设为封面
                      </Button>
                    </Tooltip>
                  )}
                </div>

                {/* 删除按钮 */}
                <div
                  onMouseDown={(e) => e.stopPropagation()}
                  style={{
                    position: 'absolute',
                    top: 6,
                    right: 6,
                    zIndex: 2,
                  }}
                >
                  <Popconfirm
                    title="确定移除该媒体？"
                    onOk={() => handleDeleteItem(originalIndex)}
                    // OPT-030 P1-3：确认弹窗接管焦点（focusLock 含 returnFocus，
                    // 关闭后焦点归还触发按钮），读屏用户可获知弹窗内容。
                    autoFocus
                    focusLock
                  >
                    <Button
                      size="mini"
                      type="secondary"
                      status="danger"
                      shape="circle"
                      icon={<IconDelete />}
                      aria-label={`删除第 ${originalIndex + 1} 个媒体`}
                      style={{
                        height: 22,
                        width: 22,
                        background: 'var(--theme-elevation-50, #fafafa)',
                        border: '1px solid var(--theme-elevation-200, #c9cdd4)',
                      }}
                    />
                  </Popconfirm>
                </div>

                {/* 缩略图区域（纯拖拽触控面） */}
                <div
                  style={{
                    width: '100%',
                    height: 115,
                    borderRadius: 6,
                    background: 'var(--theme-elevation-100, #f2f3f5)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                    position: 'relative',
                    marginBottom: 8,
                    userSelect: 'none',
                  }}
                >
                  {preview?.url ? (
                    isVideo ? (
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'var(--theme-text-muted, #86909c)',
                          pointerEvents: 'none',
                        }}
                      >
                        <IconFileVideo style={{ fontSize: 32, color: 'var(--theme-primary-500, #165dff)' }} />
                        <span
                          style={{
                            fontSize: 10,
                            marginTop: 4,
                            maxWidth: 120,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {preview.filename}
                        </span>
                      </div>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={preview.url}
                        alt={item.alt || ''}
                        draggable={false}
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                          userSelect: 'none',
                          pointerEvents: 'none',
                        }}
                      />
                    )
                  ) : preview ? (
                    // 有条目但无 url = 媒体已失效（素材库被删或拉取失败），
                    // 必须与「加载中」区分，否则运营看不出该移除这条坏引用。
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 4,
                        color: 'var(--theme-error-500, #f53f3f)',
                        fontSize: 11,
                        padding: '0 8px',
                        textAlign: 'center',
                        pointerEvents: 'none',
                      }}
                    >
                      <IconFileImage style={{ fontSize: 24 }} />
                      <span>媒体已失效，请移除</span>
                    </div>
                  ) : (
                    <Spin />
                  )}

                  {/* 格式角标与大图预览按钮 */}
                  <div
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (preview?.url) setPreviewModal({ url: preview.url, isVideo })
                    }}
                    style={{
                      position: 'absolute',
                      bottom: 4,
                      right: 4,
                      background: 'rgba(0,0,0,0.65)',
                      color: '#fff',
                      borderRadius: 3,
                      padding: '2px 5px',
                      fontSize: 10,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 3,
                      cursor: 'pointer',
                      zIndex: 2,
                    }}
                  >
                    {isVideo ? <IconFileVideo /> : <IconFileImage />}
                    {KIND_LABELS[item.kind]}
                    <IconEye style={{ fontSize: 10, marginLeft: 2 }} />
                  </div>
                </div>

                {/* 分类下拉选择 */}
                <div
                  onMouseDown={(e) => e.stopPropagation()}
                  style={{ marginBottom: 6 }}
                >
                  <Select
                    size="mini"
                    value={item.category}
                    onChange={(val) => handleCategoryChange(originalIndex, val)}
                    style={{ width: '100%' }}
                  >
                    {Object.entries(CATEGORY_LABELS).map(([k, label]) => (
                      <Select.Option key={k} value={k}>
                        {label}
                      </Select.Option>
                    ))}
                  </Select>
                </div>

                {/* 调序与位置操作 */}
                <div
                  onMouseDown={(e) => e.stopPropagation()}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    borderTop: '1px solid var(--theme-elevation-100, #f2f3f5)',
                    paddingTop: 4,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'grab' }}>
                    <IconDragArrow style={{ fontSize: 12, color: 'var(--theme-text-muted, #86909c)' }} />
                    <Text type="secondary" style={{ fontSize: 11, fontWeight: 500 }}>
                      #{originalIndex + 1}
                    </Text>
                  </div>
                  <Space size="mini">
                    <Tooltip content="向前移动">
                      <Button
                        size="mini"
                        type="text"
                        disabled={originalIndex === 0}
                        icon={<IconArrowLeft />}
                        onClick={() => handleMoveLeft(originalIndex)}
                        aria-label={`第 ${originalIndex + 1} 个媒体向前移动`}
                        style={{ padding: '0 4px', height: 20 }}
                      />
                    </Tooltip>
                    <Tooltip content="向后移动">
                      <Button
                        size="mini"
                        type="text"
                        disabled={originalIndex === items.length - 1}
                        icon={<IconArrowRight />}
                        onClick={() => handleMoveRight(originalIndex)}
                        aria-label={`第 ${originalIndex + 1} 个媒体向后移动`}
                        style={{ padding: '0 4px', height: 20 }}
                      />
                    </Tooltip>
                  </Space>
                </div>
              </Card>
            </div>
          )
        })}
        </div>
      )}

      {/* 媒体预览弹窗 */}
      <Modal
        visible={Boolean(previewModal)}
        onOk={() => setPreviewModal(null)}
        onCancel={() => setPreviewModal(null)}
        footer={null}
        title="媒体预览"
        style={{ width: 'auto', maxWidth: '80vw' }}
      >
        {previewModal &&
          (previewModal.isVideo ? (
            <video
              src={previewModal.url}
              controls
              autoPlay
              style={{ maxWidth: '100%', maxHeight: '70vh', display: 'block', margin: '0 auto' }}
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewModal.url}
              alt="预览"
              style={{ maxWidth: '100%', maxHeight: '70vh', display: 'block', margin: '0 auto' }}
            />
          ))}
      </Modal>
    </div>
  )
}
