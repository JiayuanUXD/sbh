/**
 * 有效期工具
 *
 * 业务不变量（AGENTS.md §3.3, §4.2）：
 *   - Building / Listing 的商户有效期关系必须使用数据库级约束防止重叠
 *   - PostgreSQL 用区间排斥约束；SQLite 用事务内应用校验模拟
 *   - 边界时刻精确切换：包含起、不包含止 [start, end)
 */

export type ValidityPeriod = {
  /** 起始时刻（含），UTC ISO 字符串 */
  startsAt: string
  /** 结束时刻（不含），UTC ISO 字符串；null 表示无限期 */
  endsAt: string | null
}

/** 判断某时刻是否在有效期内（包含 startsAt，不包含 endsAt） */
export function isWithinValidity(target: Date, period: ValidityPeriod): boolean {
  const t = target.getTime()
  const start = new Date(period.startsAt).getTime()
  if (Number.isNaN(start)) return false
  if (t < start) return false
  if (period.endsAt === null) return true
  const end = new Date(period.endsAt).getTime()
  if (Number.isNaN(end)) return false
  return t < end
}

/** 两段有效期是否重叠（同 [start, end) 语义） */
export function periodsOverlap(a: ValidityPeriod, b: ValidityPeriod): boolean {
  const as = new Date(a.startsAt).getTime()
  const ae = a.endsAt === null ? Number.POSITIVE_INFINITY : new Date(a.endsAt).getTime()
  const bs = new Date(b.startsAt).getTime()
  const be = b.endsAt === null ? Number.POSITIVE_INFINITY : new Date(b.endsAt).getTime()
  if (Number.isNaN(as) || Number.isNaN(ae) || Number.isNaN(bs) || Number.isNaN(be)) return false
  return as < be && bs < ae
}

/** 与一组已有有效期比对，返回与之重叠的索引列表 */
export function findOverlappingIndexes(
  candidate: ValidityPeriod,
  existing: ValidityPeriod[],
): number[] {
  return existing.reduce<number[]>((acc, p, idx) => {
    if (periodsOverlap(candidate, p)) acc.push(idx)
    return acc
  }, [])
}

/** 校验区间是否合法：start 必填；end 必须严格大于 start */
export function isValidPeriod(p: ValidityPeriod): boolean {
  const s = new Date(p.startsAt).getTime()
  if (Number.isNaN(s)) return false
  if (p.endsAt === null) return true
  const e = new Date(p.endsAt).getTime()
  if (Number.isNaN(e)) return false
  return e > s
}
