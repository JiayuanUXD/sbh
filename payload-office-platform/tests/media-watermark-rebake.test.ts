import { describe, expect, it } from 'vitest'

import type { Payload } from 'payload'

import {
  decideRebakeAction,
  MEDIA_WATERMARK_CHUNK,
  MEDIA_WATERMARK_QUEUE,
  rebakeChunk,
  type RebakeCandidate,
  selectRebakeTargets,
} from '@/domain/media/watermark-rebake'
import { MEDIA_COS_PREFIX } from '@/lib/storage/cos-config'
import { MEDIA_SOURCE_PREFIX, type MediaWriter } from '@/lib/storage/media-writer'

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

/**
 * `rebakeChunk` 的存储编排是本任务唯一会**不可逆地改写字节**的地方，也是三种情形里
 * 唯一有数据丢失后果的一段。没有注入点就一行覆盖不到：调换「先备份后覆盖」的顺序、
 * 把 unrecoverable 错记成 skip、拿当前带水印的字节去覆盖备份——全都能在纯函数单测里
 * 全绿通过。Task 4 的评审对 `bakeAfterUpload` 提的正是同一条，这里照它的做法用假写入器。
 */
type StorageEvent =
  | { op: 'get'; key: string }
  | { op: 'put'; key: string; body: string }
  | { op: 'update'; id: number; body: string }

function harness({ docs, storage = {} }: { docs: RebakeCandidate[]; storage?: Record<string, string> }) {
  const store = new Map<string, Buffer>(
    Object.entries(storage).map(([key, value]) => [key, Buffer.from(value)]),
  )
  const events: StorageEvent[] = []
  const errors: string[] = []

  const writer: MediaWriter = {
    async put({ prefix, filename, body }) {
      const key = `${prefix}/${filename}`
      events.push({ op: 'put', key, body: body.toString() })
      store.set(key, body)
    },
    async get({ prefix, filename }) {
      const key = `${prefix}/${filename}`
      events.push({ op: 'get', key })
      return store.get(key) ?? null
    },
  }

  const byId = new Map(docs.map((doc) => [doc.id, doc]))
  const payload = {
    findByID: async ({ id }: { id: number }) => {
      const doc = byId.get(id)
      if (!doc) throw new Error(`no such media ${id}`)
      return doc
    },
    update: async ({ id, file }: { id: number; file: { data: Buffer } }) => {
      events.push({ op: 'update', id, body: file.data.toString() })
      return byId.get(id)
    },
    logger: {
      error: (...args: unknown[]) => {
        errors.push(args.map((arg) => (typeof arg === 'string' ? arg : String(arg))).join(' '))
      },
    },
  } as unknown as Payload

  const writes = (): StorageEvent[] => events.filter((event) => event.op !== 'get')

  return { store, events, writes, errors, payload, createWriter: () => writer }
}

function photo(over: Partial<RebakeCandidate> = {}): RebakeCandidate {
  return { id: 1, usage: 'listing-photo', mimeType: 'image/jpeg', filename: 'a.jpg', watermark: null, ...over }
}

describe('rebakeChunk 的存储编排', () => {
  it('从没烘过 → 先把当前字节备份进 media-source/，再拿同一份字节重跑上传管线', async () => {
    const h = harness({ docs: [photo()], storage: { [`${MEDIA_COS_PREFIX}/a.jpg`]: 'clean' } })

    const result = await rebakeChunk({
      payload: h.payload,
      ids: [1],
      currentVersion: CURRENT,
      createWriter: h.createWriter,
    })

    expect(result).toEqual({ processed: 1, skipped: 0, failed: 0, unrecoverable: 0 })
    // 顺序铁律：备份必须先于覆盖写。反过来的话，烘焙一旦失败干净原件就永久没了。
    expect(h.writes()).toEqual([
      { op: 'put', key: `${MEDIA_SOURCE_PREFIX}/a.jpg`, body: 'clean' },
      { op: 'update', id: 1, body: 'clean' },
    ])
  })

  it('从没烘过时备份是覆盖写——media-source/ 里的旧副本属于上一次上传，留着会把新图换回旧图', async () => {
    const h = harness({
      docs: [photo()],
      storage: {
        [`${MEDIA_COS_PREFIX}/a.jpg`]: 'new-upload',
        [`${MEDIA_SOURCE_PREFIX}/a.jpg`]: 'previous-upload',
      },
    })

    await rebakeChunk({ payload: h.payload, ids: [1], currentVersion: CURRENT, createWriter: h.createWriter })

    expect(h.store.get(`${MEDIA_SOURCE_PREFIX}/a.jpg`)?.toString()).toBe('new-upload')
    expect(h.writes()).toContainEqual({ op: 'update', id: 1, body: 'new-upload' })
  })

  it('旧哈希且有备份 → 从备份重烘，且不碰备份本身（当前字节带旧水印，写回去就把它固化成原件了）', async () => {
    const h = harness({
      docs: [photo({ watermark: { version: 'stale' } })],
      storage: {
        [`${MEDIA_COS_PREFIX}/a.jpg`]: 'watermarked',
        [`${MEDIA_SOURCE_PREFIX}/a.jpg`]: 'clean',
      },
    })

    const result = await rebakeChunk({
      payload: h.payload,
      ids: [1],
      currentVersion: CURRENT,
      createWriter: h.createWriter,
    })

    expect(result).toEqual({ processed: 1, skipped: 0, failed: 0, unrecoverable: 0 })
    expect(h.writes()).toEqual([{ op: 'update', id: 1, body: 'clean' }])
  })

  it('旧哈希且无备份 → unrecoverable：不备份、不重烘，计入 failed 并单独点名', async () => {
    const h = harness({
      docs: [photo({ watermark: { version: 'stale' } })],
      storage: { [`${MEDIA_COS_PREFIX}/a.jpg`]: 'watermarked' },
    })

    const result = await rebakeChunk({
      payload: h.payload,
      ids: [1],
      currentVersion: CURRENT,
      createWriter: h.createWriter,
    })

    expect(result).toEqual({ processed: 0, skipped: 0, failed: 1, unrecoverable: 1 })
    expect(h.writes()).toEqual([])
    expect(h.errors.join('\n')).toContain('a.jpg')
    expect(h.errors.join('\n')).toContain('不可恢复')
  })

  it('已是当前版本 → skip：不写库、不写存储（预筛选之后被别的路径烘到当前版本的竞态）', async () => {
    const h = harness({
      docs: [photo({ watermark: { version: CURRENT } })],
      storage: { [`${MEDIA_COS_PREFIX}/a.jpg`]: 'done' },
    })

    const result = await rebakeChunk({
      payload: h.payload,
      ids: [1],
      currentVersion: CURRENT,
      createWriter: h.createWriter,
    })

    expect(result).toEqual({ processed: 0, skipped: 1, failed: 0, unrecoverable: 0 })
    expect(h.writes()).toEqual([])
  })

  it('单张失败不阻断后续', async () => {
    const h = harness({
      // a.jpg 的当前文件在存储里不存在 → 第一张抛错；b.jpg 正常。
      docs: [photo({ id: 1 }), photo({ id: 2, filename: 'b.jpg' })],
      storage: { [`${MEDIA_COS_PREFIX}/b.jpg`]: 'clean-b' },
    })

    const result = await rebakeChunk({
      payload: h.payload,
      ids: [1, 2],
      currentVersion: CURRENT,
      createWriter: h.createWriter,
    })

    expect(result).toEqual({ processed: 1, skipped: 0, failed: 1, unrecoverable: 0 })
    expect(h.writes()).toContainEqual({ op: 'update', id: 2, body: 'clean-b' })
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
