/**
 * OPT-037 验证脚本共享「页面渲染哨兵」——Playwright / Node 侧读取器。
 *
 * 判据本身**不写在这里**，在 `sentinel.json`。本文件只做「读 JSON + 断言」。
 * 三个读取器（.mjs / .py / .sh）共用同一份 JSON，见 sentinel.json 的 `_why`。
 *
 * 用法（Playwright）：
 *   import { gotoChecked, sentinelFromHtml } from './lib/sentinel.mjs'
 *   const s = await gotoChecked(page, ORIGIN + '/listings/xxx')   // 返回 {status, family, ok, missing}
 *   if (!s.ok) throw new Error(...)   // 或写进报告的 sentinel 字段，别静默
 *
 * 硬规矩：**任何截图 / DOM 比对 / 像素比对之前都要先过一次哨兵**，
 * 并把 `status` 落进产物。本批的假结论全部出自「不读状态码」。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const SPEC = JSON.parse(readFileSync(path.join(HERE, 'sentinel.json'), 'utf8'))

/** 路由族按 `families` 数组顺序**先匹配先赢**（详情页排在同名列表页之前，顺序不能改）。 */
export function familyFor(pathname) {
  for (const f of SPEC.families) if (new RegExp(f.pattern).test(pathname)) return f
  return SPEC.fallback
}

/** 纯 HTML 字符串判定（用于只有 HTML 没有浏览器的场合）。 */
export function sentinelFromHtml(pathname, status, html) {
  const family = familyFor(pathname)
  const missing = family.requiredMarkers.filter((m) => !html.includes(m))
  const statusOk = SPEC.okStatus.includes(status)
  return { pathname, status, statusOk, family: family.id, missing, ok: statusOk && missing.length === 0 }
}

/**
 * 导航 + 哨兵。`expectStatus` 用于**故意**断言非 200（如多城开启态 legacy 路由的 307）：
 * 传了就只比状态码，不查选择器（重定向响应体没有页面）。
 */
export async function gotoChecked(page, url, opts = {}) {
  const { expectStatus = null, waitUntil = 'networkidle', redirect = true } = opts
  const res = await page.goto(url, { waitUntil })
  const status = res ? res.status() : 0
  const pathname = new URL(page.url()).pathname
  if (expectStatus != null) {
    return { pathname, status, statusOk: status === expectStatus, family: 'explicit', missing: [], ok: status === expectStatus }
  }
  const family = familyFor(pathname)
  const missing = []
  for (const sel of family.requiredSelectors) {
    // eslint-disable-next-line no-await-in-loop
    const n = await page.evaluate((s) => document.querySelectorAll(s).length, sel)
    if (n === 0) missing.push(sel)
  }
  const statusOk = SPEC.okStatus.includes(status)
  void redirect
  return { pathname, status, statusOk, family: family.id, missing, ok: statusOk && missing.length === 0 }
}

/** 不满足就抛——用在「后续断言全靠这页真的渲染了」的地方。 */
export async function gotoOrThrow(page, url, opts = {}) {
  const s = await gotoChecked(page, url, opts)
  if (!s.ok) {
    throw new Error(
      `[sentinel] ${url} 未通过渲染哨兵：status=${s.status} family=${s.family} 缺失选择器=${JSON.stringify(s.missing)}`,
    )
  }
  return s
}

/**
 * 只读状态码 + Location（不开页面）。用于断言重定向链。
 * 注意 Node fetch 默认跟随重定向，这里显式 `redirect: 'manual'`。
 */
export async function headStatus(url) {
  const res = await fetch(url, { redirect: 'manual' })
  return { status: res.status, location: res.headers.get('location') }
}
