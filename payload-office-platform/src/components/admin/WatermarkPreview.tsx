'use client'

/**
 * OPT-069：「站点设置 → 图片水印」的只读预览。
 *
 * 读表单里的当前值（`useFormFields`），拼成预览端点的查询串，展示两张样张。
 * 纯展示，不写任何数据——运营调参数时能立刻看到效果，而不是盲调。
 */

import React from 'react'
import { useFormFields } from '@payloadcms/ui'

function useValue(path: string): unknown {
  return useFormFields(([fields]) => fields?.[path]?.value)
}

type PreviewState =
  | { status: 'loading' }
  | { status: 'ok'; url: string }
  | { status: 'error'; message: string }

/**
 * 把失败的响应翻译成一句人话。**必须按状态码分开说**，这是本组件的核心职责。
 *
 * 沿革（别再合并回去）：本组件最初用 `<img src onError>`，而 `onError` 只知道
 * 「没加载出来」、拿不到状态码，于是把 401 / 403 / 5xx 一律显示成
 * 「预览需要『站点设置』管理权限」。OPT-069 上线后生产这个端点恒 500，页面上却写着
 * 权限提示——排查因此先往权限方向走了一圈，直到抓网络面板才看到真实状态码是 500。
 * 一句写死的提示比没有提示更糟：它不是「信息不足」，是**主动给出错误的方向**。
 *
 * 5xx 时把服务端的 `message` 一并显示：端点在 `site_settings:manage` 之后，看得到
 * 这句话的人本来就有权改站点配置，而这句话往往就是唯一能拿到的现场
 * （见 `lib/runtime/admin-route-error.ts` 头注释：应用日志当时并不进 CLS）。
 */
async function describeFailure(response: Response): Promise<string> {
  if (response.status === 401) return '登录态已失效，请重新登录后台后刷新本页。'
  if (response.status === 403) return '预览需要「站点设置」管理权限。'

  let detail = ''
  try {
    const body = (await response.json()) as { message?: unknown }
    if (typeof body?.message === 'string' && body.message.trim()) {
      detail = `：${body.message}`
    }
  } catch {
    // 响应体不是 JSON（例如平台网关直接返回的错误页），只报状态码即可。
  }
  return `预览渲染失败（HTTP ${response.status}）${detail}`
}

function PreviewImage({ src, alt }: { src: string; alt: string }): React.JSX.Element {
  const [state, setState] = React.useState<PreviewState>({ status: 'loading' })

  React.useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const response = await fetch(src, { credentials: 'same-origin' })
        if (!response.ok) {
          const message = await describeFailure(response)
          if (!cancelled) setState({ status: 'error', message })
          return
        }
        // 读成 data: URL 而不是 `URL.createObjectURL`。objectURL 需要有人负责 revoke，
        // 而 `src` 是从表单实时值拼出来的、挂载后会变一次，effect 清理函数就会把**当前
        // 正在显示的那个 blob** 撤掉，`<img>` 留着一个死 URL、naturalWidth 恒为 0
        // （实测：生产构建下三条 E2E 里这条稳定失败，dev 下因时序不同反而看不出来）。
        // 样张只有几十 KB，data: URL 没有生命周期、重挂载也不会失效，整类问题直接消失。
        const blob = await response.blob()
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as string)
          reader.onerror = () => reject(reader.error ?? new Error('读取预览图失败'))
          reader.readAsDataURL(blob)
        })
        if (!cancelled) setState({ status: 'ok', url: dataUrl })
      } catch {
        // fetch 本身抛错 = 请求没送达（断网、被拦截），与「服务端返回了错误」不是一回事。
        if (!cancelled) setState({ status: 'error', message: '预览请求未能送达服务端（网络中断或被拦截）。' })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [src])

  const boxStyle: React.CSSProperties = { width: 420, maxWidth: '100%' }

  if (state.status === 'loading') {
    return <p style={{ ...boxStyle, fontSize: 13, opacity: 0.7 }}>预览生成中…</p>
  }
  if (state.status === 'error') {
    return <p style={{ ...boxStyle, fontSize: 13, color: 'var(--theme-error-500, #a33)' }}>{state.message}</p>
  }
  // eslint-disable-next-line @next/next/no-img-element -- data: URL 无法过 next/image 优化
  return <img src={state.url} alt={alt} style={boxStyle} />
}

export default function WatermarkPreview(): React.JSX.Element {
  const tiledText = useValue('watermark.tiled.text')
  const tiledDensity = useValue('watermark.tiled.density')
  const tiledOpacity = useValue('watermark.tiled.opacity')
  const tiledAngle = useValue('watermark.tiled.angle')
  const badgeText = useValue('watermark.badge.text')
  const badgePosition = useValue('watermark.badge.position')
  const badgeOpacity = useValue('watermark.badge.opacity')

  const tiledUrl = `/api/watermark-preview?${new URLSearchParams({
    mode: 'tiled',
    text: String(tiledText ?? ''),
    density: String(tiledDensity ?? ''),
    opacity: String(tiledOpacity ?? ''),
    angle: String(tiledAngle ?? ''),
  })}`

  const badgeUrl = `/api/watermark-preview?${new URLSearchParams({
    mode: 'badge',
    text: String(badgeText ?? ''),
    position: String(badgePosition ?? ''),
    opacity: String(badgeOpacity ?? ''),
  })}`

  return (
    <div style={{ marginTop: 24 }}>
      <h4 style={{ marginBottom: 4 }}>效果预览</h4>
      <p style={{ marginTop: 0, opacity: 0.7, fontSize: 13 }}>
        样张含高亮玻璃幕墙与近黑家具——水印在这两端都要读得出来。改完参数保存后刷新本页更新预览。
      </p>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <figure style={{ margin: 0 }}>
          <PreviewImage src={tiledUrl} alt="详情大图满铺水印预览" />
          <figcaption style={{ fontSize: 12, opacity: 0.7 }}>详情大图（满铺）</figcaption>
        </figure>
        <figure style={{ margin: 0 }}>
          <PreviewImage src={badgeUrl} alt="卡片角标水印预览" />
          <figcaption style={{ fontSize: 12, opacity: 0.7 }}>卡片缩略图（角标）</figcaption>
        </figure>
      </div>
    </div>
  )
}
