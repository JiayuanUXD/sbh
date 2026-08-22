/**
 * 公开目录地理辅助函数（geo）
 *
 * 设计依据：.superpowers/sdd/2026-08-20-homepage-apple-redesign/task-3-brief.md
 *
 * OPT-035 首页「核心商圈附近房源」按距城市中心排序时使用。
 */

/**
 * 球面距离（km）。输入为高德 GCJ-02 坐标——GCJ-02 相对 WGS-84 的偏移在同城内
 * 基本同向，做「城市内相对距离排序 + 公里级展示」精度足够。
 */
const EARTH_RADIUS_KM = 6371

export function haversineKm(
  a: Readonly<{ latitude: number; longitude: number }>,
  b: Readonly<{ latitude: number; longitude: number }>,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.latitude - a.latitude)
  const dLng = toRad(b.longitude - a.longitude)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(s))
}
