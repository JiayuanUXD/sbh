import { describe, expect, it } from 'vitest'

import { describeRebakeStatus } from '@/components/admin/watermark-rebake-status'

/**
 * OPT-112 E7：「重刷全部房源图」按钮此前只回一句「已加入队列」，之后跑没跑、跑到哪、
 * 断没断全无反馈，运营只能再点——而每点一次就多开一条链。
 */
describe('describeRebakeStatus', () => {
  it('进度还没读到 → 按钮先禁用，避免在不知道是否在跑时又开一条链', () => {
    expect(describeRebakeStatus({ progress: 'loading', request: 'idle' })).toMatchObject({
      label: '重刷全部房源图',
      disabled: true,
    })
  })

  it('在跑 → 按钮禁用，显示已完成 / 总数', () => {
    const view = describeRebakeStatus({
      progress: { enabled: true, total: 17000, done: 2153, running: true },
      request: 'idle',
    })
    expect(view.label).toBe('重刷进行中')
    expect(view.disabled).toBe(true)
    expect(view.lines[0]).toBe('已完成 2153 / 17000 张')
  })

  it('没在跑且有剩余 → 可点，点名剩余张数', () => {
    const view = describeRebakeStatus({
      progress: { enabled: true, total: 100, done: 60, running: false },
      request: 'idle',
    })
    expect(view.disabled).toBe(false)
    expect(view.lines[0]).toBe('已完成 60 / 100 张')
    expect(view.lines.join('\n')).toContain('还有 40 张')
  })

  it('全部完成 → 说清楚已是当前参数，按钮仍可点（改参数保存后要能重刷）', () => {
    const view = describeRebakeStatus({
      progress: { enabled: true, total: 100, done: 100, running: false },
      request: 'idle',
    })
    expect(view.disabled).toBe(false)
    expect(view.lines.join('\n')).toContain('全部已是当前参数')
  })

  it('开关关闭 → 如实说明；按钮仍可点（运营可能刚在表单里打开并保存，点击时路由会再查一次）', () => {
    const view = describeRebakeStatus({ progress: { enabled: false }, request: 'idle' })
    expect(view.disabled).toBe(false)
    expect(view.lines.join('\n')).toContain('水印开关当前关闭')
  })

  it('进度读取失败 → 不卡住按钮，并提示去看日志', () => {
    const view = describeRebakeStatus({ progress: 'error', request: 'idle' })
    expect(view.disabled).toBe(false)
    expect(view.lines.join('\n')).toContain('读取进度失败')
  })

  it('排队中 → 禁用，防连点', () => {
    expect(
      describeRebakeStatus({ progress: { enabled: true, total: 1, done: 0, running: false }, request: 'queueing' }),
    ).toMatchObject({ label: '正在排队…', disabled: true })
  })

  /** 评审 Minor 5：POST 回的 reason 不能丢——进度读失败时，这是点击后唯一的反馈。 */
  it('点击后路由回「已有链在跑」→ 明说没有重复排队', () => {
    const view = describeRebakeStatus({ progress: 'error', request: 'idle', notice: 'running' })
    expect(view.lines.join('\n')).toContain('没有重复排队')
  })

  it('点击后排上了 → 明说已加入队列（进度读失败时也有反馈）', () => {
    const view = describeRebakeStatus({ progress: 'error', request: 'idle', notice: 'queued' })
    expect(view.lines.join('\n')).toContain('已加入队列')
  })

  /**
   * 评审 Minor 6：跑到一半改了参数，后半程按新参数烘，游标之前已处理的图停在旧参数，
   * 要等这一轮跑完再点一次才会补上——在跑的时候就要说清楚，不能让人以为改了立刻全量生效。
   */
  it('在跑时提示：中途改参数要等本轮跑完再点一次', () => {
    const view = describeRebakeStatus({
      progress: { enabled: true, total: 100, done: 10, running: true },
      request: 'idle',
    })
    expect(view.lines.join('\n')).toContain('跑完后再点一次')
  })

  it('排队失败 → 追加失败提示，进度照常显示', () => {
    const view = describeRebakeStatus({
      progress: { enabled: true, total: 10, done: 3, running: false },
      request: 'failed',
    })
    expect(view.lines[0]).toBe('已完成 3 / 10 张')
    expect(view.lines.join('\n')).toContain('排队失败')
  })
})
