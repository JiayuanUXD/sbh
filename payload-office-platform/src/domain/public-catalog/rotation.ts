/**
 * 首页「热门楼盘 / 精选房源」的桶内打散。
 *
 * 背景：两条 rail 的排序都是确定性的（楼盘 `recommendedOrder ↑, updatedAt ↓`；
 * 房源 `isFeatured ↓, updatedAt ↓, id ↑`），配合 300s 数据缓存，同一批用户每次
 * 进来看到的永远是同样 8 张。本模块在**不改变候选资格**的前提下，把「谁进这 8 张」
 * 从固定前 8 名改成「桶内洗牌 + 分组约束」，让曝光轮转起来。
 *
 * 三条不变量（改了任何一条，运营的预期就会失效）：
 *   1. **前 N 个不动**：运营在后台调过的排序 / 勾过的推荐是花钱买的曝光位，
 *      洗牌不能把它们挤掉；
 *   2. **同组上限**：8 张里同商圈（楼盘）/ 同楼盘（房源）最多 2 个，否则会出现
 *      「8 套全在陆家嘴」这种比固定排序更差的结果。供给不足时逐级放宽，**不能
 *      为了约束而给不满**；
 *   3. **纯函数**：同 seed 同输出、不修改入参，便于缓存与测试复现。
 *
 * seed 由「城市 + 时间桶」组成（桶宽 24h），桶号必须进 unstable_cache 的 key，
 * 否则 300s revalidate 会带着新 seed 重算，变成 5 分钟一换。
 */

/** 默认桶宽：24 小时。运营按天感知，缓存压力也最小。 */
export const ROTATION_BUCKET_HOURS = 24

const HOUR_MS = 60 * 60 * 1000
/** 主市场时区偏移（UTC+8）：桶边界对齐**北京时间零点**。不偏移的话 UTC 天界
 *  落在北京 08:00，「每天换一批」会变成「每天早上八点换一批」，和运营直觉相悖。 */
const CN_TZ_OFFSET_MS = 8 * HOUR_MS

/** 把时间戳折算成桶号：同一桶内所有请求拿到同一个 seed。 */
export function rotationBucket(
  now: number = Date.now(),
  bucketHours: number = ROTATION_BUCKET_HOURS,
): number {
  const width = Math.max(1, bucketHours) * HOUR_MS
  return Math.floor((now + CN_TZ_OFFSET_MS) / width)
}

/** FNV-1a 32 位：把「城市:桶号」折叠成 PRNG 种子，跨进程稳定。 */
function hashString(value: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export function rotationSeed(city: string, bucket: number): number {
  return hashString(`${city}:${bucket}`)
}

/** mulberry32：小、快、确定，128 位状态够不上，32 位足够 8 张牌的排列。 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Fisher–Yates；返回新数组，不改入参。 */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const result = items.slice()
  const random = mulberry32(seed)
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    const tmp = result[i]!
    result[i] = result[j]!
    result[j] = tmp
  }
  return result
}

export type DiversifyOptions<T> = Readonly<{
  /** 最终取几张 */
  take: number
  /** 前 N 个不参与洗牌（运营置顶），可超过 take（此时只按置顶截断） */
  pinned: number
  /** 同组最多几个；供给不足时自动放宽 */
  maxPerGroup: number
  /** 分组键（楼盘：商圈；房源：所在楼盘） */
  groupOf: (item: T) => string
  seed: number
}>

/**
 * 洗牌 + 分组约束 + 置顶保留。
 *
 * 放宽顺序：先按 `maxPerGroup` 贪心挑；挑不满就把上限 +1 再扫一遍，直到挑满
 * `take` 或上限超过 `take`（再大就等于不限制）。池子耗尽时有多少给多少。
 */
export function diversify<T>(items: readonly T[], options: DiversifyOptions<T>): readonly T[] {
  const { take, pinned, maxPerGroup, groupOf, seed } = options
  if (take <= 0 || items.length === 0) return []

  const head = items.slice(0, Math.min(Math.max(pinned, 0), take, items.length))
  const rest = seededShuffle(items.slice(head.length), seed)

  const picked: T[] = [...head]
  const counts = new Map<string, number>()
  for (const item of head) {
    const key = groupOf(item)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  const remaining = [...rest]
  // 上限从 maxPerGroup 起；若它本就超过 take（等于没有约束），直接从 take 起跑，
  // 否则循环一次都不进、只剩置顶项。
  const capStart = Math.min(Math.max(1, maxPerGroup), take)
  // 注意：这里**不能**在「某轮一个都没加进去」时提前 break——上限 +1 之后同一批
  // 候选可能就能加了（典型场景：置顶已经占满当前上限）。循环上界是 take，本身有界。
  for (let cap = capStart; cap <= take && picked.length < take; cap += 1) {
    for (let index = 0; index < remaining.length && picked.length < take; ) {
      const item = remaining[index]!
      const key = groupOf(item)
      if ((counts.get(key) ?? 0) < cap) {
        picked.push(item)
        counts.set(key, (counts.get(key) ?? 0) + 1)
        remaining.splice(index, 1)
      } else {
        index += 1
      }
    }
  }

  return picked
}
