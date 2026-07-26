/**
 * 北京时间 / UTC 转换工具
 *
 * 业务不变量（AGENTS.md §5.6）：
 *   - 数据库存储 UTC，产品显示和自然日统计使用 Asia/Shanghai
 *   - SLA 扫描固定同一 as_of 和 Asia/Shanghai 时间边界
 *
 * 实现：基于 Intl.DateTimeFormat 获取 Asia/Shanghai 时区 wall-clock，
 * 避免引入额外依赖（如 dayjs/moment-timezone）。
 */

const SHANGHAI_TZ = 'Asia/Shanghai'

/** 返回 ISO 8601 UTC 字符串（数据库存储格式） */
export function toUtcIso(date: Date): string {
  return date.toISOString()
}

/** 将 Date 转为 Asia/Shanghai 时区下的 YYYY-MM-DD HH:mm:ss 字符串 */
export function formatShanghai(date: Date): string {
  const fmt = new Intl.DateTimeFormat('zh-CN', {
    timeZone: SHANGHAI_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  // zh-CN 默认输出带"/"分隔；统一为 YYYY-MM-DD HH:mm:ss
  const parts = fmt.formatToParts(date)
  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`
}

/** 获取 Asia/Shanghai 时区下某时刻的自然日 YYYY-MM-DD */
export function shanghaiDate(date: Date): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: SHANGHAI_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return fmt.format(date)
}

/** 获取 Asia/Shanghai 时区下某自然日的 00:00:00 UTC 时刻（用于自然日查询起止） */
export function shanghaiDayStartUtc(date: Date): Date {
  // 上海时区 UTC+8；当日 00:00 上海 = 前一日 16:00 UTC
  const ymd = shanghaiDate(date).split('-').map(Number)
  const [y, m, d] = ymd
  // Date.UTC 月份从 0 计
  return new Date(Date.UTC(y, m - 1, d, -8, 0, 0, 0))
}

/** 获取 Asia/Shanghai 时区下某自然日的 23:59:59.999 UTC 时刻 */
export function shanghaiDayEndUtc(date: Date): Date {
  const start = shanghaiDayStartUtc(date)
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1)
  return end
}

/** 当前时刻是否落在 Asia/Shanghai 某自然日 [start, end] UTC 区间内 */
export function isWithinShanghaiDay(target: Date, day: Date): boolean {
  const start = shanghaiDayStartUtc(day).getTime()
  const end = shanghaiDayEndUtc(day).getTime()
  return target.getTime() >= start && target.getTime() <= end
}

/** 给定 Date 返回 Asia/Shanghai 时区下 YYYY-MM-DD（与 shanghaiDate 等价的别名，表达意图） */
export function shanghaiDayKey(date: Date): string {
  return shanghaiDate(date)
}

/** 解析 ISO 8601 UTC 字符串为 Date；非法返回 null */
export function parseUtcIso(s: string): Date | null {
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  return d
}
