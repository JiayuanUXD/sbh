import heroPoster from '@/assets/hero-poster.jpg'

/**
 * 首页 hero 底图与落地页 og:image 共用同一张图。
 *
 * 走 next 构建产物（/_next/static/media/…）而非 public/：平台在线构建
 * 曾把 public 下二进制图片剥离导致 /hero/poster.jpg 生产 404，
 * 构建产物随 .next 发布，不存在该问题。
 */
export const HERO_POSTER_SRC = heroPoster.src

export function heroPosterAbsoluteUrl(origin: string): string {
  return `${origin}${heroPoster.src}`
}
