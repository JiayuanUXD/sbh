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
  mimeType?: string
}

interface MediaListResponse {
  docs?: MediaDoc[]
  totalDocs?: number
}

export interface CoverPickerModalProps {
  visible: boolean
  /** 上传时用来预填 alt，如「陆家嘴」→「陆家嘴商圈封面」 */
  areaName: string
  /**
   * 区域类型文案，用于标题与 alt 预填（OPT-062 终审 C）。
   *
   * 弹层被商圈 / 行政区两个模块共用，此前写死了「商圈」——给「浦东新区」这个行政区
   * 配封面也会写出 alt「浦东新区商圈封面」，而 `Media.admin.useAsTitle = 'alt'`，
   * 这个错名会长期留在素材库里。调用方（GeographyListViewClient）按 `module.type`
   * 传下来，弹层本身不 import 模块配置，保持是个不依赖上层的纯组件。
   */
  areaKind: '商圈' | '行政区'
  onCancel: () => void
  /** 选定（或上传完成）时回调，交出可直接写进抽屉 state 的引用 */
  onPick: (cover: { id: number; url: string }) => void
}

/**
 * 上传一张封面媒体到 `/api/media`，返回可直接写进抽屉 state 的引用。
 *
 * 抽成独立函数（而不是内联在组件的 onChange 里）是为了能写**真实行为测试**：
 * mock `global.fetch` 直接断言「非 2xx 必须 throw、错误信息带状态码」，
 * 而不是靠字符串匹配源码里出现过 `res.ok`——那种断言防不住「判断逻辑被删掉」。
 *
 * 非 2xx 会正常 resolve（413 超大 / 403 无权限 / 422 校验失败），
 * 不显式判断就会静默丢文件，用户只看到「没反应」，不知道缺了什么，
 * 所以这里必须 throw 且带上 HTTP 状态码，调用方 catch 后原样把状态码展示给用户。
 *
 * 类型校验放在这里、在 `fetch` 之前拦：`<input accept>` 只是浏览器层面的选择器
 * 过滤，不是安全边界（拖拽上传、"所有文件"选项、被脚本化的 change 事件都能绕过），
 * `Media` 集合本身又是通用素材库、故意不收紧 mimeType（见组件文件头注释）。
 * 这条防线因此必须在客户端上传路径里显式做，且要早于网络请求——已经在
 * OPT-062 弹层里发生过一次真实事故：视频被素材库列表选中过、也可能被这里
 * 上传进来，最终在 C 端渲染成裂图的 `<img src=".mp4">`。
 */
export async function uploadCoverMedia(
  file: File,
  alt: string,
): Promise<{ id: number; url: string }> {
  if (!file.type.startsWith('image/')) {
    throw new Error(`不支持的文件类型（${file.type || '未知'}），仅支持 JPG/PNG/WEBP`)
  }

  const formData = new FormData()
  formData.append('file', file)
  formData.append('_payload', JSON.stringify({ alt }))

  const res = await fetch('/api/media', {
    method: 'POST',
    body: formData,
  })
  if (!res.ok) {
    throw new Error(`上传失败（HTTP ${res.status}）`)
  }
  const docRes = await res.json()
  const doc = docRes?.doc
  if (!doc || !doc.id || !doc.url) {
    throw new Error('上传失败：服务端未返回可用的媒体记录')
  }
  return { id: Number(doc.id), url: doc.url }
}

/**
 * 拉取素材库分页列表，供封面选图弹层使用。
 *
 * 抽成独立函数（与 `uploadCoverMedia`同级）是为了能写真实行为测试锁住
 * 「查询带了 mimeType 过滤」——这正是本轮要修的洞：弹层曾经把 `GET /api/media`
 * 的查询内联在 `useEffect` 里、不过滤 mimeType，素材库里的 `video/mp4`
 * 因此会被一起列出、且能被点击选中，选中后 C 端把它当图片渲染成
 * `<img src=".mp4">`，线上裂图。
 *
 * 用 `where[mimeType][like]=image`（而不是 `contains`）：两者在 drizzle 的
 * text 字段查询里都落到同一个 `ilike '%image%'`，选 `like`只是为了和本文件
 * 里已有的 `where[alt][like]` 保持同一种写法。已经起本地 dev server、对着真实
 * Postgres 库（14 条素材 = 12 张 image/jpeg + 2 条 video/mp4）实测过：
 * 加上这个过滤后 `totalDocs` 从 14 降到 12，两条 mp4 被排除。
 */
export async function fetchCoverMediaList(params: {
  page: number
  keyword: string
}): Promise<MediaListResponse> {
  const { page, keyword } = params
  const searchParams = new URLSearchParams()
  searchParams.set('limit', String(PAGE_SIZE))
  searchParams.set('page', String(page))
  searchParams.set('depth', '0')
  searchParams.set('where[mimeType][like]', 'image')
  if (keyword.trim()) {
    searchParams.set('where[alt][like]', keyword.trim())
  }

  const res = await fetch(`/api/media?${searchParams.toString()}`)
  if (!res.ok) {
    throw new Error(`素材库加载失败（HTTP ${res.status}）`)
  }
  return (await res.json()) as MediaListResponse
}

/**
 * 封面选图/上传弹层（OPT-062）。
 *
 * 不复用 `MediaWorkbench`：它依赖 Payload 表单上下文的若干 hook（`useDocumentInfo` /
 * `useField` / `useForm`，均来自 `@payloadcms/ui`），只能活在 Payload 表单里，
 * 而商圈抽屉是表单之外的自定义 Arco 视图，import 它会直接崩。
 * 上传范式（FormData + _payload 带 alt，显式判 res.ok）照抄它，不 import 它。
 */
export default function CoverPickerModal({
  visible,
  areaName,
  areaKind,
  onCancel,
  onPick,
}: CoverPickerModalProps) {
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [docs, setDocs] = useState<MediaDoc[]>([])
  const [totalDocs, setTotalDocs] = useState(0)
  const [isUploading, setIsUploading] = useState(false)
  const [altInput, setAltInput] = useState(`${areaName}${areaKind}封面`)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // 弹层每次打开都回到第一页、清空关键词，避免带着上次的筛选态进来；
  // areaName 在打开期间变化（理论上少见，但原实现会响应）也要重置一次 alt 预填。
  //
  // 这是「响应 prop 变化调整 state」场景，官方推荐做法是在渲染期间比较上一次的
  // prop 值来调整（而不是在 effect 里同步 setState）：effect 体内同步 setState
  // 会在同一次 commit 里多触发一次级联渲染，也是 react-hooks/set-state-in-effect
  // 要防的问题；这里在渲染阶段做，天然避免了那次多余的渲染。
  const [prevVisible, setPrevVisible] = useState(visible)
  const [prevAreaName, setPrevAreaName] = useState(areaName)
  const [prevAreaKind, setPrevAreaKind] = useState(areaKind)
  if (visible !== prevVisible || areaName !== prevAreaName || areaKind !== prevAreaKind) {
    setPrevVisible(visible)
    setPrevAreaName(areaName)
    setPrevAreaKind(areaKind)
    if (visible) {
      setKeyword('')
      setPage(1)
      setAltInput(`${areaName}${areaKind}封面`)
    }
  }

  // 加载态不再单独存 state，而是从「当前请求 key 是否已经出结果」派生：
  // loadedKey 只在 fetch 真正落地（.then/.catch 回调里，已经跨过异步边界）才更新，
  // effect 体内因此不再有任何同步 setState——这才是把 react-hooks/set-state-in-effect
  // 要防的「effect 触发多余一次级联渲染」从根上消除，而不是像早前版本那样把同一次
  // 同步调用包一层 Promise.resolve().then() 推迟到微任务：那只是让 lint 的调用图分析
  // 追踪不到，setIsLoading(true) 实际还是在同一轮事件循环、绘制之前无条件执行，
  // 级联渲染并没有真的减少，只是从「effect 同步帧」挪到了「紧随其后的微任务」。
  const requestKey = `${page}|${keyword}`
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const isLoading = loadedKey !== requestKey

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    const key = `${page}|${keyword}`

    fetchCoverMediaList({ page, keyword })
      .then((json) => {
        if (cancelled) return
        setDocs(json.docs ?? [])
        setTotalDocs(json.totalDocs ?? 0)
        setLoadedKey(key)
      })
      .catch((err) => {
        if (cancelled) return
        Message.error(err instanceof Error ? err.message : '素材库加载失败（网络错误）')
        setDocs([])
        setTotalDocs(0)
        setLoadedKey(key)
      })

    return () => {
      cancelled = true
    }
  }, [visible, page, keyword])

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
      const alt = altInput.trim() || `${areaName}${areaKind}封面`
      setIsUploading(true)
      try {
        const cover = await uploadCoverMedia(file, alt)
        Message.success('上传成功')
        onPick(cover)
      } catch (err) {
        Message.error(err instanceof Error ? err.message : '上传失败（网络错误）')
      } finally {
        setIsUploading(false)
      }
    },
    [altInput, areaName, areaKind, onPick],
  )

  return (
    <Modal
      visible={visible}
      onCancel={onCancel}
      footer={null}
      title={`选择${areaKind}封面`}
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
            placeholder={`${areaName}${areaKind}封面`}
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
