'use client'

/**
 * OPT-069：「重刷全部房源图」按钮。
 *
 * 水印是烘进像素的，改配置不追溯生效——没有这个按钮，上面那组参数就是一个
 * 「改了没反应」的旋钮。配置与重刷必须同时存在（spec §5.5）。
 *
 * OPT-112：挂载即读进度（已完成 / 总数、是否在跑），在跑时禁用按钮并每 15 秒刷新。
 * 此前按钮只回一句「已加入队列」，运营看不到链条跑没跑、断没断，只能再点——每点一次
 * 就多开一条链。显示规则见 `watermark-rebake-status.ts`。
 */

import React from 'react'

import {
  describeRebakeStatus,
  type RebakeProgressView,
  type RebakeRequestState,
} from './watermark-rebake-status'

const POLL_MS = 15_000

async function fetchProgress(): Promise<RebakeProgressView> {
  try {
    const response = await fetch('/api/watermark-rebake', { cache: 'no-store' })
    if (!response.ok) return 'error'
    return (await response.json()) as RebakeProgressView
  } catch {
    return 'error'
  }
}

export default function WatermarkRebakeButton(): React.JSX.Element {
  const [progress, setProgress] = React.useState<RebakeProgressView>('loading')
  const [request, setRequest] = React.useState<RebakeRequestState>('idle')

  const refresh = async (): Promise<void> => {
    setProgress(await fetchProgress())
  }

  // 挂载时读一次；在跑时每 15 秒再读。卸载后回来的响应丢掉，不往已卸载的组件写 state。
  const running = typeof progress === 'object' && progress.enabled && progress.running
  React.useEffect(() => {
    let cancelled = false
    const load = () => {
      void fetchProgress().then((next) => {
        if (!cancelled) setProgress(next)
      })
    }
    if (!running) {
      load()
      return () => {
        cancelled = true
      }
    }
    const timer = window.setInterval(load, POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [running])

  const trigger = async (): Promise<void> => {
    setRequest('queueing')
    try {
      const response = await fetch('/api/watermark-rebake', { method: 'POST' })
      if (!response.ok) {
        setRequest('failed')
        return
      }
      // 路由的三种 200：排上了 / 开关关着（`disabled`）/ 已有链在跑（`running`）。
      // 后两种都是「明确没排队」，进度刷新后按钮自会显示真实状态。
      await response.json()
      setRequest('idle')
      await refresh()
    } catch {
      setRequest('failed')
    }
  }

  const view = describeRebakeStatus({ progress, request })

  return (
    <div style={{ marginTop: 24 }}>
      <button type="button" className="btn btn--style-secondary" disabled={view.disabled} onClick={trigger}>
        {view.label}
      </button>
      {view.lines.map((line) => (
        <p key={line} style={{ fontSize: 13, opacity: 0.75, marginTop: 8 }}>
          {line}
        </p>
      ))}
    </div>
  )
}
