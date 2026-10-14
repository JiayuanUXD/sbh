/**
 * OPT-112：「重刷全部房源图」按钮的显示规则。纯函数，与组件分开以便在 node 环境单测
 * （仓库不引 DOM 测试环境）。
 *
 * 进度来自 `GET /api/watermark-rebake`（`readRebakeProgress`）。
 */

export type RebakeProgressView =
  | 'loading'
  | 'error'
  | { enabled: false }
  | { enabled: true; total: number; done: number; running: boolean }

export type RebakeRequestState = 'idle' | 'queueing' | 'failed'

export type RebakeStatusView = { label: string; disabled: boolean; lines: string[] }

const BASE_HINT = '先保存上面的参数，再点这里。只处理「素材用途 = 房源/楼盘实景」的图片。'

export function describeRebakeStatus({
  progress,
  request,
}: {
  progress: RebakeProgressView
  request: RebakeRequestState
}): RebakeStatusView {
  const lines: string[] = []
  let label = '重刷全部房源图'
  // 进度没读到之前先禁用：此刻不知道链条是否在跑，放开就可能又开一条。
  let disabled = progress === 'loading'

  if (progress === 'error') {
    lines.push('读取进度失败，仍可直接点按钮；若持续失败请查看服务日志。')
  } else if (progress !== 'loading' && !progress.enabled) {
    // 按钮不禁用：运营可能刚在表单里打开开关并保存，点击时路由会再查一次。
    lines.push('水印开关当前关闭，重刷不会做任何处理。先去「站点设置 → 图片水印」勾上「启用水印」并保存，再点这里。')
  } else if (progress !== 'loading') {
    const { total, done, running } = progress
    lines.push(`已完成 ${done} / ${total} 张`)
    if (running) {
      label = '重刷进行中'
      disabled = true
      lines.push('正在按当前参数逐批重新烘焙，每分钟约 20 张；本页每 15 秒刷新一次。关掉页面不影响后台继续跑。')
    } else if (total === 0) {
      lines.push('没有需要打水印的房源图。')
    } else if (done >= total) {
      lines.push('全部已是当前参数。改了上面的参数并保存后，再点这里重刷。')
    } else {
      lines.push(
        `还有 ${total - done} 张不是当前参数，点按钮开始（或继续）重刷。` +
          '若重刷跑完仍有剩余，多半是缺干净原件备份，原因见服务日志。',
      )
    }
  }

  if (request === 'queueing') {
    label = '正在排队…'
    disabled = true
  }
  if (request === 'failed') lines.push('排队失败，请刷新后重试；若持续失败请查看服务日志。')

  const running = typeof progress === 'object' && progress.enabled && progress.running
  if (!running) lines.push(BASE_HINT)
  return { label, disabled, lines }
}
