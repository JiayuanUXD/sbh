'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Button,
  Empty,
  Input,
  Message,
  Modal,
  Pagination,
  Spin,
  Typography,
} from '@arco-design/web-react'
import { IconUpload } from '@arco-design/web-react/icon'

const { Text } = Typography

/** 素材库分页大小，与 GET /api/media 的 limit 保持一致。 */
const PAGE_SIZE = 24

interface MediaDoc {
  id: number
  url?: string
  filename?: string
  alt?: string
}

interface MediaListResponse {
  docs?: MediaDoc[]
  totalDocs?: number
}

export interface CoverPickerModalProps {
  visible: boolean
  /** 上传时用来预填 alt，如「陆家嘴」→「陆家嘴商圈封面」 */
  areaName: string
  onCancel: () => void
  /** 选定（或上传完成）时回调，交出可直接写进抽屉 state 的引用 */
  onPick: (cover: { id: number; url: string }) => void
}

/**
 * 封面选图/上传弹层（OPT-062）。
 *
 * 不复用 `MediaWorkbench`：它依赖 Payload 表单上下文的若干 hook（详见该文件顶部 import），
 * 只能活在 Payload 表单里，而商圈抽屉是表单之外的自定义 Arco 视图。
 * 上传范式（FormData + _payload 带 alt，显式判 res.ok）照抄它，不 import 它。
 */
export default function CoverPickerModal({
  visible,
  areaName,
  onCancel,
  onPick,
}: CoverPickerModalProps) {
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [docs, setDocs] = useState<MediaDoc[]>([])
  const [totalDocs, setTotalDocs] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [altInput, setAltInput] = useState(`${areaName}商圈封面`)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // 弹层每次打开都回到第一页、清空关键词，避免带着上次的筛选态进来。
  useEffect(() => {
    if (visible) {
      setKeyword('')
      setPage(1)
      setAltInput(`${areaName}商圈封面`)
    }
  }, [visible, areaName])

  const loadMedia = useCallback(async (currentPage: number, currentKeyword: string) => {
    setIsLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('limit', String(PAGE_SIZE))
      params.set('page', String(currentPage))
      params.set('depth', '0')
      if (currentKeyword.trim()) {
        params.set('where[alt][like]', currentKeyword.trim())
      }
      const res = await fetch(`/api/media?${params.toString()}`)
      if (!res.ok) {
        Message.error(`素材库加载失败（HTTP ${res.status}）`)
        setDocs([])
        setTotalDocs(0)
        return
      }
      const json = (await res.json()) as MediaListResponse
      setDocs(json.docs ?? [])
      setTotalDocs(json.totalDocs ?? 0)
    } catch {
      Message.error('素材库加载失败（网络错误）')
      setDocs([])
      setTotalDocs(0)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!visible) return
    loadMedia(page, keyword)
  }, [visible, page, keyword, loadMedia])

  const handleSelect = useCallback(
    (doc: MediaDoc) => {
      if (!doc.url) {
        Message.warning('该素材缺少可用地址，无法选用')
        return
      }
      onPick({ id: doc.id, url: doc.url })
    },
    [onPick],
  )

  const handleUpload = useCallback(
    async (file: File) => {
      const alt = altInput.trim() || `${areaName}商圈封面`
      const formData = new FormData()
      formData.append('file', file)
      formData.append('_payload', JSON.stringify({ alt }))

      setIsUploading(true)
      try {
        const res = await fetch('/api/media', {
          method: 'POST',
          body: formData,
        })
        // 非 2xx 会正常 resolve（413 超大 / 403 无权限 / 422 校验失败），
        // 不显式判断就会静默丢文件，用户只看到「没反应」，不知道缺了什么。
        if (!res.ok) {
          Message.error(`上传失败（HTTP ${res.status}）`)
          return
        }
        const docRes = await res.json()
        const doc = docRes?.doc
        if (!doc || !doc.id || !doc.url) {
          Message.error('上传失败：服务端未返回可用的媒体记录')
          return
        }
        Message.success('上传成功')
        onPick({ id: Number(doc.id), url: doc.url })
      } catch {
        Message.error('上传失败（网络错误）')
      } finally {
        setIsUploading(false)
      }
    },
    [altInput, areaName, onPick],
  )

  return (
    <Modal
      visible={visible}
      onCancel={onCancel}
      footer={null}
      title="选择商圈封面"
      style={{ width: 640 }}
    >
      <div style={{ marginBottom: 16 }}>
        <Text style={{ fontWeight: 600, fontSize: 13 }}>从素材库选择</Text>
        <div style={{ margin: '8px 0' }}>
          <Input.Search
            placeholder="按 alt 关键词搜索素材"
            value={keyword}
            onChange={(val) => {
              setKeyword(val)
              setPage(1)
            }}
            allowClear
          />
        </div>

        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '24px 0' }}>
            <Spin />
          </div>
        ) : docs.length === 0 ? (
          <Empty description="暂无匹配素材" style={{ padding: '16px 0' }} />
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))',
              gap: 8,
            }}
          >
            {docs.map((doc) => (
              <button
                key={doc.id}
                type="button"
                onClick={() => handleSelect(doc)}
                title={doc.alt || doc.filename || `#${doc.id}`}
                style={{
                  padding: 0,
                  border: '1px solid var(--theme-elevation-150, #e5e5e5)',
                  borderRadius: 6,
                  overflow: 'hidden',
                  cursor: 'pointer',
                  background: 'var(--theme-elevation-50, #fafafa)',
                  height: 80,
                }}
              >
                {doc.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={doc.url}
                    alt={doc.alt || ''}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  <div
                    style={{
                      width: '100%',
                      height: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 11,
                      color: 'var(--theme-text-muted, #86909c)',
                    }}
                  >
                    无预览
                  </div>
                )}
              </button>
            ))}
          </div>
        )}

        {totalDocs > PAGE_SIZE && (
          <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
            <Pagination
              size="small"
              current={page}
              pageSize={PAGE_SIZE}
              total={totalDocs}
              onChange={(nextPage) => setPage(nextPage)}
            />
          </div>
        )}
      </div>

      <div
        style={{
          borderTop: '1px solid var(--theme-elevation-150, #e5e5e5)',
          paddingTop: 16,
        }}
      >
        <Text style={{ fontWeight: 600, fontSize: 13 }}>上传新图</Text>
        <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
          <Input
            value={altInput}
            onChange={(val) => setAltInput(val)}
            placeholder={`${areaName}商圈封面`}
            style={{ flex: 1 }}
          />
          <Button
            type="primary"
            icon={<IconUpload />}
            loading={isUploading}
            onClick={() => fileInputRef.current?.click()}
          >
            选择文件上传
          </Button>
          <input
            type="file"
            ref={fileInputRef}
            style={{ display: 'none' }}
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) handleUpload(file)
            }}
          />
        </div>
        <Text type="secondary" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
          支持 JPG、PNG、WEBP。上传成功后立即作为封面选定，可在抽屉中撤销重选。
        </Text>
      </div>
    </Modal>
  )
}
