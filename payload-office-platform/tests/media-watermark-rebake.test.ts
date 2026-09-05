import { describe, expect, it } from 'vitest'

import {
  decideRebakeAction,
  MEDIA_WATERMARK_CHUNK,
  MEDIA_WATERMARK_QUEUE,
  selectRebakeTargets,
} from '@/domain/media/watermark-rebake'

const CURRENT = 'abc123def4567890'

describe('selectRebakeTargets', () => {
  it('只挑 usage=listing-photo 的图片', () => {
    const ids = selectRebakeTargets({
      docs: [
        { id: 1, usage: 'listing-photo', mimeType: 'image/jpeg', watermark: null },
        { id: 2, usage: 'brand', mimeType: 'image/jpeg', watermark: null },
        { id: 3, usage: 'article', mimeType: 'image/jpeg', watermark: null },
      ],
      currentVersion: CURRENT,
    })
    expect(ids).toEqual([1])
  })

  it('跳过已是当前版本的——幂等，重跑安全', () => {
    const ids = selectRebakeTargets({
      docs: [
        { id: 1, usage: 'listing-photo', mimeType: 'image/jpeg', watermark: { version: CURRENT } },
        { id: 2, usage: 'listing-photo', mimeType: 'image/jpeg', watermark: { version: 'stale' } },
        { id: 3, usage: 'listing-photo', mimeType: 'image/jpeg', watermark: null },
      ],
      currentVersion: CURRENT,
    })
    expect(ids).toEqual([2, 3])
  })

  it('预筛选与 decideRebakeAction 同一个裁决——「已是当前版本」既被这里排除、也被它判成 skip；不是 skip 的照选', () => {
    const current = { id: 1, usage: 'listing-photo', mimeType: 'image/jpeg', watermark: { version: CURRENT } }
    expect(selectRebakeTargets({ docs: [current], currentVersion: CURRENT })).toEqual([])
    expect(
      decideRebakeAction({ storedVersion: current.watermark.version, currentVersion: CURRENT, hasBackup: false }),
    ).toBe('skip')

    const stale = { ...current, watermark: { version: 'stale' } }
    expect(selectRebakeTargets({ docs: [stale], currentVersion: CURRENT })).toEqual([1])
    expect(
      decideRebakeAction({ storedVersion: stale.watermark.version, currentVersion: CURRENT, hasBackup: false }),
    ).not.toBe('skip')
  })

  it('跳过非图片（视频没有水印可言）', () => {
    const ids = selectRebakeTargets({
      docs: [
        { id: 1, usage: 'listing-photo', mimeType: 'video/mp4', watermark: null },
        { id: 2, usage: 'listing-photo', mimeType: 'image/png', watermark: null },
      ],
      currentVersion: CURRENT,
    })
    expect(ids).toEqual([2])
  })

  it('gif / svg 也跳过——烘焙拒收它们，重刷若选中就会每轮重选、每轮失败，永远如此', () => {
    const ids = selectRebakeTargets({
      docs: [
        { id: 1, usage: 'listing-photo', mimeType: 'image/gif', watermark: null },
        { id: 2, usage: 'listing-photo', mimeType: 'image/svg+xml', watermark: null },
        { id: 3, usage: 'listing-photo', mimeType: 'image/jpeg', watermark: null },
      ],
      currentVersion: CURRENT,
    })
    expect(ids).toEqual([3])
  })

  it('缺 mimeType 的记录跳过而不是崩', () => {
    expect(
      selectRebakeTargets({
        docs: [{ id: 1, usage: 'listing-photo', mimeType: null, watermark: null }],
        currentVersion: CURRENT,
      }),
    ).toEqual([])
  })
})

describe('decideRebakeAction', () => {
  it('没有 storedVersion（null 或 undefined）→ backup-and-bake：从没烘过，当前文件就是干净原件', () => {
    expect(decideRebakeAction({ storedVersion: null, currentVersion: CURRENT, hasBackup: false })).toBe('backup-and-bake')
    expect(decideRebakeAction({ storedVersion: undefined, currentVersion: CURRENT, hasBackup: false })).toBe('backup-and-bake')
  })

  it('没有 storedVersion 时不看 hasBackup——media-source/ 里的旧副本属于上一次上传，备份要覆盖写', () => {
    expect(decideRebakeAction({ storedVersion: null, currentVersion: CURRENT, hasBackup: true })).toBe('backup-and-bake')
  })

  it('storedVersion 等于当前哈希 → skip，与有无备份无关（调用方据此在碰存储之前排除它）', () => {
    expect(decideRebakeAction({ storedVersion: CURRENT, currentVersion: CURRENT, hasBackup: true })).toBe('skip')
    expect(decideRebakeAction({ storedVersion: CURRENT, currentVersion: CURRENT, hasBackup: false })).toBe('skip')
  })

  it('旧哈希且有备份 → bake-from-backup', () => {
    expect(decideRebakeAction({ storedVersion: 'stale', currentVersion: CURRENT, hasBackup: true })).toBe('bake-from-backup')
  })

  it('旧哈希且无备份 → unrecoverable：既不能拿带水印的当前文件当原件，也不能再烘', () => {
    expect(decideRebakeAction({ storedVersion: 'stale', currentVersion: CURRENT, hasBackup: false })).toBe('unrecoverable')
  })
})

describe('队列常量', () => {
  it('分块大小与批量导入同口径', () => {
    expect(MEDIA_WATERMARK_CHUNK).toBe(20)
  })

  it('队列名稳定——改名会让在途 job 找不到 handler', () => {
    expect(MEDIA_WATERMARK_QUEUE).toBe('media-watermark')
  })
})
