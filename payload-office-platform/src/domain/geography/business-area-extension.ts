/**
 * 商圈扩展纯函数层（tasks.md M2.3 / PRD 02-02 商圈配置 §8, §11）
 *
 * 只做可序列化输入→输出的纯校验/规范化，不依赖 payload / React：
 *   - 边界多边形：GeoJSON Polygon，外环须闭合、坐标合法、且不自交
 *   - 别名：单项 1–50 字、去首尾空格、同商圈内按规范化值去重
 *   - 扩展中心点复用 location-hierarchy.assertValidCoordinates
 *
 * 同城站点关联、自身及祖先启用、版本乐观锁属副作用（需读库），留在
 * business-area-extension-protect.ts hook 内。
 */

import { InvalidOperationError } from '@/domain/shared/errors'

// ────────────────────────────────────────────────────────────
// 别名规范化
// ────────────────────────────────────────────────────────────

export type RawAlias = { alias?: unknown } | string | null | undefined

/**
 * 规范化别名列表：去首尾空格、丢弃空串、按规范化值(小写)去重、保留首次出现的原文。
 * 单项长度须 1–50，越界抛错。
 * 输入接受 Payload array 字段形态（[{alias}]）或纯字符串数组。
 */
export function normalizeAliases(input: unknown): Array<{ alias: string }> {
  if (input == null) return []
  if (!Array.isArray(input)) {
    throw new InvalidOperationError({
      domain: 'geography',
      code: 'INVALID_ALIASES',
      message: '别名必须是列表',
    })
  }
  const seen = new Set<string>()
  const out: Array<{ alias: string }> = []
  for (const item of input) {
    const raw =
      typeof item === 'string'
        ? item
        : item && typeof item === 'object' && 'alias' in item
          ? (item as { alias: unknown }).alias
          : undefined
    if (raw == null) continue
    if (typeof raw !== 'string') {
      throw new InvalidOperationError({
        domain: 'geography',
        code: 'INVALID_ALIAS_TYPE',
        message: `别名必须是文本，收到 ${String(raw)}`,
      })
    }
    const trimmed = raw.trim()
    if (trimmed.length === 0) continue
    if (trimmed.length > 50) {
      throw new InvalidOperationError({
        domain: 'geography',
        code: 'ALIAS_TOO_LONG',
        message: `别名单项不得超过 50 字：${trimmed.slice(0, 20)}…`,
      })
    }
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ alias: trimmed })
  }
  return out
}

// ────────────────────────────────────────────────────────────
// 边界多边形校验（GeoJSON Polygon 外环）
// ────────────────────────────────────────────────────────────

type Position = [number, number]

function isValidPosition(p: unknown): p is Position {
  return (
    Array.isArray(p) &&
    p.length >= 2 &&
    typeof p[0] === 'number' &&
    typeof p[1] === 'number' &&
    p[0] >= -180 &&
    p[0] <= 180 &&
    p[1] >= -90 &&
    p[1] <= 90
  )
}

/** 三点朝向：>0 逆时针，<0 顺时针，==0 共线 */
function orient(a: Position, b: Position, c: Position): number {
  const v = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  if (v > 0) return 1
  if (v < 0) return -1
  return 0
}

/** 共线时 c 是否落在 [a,b] 线段上 */
function onSegment(a: Position, b: Position, c: Position): boolean {
  return (
    Math.min(a[0], b[0]) <= c[0] &&
    c[0] <= Math.max(a[0], b[0]) &&
    Math.min(a[1], b[1]) <= c[1] &&
    c[1] <= Math.max(a[1], b[1])
  )
}

/** 两线段是否相交（含端点触碰 / 共线重叠） */
function segmentsIntersect(p1: Position, p2: Position, p3: Position, p4: Position): boolean {
  const o1 = orient(p1, p2, p3)
  const o2 = orient(p1, p2, p4)
  const o3 = orient(p3, p4, p1)
  const o4 = orient(p3, p4, p2)
  if (o1 !== o2 && o3 !== o4) return true
  if (o1 === 0 && onSegment(p1, p2, p3)) return true
  if (o2 === 0 && onSegment(p1, p2, p4)) return true
  if (o3 === 0 && onSegment(p3, p4, p1)) return true
  if (o4 === 0 && onSegment(p3, p4, p2)) return true
  return false
}

/**
 * 校验单个线性环：≥4 点、闭合、坐标合法、无自交。
 * 相邻边共享端点属正常闭合，不计自交；其余任意边相交/触碰即视为自交。
 */
function assertValidRing(ring: unknown, label: string): void {
  if (!Array.isArray(ring) || ring.length < 4) {
    throw new InvalidOperationError({
      domain: 'geography',
      code: 'BOUNDARY_RING_TOO_SHORT',
      message: `${label}至少需要 4 个坐标点（含闭合点）`,
    })
  }
  for (const p of ring) {
    if (!isValidPosition(p)) {
      throw new InvalidOperationError({
        domain: 'geography',
        code: 'BOUNDARY_POSITION_INVALID',
        message: `${label}存在非法坐标点（经度 -180~180、纬度 -90~90）`,
      })
    }
  }
  const first = ring[0] as Position
  const last = ring[ring.length - 1] as Position
  if (first[0] !== last[0] || first[1] !== last[1]) {
    throw new InvalidOperationError({
      domain: 'geography',
      code: 'BOUNDARY_NOT_CLOSED',
      message: `${label}未闭合：首尾坐标必须相同`,
    })
  }

  // 自交检测：去掉重复闭合点后的边序列，两两非相邻边不得相交
  const pts = ring.slice(0, -1) as Position[]
  const n = pts.length
  const edges: Array<[Position, Position]> = []
  for (let i = 0; i < n; i++) edges.push([pts[i], pts[(i + 1) % n]])
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      // 跳过相邻边（共享端点）与环上首尾相接的一对
      const adjacent = j === i + 1 || (i === 0 && j === edges.length - 1)
      if (adjacent) continue
      if (segmentsIntersect(edges[i][0], edges[i][1], edges[j][0], edges[j][1])) {
        throw new InvalidOperationError({
          domain: 'geography',
          code: 'BOUNDARY_SELF_INTERSECTION',
          message: `${label}存在自交，多边形必须简单闭合`,
        })
      }
    }
  }
}

/**
 * 校验边界 GeoJSON（可空）。为空/未配置直接放行。
 * 接受 `{ type:'Polygon', coordinates:[外环, ...内环] }`。
 */
export function assertValidBoundary(boundary: unknown): void {
  if (boundary == null) return
  if (typeof boundary !== 'object' || Array.isArray(boundary)) {
    throw new InvalidOperationError({
      domain: 'geography',
      code: 'BOUNDARY_NOT_POLYGON',
      message: '边界必须是 GeoJSON Polygon 对象',
    })
  }
  const geo = boundary as { type?: unknown; coordinates?: unknown }
  if (geo.type !== 'Polygon') {
    throw new InvalidOperationError({
      domain: 'geography',
      code: 'BOUNDARY_NOT_POLYGON',
      message: `边界类型必须为 Polygon，收到 ${String(geo.type)}`,
    })
  }
  if (!Array.isArray(geo.coordinates) || geo.coordinates.length === 0) {
    throw new InvalidOperationError({
      domain: 'geography',
      code: 'BOUNDARY_NO_RING',
      message: '边界缺少坐标环',
    })
  }
  geo.coordinates.forEach((ring, idx) => {
    assertValidRing(ring, idx === 0 ? '边界外环' : `边界内环#${idx}`)
  })
}
