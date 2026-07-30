/**
 * 中文标题 → URL slug 工具
 *
 * 使用 pinyin-pro 将中文转为拼音，再清理为 kebab-case 格式。
 * 非中文字符（英文、数字）保持原样，特殊符号剥离。
 */

import { pinyin } from 'pinyin-pro'

/**
 * 将任意文本转为 URL-safe 的 kebab-case slug。
 *
 * 规则：
 *   1. 中文 → 拼音（不带声调）
 *   2. 英文/数字 → 原样保留并转小写
 *   3. 其他字符（㎡、标点、空格等）→ 转为连字符
 *   4. 连续连字符合并，首尾连字符去除
 *
 * @example
 *   slugify('静安中心 100㎡ 精装办公室') → 'jing-an-zhong-xin-100-jing-zhuang-ban-gong-shi'
 *   slugify('Hello World!') → 'hello-world'
 */
export function slugify(text: string): string {
  if (!text) return ''

  const py = pinyin(text, {
    toneType: 'none',
    separator: '-',
    nonZh: 'consecutive',
  })

  let slug = py.toLowerCase()
  // 去除特殊字符（仅保留 a-z、0-9、连字符、空格）
  slug = slug.replace(/[^a-z0-9\s-]/g, '')
  // 空格 → 连字符
  slug = slug.replace(/\s+/g, '-')
  // 多连字符合并
  slug = slug.replace(/-+/g, '-')
  // 首尾连字符剥离
  slug = slug.replace(/^-|-$/g, '')

  return slug
}

/**
 * 在给定前缀后追加序号保证唯一性，直到找到未被占用的 slug。
 *
 * @param baseSlug  基础 slug（不含序号）
 * @param exists    异步函数，传入候选 slug 返回是否已存在
 * @returns         可用的唯一 slug（如 baseSlug 已唯一则原样返回，否则追加 -2、-3...）
 */
export async function ensureUniqueSlug(
  baseSlug: string,
  exists: (candidate: string) => Promise<boolean>,
): Promise<string> {
  if (!baseSlug) return ''

  let candidate = baseSlug
  let suffix = 2
  while (await exists(candidate)) {
    candidate = `${baseSlug}-${suffix}`
    suffix++
  }
  return candidate
}
