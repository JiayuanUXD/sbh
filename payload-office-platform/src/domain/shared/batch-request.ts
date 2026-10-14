/**
 * 列表批量动作的请求条目（OPT-113）。
 *
 * 楼盘 / 房源两个批量上下架端点共用：客户端发来 `items: [{ id, expectedVersion? }]`，
 * 这里把它收口成可信的条目数组。逐条执行、逐条出结果是端点的事，这里不碰库。
 *
 * 上限 100 = 列表单页上限：勾选只在当前页内有效（跨页勾选的行运营看不见，
 * 对看不见的行做上下架不是好交互），所以一次请求不会合法地超过一页。
 */

export const BATCH_ACTION_MAX_ITEMS = 100

export type BatchItem = {
  id: number
  /** 列表读到的版本号；null 表示不带乐观锁 */
  expectedVersion: number | null
}

export type ParseBatchItemsResult =
  | { ok: true; items: BatchItem[] }
  | { ok: false; error: string }

/** 逐条结果：两个批量端点同一形状，列表的结果弹层只认这一种。 */
export type BatchItemResult =
  | { id: number; ok: true; status?: string }
  | { id: number; ok: false; error: string; code?: string; reasons?: string[] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 正整数 id：数字或纯数字字符串（PG 自增主键）。其余一律 null。 */
function toPositiveId(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null
  }
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) {
    const parsed = Number(value)
    return Number.isSafeInteger(parsed) ? parsed : null
  }
  return null
}

/**
 * 版本号会被原样拿去和库里的 `version` 做 `!==` 比较，所以只认非负整数；
 * 字符串 '3' 与数字 3 比较永远不等，放进来只会制造一次无法解释的版本冲突。
 */
function toExpectedVersion(value: unknown): number | null | 'invalid' {
  if (value === undefined || value === null) return null
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value
  return 'invalid'
}

export function parseBatchItems(
  raw: unknown,
  max: number = BATCH_ACTION_MAX_ITEMS,
): ParseBatchItemsResult {
  if (!Array.isArray(raw)) {
    return { ok: false, error: '批量条目格式不正确' }
  }
  if (raw.length === 0) {
    return { ok: false, error: '请至少选择一条记录' }
  }
  // 按原始条数判上限：先去重再判，等于允许塞任意大的请求体。
  if (raw.length > max) {
    return { ok: false, error: `一次最多处理 ${max} 条` }
  }

  const items: BatchItem[] = []
  const seen = new Set<number>()
  for (const entry of raw) {
    if (!isRecord(entry)) {
      return { ok: false, error: '批量条目格式不正确' }
    }
    const id = toPositiveId(entry.id)
    if (id === null) {
      return { ok: false, error: '批量条目包含非法 ID' }
    }
    const expectedVersion = toExpectedVersion(entry.expectedVersion)
    if (expectedVersion === 'invalid') {
      return { ok: false, error: '批量条目包含非法版本号' }
    }
    // 同一行被勾两次不该执行两遍；保留第一次出现的版本号。
    if (seen.has(id)) continue
    seen.add(id)
    items.push({ id, expectedVersion })
  }
  return { ok: true, items }
}

export function summarizeBatchResults(results: readonly BatchItemResult[]): {
  succeeded: number
  failed: number
} {
  let succeeded = 0
  for (const result of results) if (result.ok) succeeded += 1
  return { succeeded, failed: results.length - succeeded }
}

/**
 * 逐条执行时某条抛了异常 → 这一条的失败结果（批量端点逐条兜住，不让一条拖垮整批）。
 *
 * 文案只放行标了 `isPublic` 的错误：DomainError 的业务可预期错误（「已被他人修改」之类）
 * 与 Payload 自己标公开的校验错误。系统异常的原文可能含连接串、表结构，
 * 一律换成通用文案——判据与 Payload 的 `isErrorPublic` 同口径（见 shared/errors.ts）。
 */
export function batchFailureFromError(id: number, err: unknown): BatchItemResult {
  if (err instanceof Error && (err as { isPublic?: unknown }).isPublic === true) {
    const code = (err as { code?: unknown }).code
    return typeof code === 'string' && code.length > 0
      ? { id, ok: false, error: err.message, code }
      : { id, ok: false, error: err.message }
  }
  return { id, ok: false, error: '写入失败，请重试' }
}

/**
 * 列表侧预筛：把勾选的行分成「发给端点的条目」与「事先就知道不适用、跳过的行」。
 *
 * `skipReason` 由调用方用领域状态机给出（房源 `nextPublicationStatus`、楼盘
 * `nextBuildingStatus`），列表不自己写「已发布才能下架」之类的规则副本。
 * 端点仍逐条再校验——这里只是让确认弹层能事先说清「将跳过 N 条、为什么」。
 */
export function partitionForBatch<T extends { id: number; version: number | null }>(
  rows: readonly T[],
  skipReason: (row: T) => string | null,
): { items: BatchItem[]; skipped: Array<{ row: T; reason: string }> } {
  const items: BatchItem[] = []
  const skipped: Array<{ row: T; reason: string }> = []
  for (const row of rows) {
    const reason = skipReason(row)
    if (reason === null) items.push({ id: row.id, expectedVersion: row.version })
    else skipped.push({ row, reason })
  }
  return { items, skipped }
}

export type BatchResponse = {
  succeeded: number
  failed: number
  results: BatchItemResult[]
}

function parseItemResult(raw: unknown): BatchItemResult | null {
  if (!isRecord(raw)) return null
  const id = toPositiveId(raw.id)
  if (id === null) return null
  if (raw.ok === true) {
    return typeof raw.status === 'string' ? { id, ok: true, status: raw.status } : { id, ok: true }
  }
  const result: BatchItemResult = {
    id,
    ok: false,
    error: typeof raw.error === 'string' && raw.error.length > 0 ? raw.error : '操作失败',
  }
  if (typeof raw.code === 'string' && raw.code.length > 0) result.code = raw.code
  if (Array.isArray(raw.reasons)) {
    result.reasons = raw.reasons.filter((r): r is string => typeof r === 'string')
  }
  return result
}

/**
 * 客户端收口批量端点的 200 响应（外部数据一律 unknown 进来）。形状不对返回 null，
 * 由调用方按「操作失败」处理。计数从 results 重算，不信响应里的数字——
 * 结果弹层列出的条目和顶上的「成功 X / 失败 Y」必须对得上。
 */
export function parseBatchResponse(raw: unknown): BatchResponse | null {
  if (!isRecord(raw) || raw.ok !== true || !Array.isArray(raw.results)) return null
  const results: BatchItemResult[] = []
  for (const entry of raw.results) {
    const parsed = parseItemResult(entry)
    if (parsed === null) return null
    results.push(parsed)
  }
  return { ...summarizeBatchResults(results), results }
}
