/**
 * 同步包（NDJSON / NDJSON.gz）→ 校验过的行（OPT-104）。纯函数，供上传端点调用。
 *
 * 同步包是 build-dataset / reconcile 产出的机器文件，所以校验从严：任何一行不合格、
 * 混了不同 kind、超过行数上限，都整包拒收——不合格说明生成侧有 bug，带病入库只会更难查。
 */
import { gunzipSync } from 'node:zlib'

import { parseHuizuSyncRow, type HuizuSyncRow } from './huizuxuanzhi-row'

export const MAX_CHUNK_ROWS = 1000
/** 同 OPT-041 的上传上限；1,000 行楼盘（含简介）gzip 后约 1MB */
export const MAX_CHUNK_BYTES = 5 * 1024 * 1024
const MAX_UNZIPPED_BYTES = 40 * 1024 * 1024

export type ChunkKind = 'buildings' | 'listings' | 'retire'
const KIND_OF: Record<HuizuSyncRow['kind'], ChunkKind> = {
  building: 'buildings',
  listing: 'listings',
  retire: 'retire',
}

export type ChunkParseResult =
  | { readonly ok: true; readonly kind: ChunkKind; readonly rows: readonly HuizuSyncRow[] }
  | { readonly ok: false; readonly code: string; readonly errors: readonly string[] }

export function parseSyncChunk(data: Uint8Array): ChunkParseResult {
  if (data.length === 0) return { ok: false, code: 'EMPTY', errors: ['文件为空'] }
  if (data.length > MAX_CHUNK_BYTES) return { ok: false, code: 'FILE_TOO_LARGE', errors: ['文件超过 5MB'] }

  let text: string
  try {
    // gzip 魔数 1f 8b；否则按纯文本 NDJSON 处理
    const raw = data[0] === 0x1f && data[1] === 0x8b ? gunzipSync(data, { maxOutputLength: MAX_UNZIPPED_BYTES }) : data
    text = Buffer.from(raw).toString('utf8')
  } catch {
    return { ok: false, code: 'BAD_GZIP', errors: ['gzip 解压失败或解压后超过 40MB'] }
  }

  const lines = text.split('\n').filter((l) => l.trim() !== '')
  if (lines.length === 0) return { ok: false, code: 'EMPTY', errors: ['没有任何数据行'] }
  if (lines.length > MAX_CHUNK_ROWS) {
    return { ok: false, code: 'TOO_MANY_ROWS', errors: [`一包最多 ${MAX_CHUNK_ROWS} 行，实际 ${lines.length} 行`] }
  }

  const rows: HuizuSyncRow[] = []
  const errors: string[] = []
  const seen = new Set<string>()
  let kind: ChunkKind | null = null
  for (const [i, line] of lines.entries()) {
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      errors.push(`第 ${i + 1} 行不是合法 JSON`)
      continue
    }
    const parsed = parseHuizuSyncRow(value)
    if (!parsed.ok) {
      errors.push(`第 ${i + 1} 行：${parsed.errors.join('；')}`)
      continue
    }
    const rowKind = KIND_OF[parsed.row.kind]
    if (kind === null) kind = rowKind
    else if (kind !== rowKind) {
      errors.push(`第 ${i + 1} 行是 ${rowKind}，与本包的 ${kind} 不一致（一包只能装一种）`)
      continue
    }
    if (seen.has(parsed.row.externalId)) {
      errors.push(`第 ${i + 1} 行的 externalId ${parsed.row.externalId} 在本包内重复`)
      continue
    }
    seen.add(parsed.row.externalId)
    rows.push(parsed.row)
  }

  if (errors.length || kind === null) return { ok: false, code: 'INVALID_ROWS', errors: errors.slice(0, 50) }
  return { ok: true, kind, rows }
}
