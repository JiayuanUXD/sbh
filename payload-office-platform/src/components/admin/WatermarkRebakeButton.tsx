'use client'

/**
 * OPT-069：「重刷全部房源图」按钮。
 *
 * 水印是烘进像素的，改配置不追溯生效——没有这个按钮，上面那组参数就是一个
 * 「改了没反应」的旋钮。配置与重刷必须同时存在（spec §5.5）。
 */

import React from 'react'

type State = 'idle' | 'queueing' | 'queued' | 'failed'

export default function WatermarkRebakeButton(): React.JSX.Element {
  const [state, setState] = React.useState<State>('idle')

  const trigger = async (): Promise<void> => {
    setState('queueing')
    try {
      const response = await fetch('/api/watermark-rebake', { method: 'POST' })
      setState(response.ok ? 'queued' : 'failed')
    } catch {
      setState('failed')
    }
  }

  return (
    <div style={{ marginTop: 24 }}>
      <button type="button" className="btn btn--style-secondary" disabled={state === 'queueing'} onClick={trigger}>
        {state === 'queueing' ? '正在排队…' : '重刷全部房源图'}
      </button>
      <p style={{ fontSize: 13, opacity: 0.75, marginTop: 8 }}>
        {state === 'queued'
          ? '已加入队列。按当前参数逐批重新烘焙，几千张图可能要跑一会儿；已是当前参数的图会自动跳过。'
          : state === 'failed'
            ? '排队失败，请刷新后重试；若持续失败请查看服务日志。'
            : '先保存上面的参数，再点这里。只处理「素材用途 = 房源/楼盘实景」的图片。'}
      </p>
    </div>
  )
}
