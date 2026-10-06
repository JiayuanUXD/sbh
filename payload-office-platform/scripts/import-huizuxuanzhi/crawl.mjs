#!/usr/bin/env node
/**
 * 汇租选址（huizuxuanzhi.com）全量采集器 —— OPT-104 阶段 1/2。
 *
 * 只负责「把页面原样落盘」，不解析业务字段：解析口径改了只需重跑解析，
 * 不必再打一遍对方的站。零依赖（Node 24 内置 fetch/zlib），不需要 pnpm install。
 *
 * 子命令（按顺序执行，均可中断后重跑，已落盘的跳过）：
 *
 *   enumerate   抓楼盘列表页 /loupan?page=N 与房源列表页 /office?page=N
 *   buildings   按枚举结果抓楼盘详情页 /loupan/l{id}
 *   listings    按枚举结果抓房源详情页 /loupan/l{b}-x{id}.html
 *   images      从楼盘详情页内嵌的 buildingPicImages 下载楼盘图片（房源图片不抓）
 *   status      打印各阶段进度，不发请求
 *
 * 选项：
 *   --limit N        本次最多发 N 个详情/图片请求（试跑用）
 *   --pages a-b      enumerate 只抓指定页码区间（试跑用）
 *   --refresh-lists  enumerate 时覆盖已落盘的列表页（第二遍枚举、增量同步用）
 *
 * 礼貌约束（与 scripts/import-business-areas.ts 同口径，见 OPT-104 §爬取约束）：
 *   - 单线程，请求起点间隔 ≥ HZX_INTERVAL_MS（默认 2000ms）+ 0~500ms 抖动；
 *   - 429/502/503/504/网络错误 → 指数退避重试（30s 起，最多 6 次）；
 *   - 403、验证码页、非 HTML 响应 → **立即停机**，不换 IP、不破解，等人来评估；
 *   - 500 + 「发生错误」页 = 对方的 404（实测：不存在的 id 都这样），记为 gone。
 *
 * 数据目录：HZX_DATA_DIR（默认 scripts/import-huizuxuanzhi/data，已 gitignore）。
 * 建议放在 worktree 之外（例如 E:/hzx-data），worktree 删掉时数据不跟着丢。
 *
 *   raw/list-loupan/p{N}.html.gz       楼盘列表页
 *   raw/list-office/p{N}.html.gz       房源列表页
 *   raw/b/{id/1000}/{id}.html.gz       楼盘详情页
 *   raw/l/{id/1000}/{id}.html.gz       房源详情页
 *   img/b/{楼盘id}/{序号}-{文件名}       楼盘图片
 *   state/enum-buildings.json          枚举出的楼盘 id
 *   state/enum-listings.json           枚举出的 [房源id, 楼盘id]
 *   state/gone.jsonl                   对方已不存在的 id
 *   state/fetch-log.jsonl              每次请求的 url / 状态码 / 字节数 / 耗时
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync, renameSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync, gunzipSync } from 'node:zlib'

const BASE = 'https://www.huizuxuanzhi.com'
const HERE = dirname(fileURLToPath(import.meta.url))
const DATA = resolve(process.env.HZX_DATA_DIR || join(HERE, 'data'))
const INTERVAL_MS = Number(process.env.HZX_INTERVAL_MS || 2000)
const IMG_INTERVAL_MS = Number(process.env.HZX_IMG_INTERVAL_MS || 1000)
const JITTER_MS = 500
const TIMEOUT_MS = 30_000
const MAX_RETRIES = 6
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

const argv = process.argv.slice(2)
const cmd = argv[0]
const opt = (name) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}
const LIMIT = opt('--limit') ? Number(opt('--limit')) : Infinity
const REFRESH_LISTS = argv.includes('--refresh-lists')

// ---------------------------------------------------------------------------
// 落盘工具
// ---------------------------------------------------------------------------

const p = (...parts) => join(DATA, ...parts)
const ensureDir = (file) => mkdirSync(dirname(file), { recursive: true })

/** 先写临时文件再改名：进程被杀时不会留下半截 .gz 被当成「已完成」跳过。 */
function writeAtomic(file, buf) {
  ensureDir(file)
  const tmp = `${file}.tmp`
  writeFileSync(tmp, buf)
  renameSync(tmp, file)
}
const writeGz = (file, html) => writeAtomic(file, gzipSync(Buffer.from(html, 'utf8')))
export const readGz = (file) => gunzipSync(readFileSync(file)).toString('utf8')
const appendJsonl = (file, obj) => {
  ensureDir(file)
  appendFileSync(file, JSON.stringify(obj) + '\n')
}
const readJson = (file, fallback) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback)
const shard = (id) => String(Math.floor(Number(id) / 1000))
export const buildingFile = (id) => p('raw', 'b', shard(id), `${id}.html.gz`)
export const listingFile = (id) => p('raw', 'l', shard(id), `${id}.html.gz`)

function loadGone() {
  const file = p('state', 'gone.jsonl')
  const set = new Set()
  if (!existsSync(file)) return set
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue
    const g = JSON.parse(line)
    set.add(`${g.kind}:${g.id}`)
  }
  return set
}

// ---------------------------------------------------------------------------
// 限速 + 重试 + 停机判据
// ---------------------------------------------------------------------------

class StopError extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const lastStart = new Map()

async function throttle(host, interval) {
  const wait = (lastStart.get(host) ?? 0) + interval + Math.random() * JITTER_MS - Date.now()
  if (wait > 0) await sleep(wait)
  lastStart.set(host, Date.now())
}

const RETRYABLE = new Set([429, 502, 503, 504])
const ERROR_PAGE_MARK = '<title>发生错误</title>'
const BLOCK_MARKS = ['验证码', '访问过于频繁', '访问频率', 'captcha', 'slider', '安全验证', 'waf']

/**
 * 取一个 HTML 页面。返回 { status: 'ok', html } 或 { status: 'gone' }。
 * 遇到封禁迹象抛 StopError —— 调用方不得捕获后继续。
 */
async function fetchHtml(url, { expect } = {}) {
  for (let attempt = 0; ; attempt++) {
    await throttle('site', INTERVAL_MS)
    const t0 = Date.now()
    let res
    let body = ''
    try {
      res = await fetch(url, {
        headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9', Accept: 'text/html' },
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      body = await res.text()
    } catch (err) {
      appendJsonl(p('state', 'fetch-log.jsonl'), {
        url,
        error: String(err?.cause?.code || err?.message || err),
        ms: Date.now() - t0,
        at: new Date().toISOString(),
      })
      if (attempt >= MAX_RETRIES) throw new Error(`网络错误重试耗尽：${url} ${err}`)
      await backoff(attempt, `网络错误 ${err?.cause?.code || err?.message}`)
      continue
    }
    appendJsonl(p('state', 'fetch-log.jsonl'), {
      url,
      status: res.status,
      bytes: body.length,
      ms: Date.now() - t0,
      at: new Date().toISOString(),
      final: res.url !== url ? res.url : undefined,
    })

    const ctype = res.headers.get('content-type') || ''
    if (res.status === 403) throw new StopError(`403 Forbidden：${url} —— 疑似被封，停机待评估`)
    if (RETRYABLE.has(res.status)) {
      if (attempt >= MAX_RETRIES) throw new StopError(`${res.status} 重试耗尽：${url} —— 停机待评估`)
      await backoff(attempt, `HTTP ${res.status}`)
      continue
    }
    if (res.status === 500 && body.includes(ERROR_PAGE_MARK)) {
      // 对方的「不存在」。为防偶发 500 被误判，第一次先退避重试一次。
      if (attempt === 0) {
        await sleep(5000)
        continue
      }
      return { status: 'gone' }
    }
    if (res.status !== 200) {
      if (attempt >= 2) throw new StopError(`意外状态码 ${res.status}：${url}`)
      await backoff(attempt, `HTTP ${res.status}`)
      continue
    }
    if (!ctype.includes('text/html')) throw new StopError(`非 HTML 响应（${ctype}）：${url} —— 疑似被拦，停机待评估`)
    if (expect && !body.includes(expect)) {
      const lower = body.toLowerCase()
      const hit = BLOCK_MARKS.find((m) => lower.includes(m.toLowerCase()))
      throw new StopError(
        `页面缺少预期标记「${expect}」${hit ? `且含「${hit}」` : ''}：${url} —— 疑似验证页，停机待评估`,
      )
    }
    return { status: 'ok', html: body }
  }
}

async function backoff(attempt, why) {
  const ms = Math.min(30_000 * 2 ** attempt, 600_000)
  log(`  ${why}，${Math.round(ms / 1000)}s 后第 ${attempt + 1} 次重试`)
  await sleep(ms)
}

// ---------------------------------------------------------------------------
// 日志与进度
// ---------------------------------------------------------------------------

const LOG_FILE = p('logs', `crawl-${new Date().toISOString().slice(0, 10)}.log`)
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  ensureDir(LOG_FILE)
  appendFileSync(LOG_FILE, line + '\n')
}

function progress(label, done, total, startedAt) {
  const elapsed = (Date.now() - startedAt) / 1000
  const rate = done / Math.max(elapsed, 1)
  const etaH = rate > 0 ? (total - done) / rate / 3600 : NaN
  log(
    `${label} ${done}/${total}（${((done / total) * 100).toFixed(1)}%）速率 ${rate.toFixed(2)}/s，剩余约 ${etaH.toFixed(1)}h`,
  )
}

// ---------------------------------------------------------------------------
// 列表页解析（只取 id，业务字段留给解析阶段从详情页取）
// ---------------------------------------------------------------------------

/**
 * 只在主列表 <ul class="listCon propertyList"> 内取，避开侧栏「热门楼盘」等推荐位。
 * 终点取分页器而不是第一个 </ul>：楼盘条目里嵌着标签 <ul>，截到它会只剩前一两条
 *（烟测实测：2 页楼盘列表只解析出 12 个）。
 */
function mainList(html) {
  const start = html.indexOf('listCon propertyList')
  if (start < 0) return ''
  const end = html.indexOf('class="pagination"', start)
  return html.slice(start, end < 0 ? undefined : end)
}

export function parseTotalPages(html) {
  const m = html.match(/pageRemark">[^<]*<b>(\d+)<\/b>[^<]*<b>(\d+)<\/b>/)
  return m ? { pages: Number(m[1]), total: Number(m[2]) } : null
}

export function parseBuildingIds(html) {
  const ids = []
  for (const m of mainList(html).matchAll(/href="\/loupan\/l(\d+)"/g)) if (!ids.includes(m[1])) ids.push(m[1])
  return ids
}

export function parseListingIds(html) {
  const out = []
  const seen = new Set()
  for (const m of mainList(html).matchAll(/\/loupan\/l(\d+)-x(\d+)\.html/g)) {
    if (seen.has(m[2])) continue
    seen.add(m[2])
    out.push([m[2], m[1]])
  }
  return out
}

// ---------------------------------------------------------------------------
// 子命令
// ---------------------------------------------------------------------------

async function enumerateKind(kind) {
  const path = kind === 'loupan' ? '/loupan' : '/office'
  const dir = `list-${kind}`
  const first = p('raw', dir, 'p1.html.gz')
  let html1
  if (existsSync(first) && !REFRESH_LISTS) html1 = readGz(first)
  else {
    const r = await fetchHtml(`${BASE}${path}`, { expect: 'listCon propertyList' })
    html1 = r.html
    writeGz(first, html1)
  }
  const meta = parseTotalPages(html1)
  if (!meta) throw new StopError(`${path} 第 1 页解析不出总页数，页面结构可能变了`)
  log(`${path}：共 ${meta.pages} 页 / ${meta.total} 条`)

  const range = opt('--pages')
  const [from, to] = range ? range.split('-').map(Number) : [1, meta.pages]
  const startedAt = Date.now()
  let fetched = 0
  for (let n = Math.max(from, 2); n <= Math.min(to, meta.pages); n++) {
    const file = p('raw', dir, `p${n}.html.gz`)
    if (existsSync(file) && !REFRESH_LISTS) continue
    const r = await fetchHtml(`${BASE}${path}?page=${n}`, { expect: 'listCon propertyList' })
    writeGz(file, r.html)
    if (++fetched % 50 === 0) progress(`  ${path} 列表`, n - from + 1, Math.min(to, meta.pages) - from + 1, startedAt)
  }
  return meta
}

/** 从已落盘的列表页汇总 id（与抓取分开，便于第二遍枚举后合并）。 */
function collectEnum() {
  const bIds = new Set(readJson(p('state', 'enum-buildings.json'), []))
  const lMap = new Map(readJson(p('state', 'enum-listings.json'), []))
  const bDir = p('raw', 'list-loupan')
  const lDir = p('raw', 'list-office')
  if (existsSync(bDir))
    for (const f of readdirSync(bDir))
      if (f.endsWith('.gz')) parseBuildingIds(readGz(join(bDir, f))).forEach((id) => bIds.add(id))
  if (existsSync(lDir))
    for (const f of readdirSync(lDir))
      if (f.endsWith('.gz')) for (const [x, b] of parseListingIds(readGz(join(lDir, f)))) lMap.set(x, b)
  // 房源所属楼盘也算枚举到的楼盘（列表分页漂移时楼盘列表可能漏，房源列表补）
  for (const b of lMap.values()) bIds.add(b)
  const bArr = [...bIds].sort((a, b) => a - b)
  const lArr = [...lMap.entries()].sort((a, b) => a[0] - b[0])
  writeAtomic(p('state', 'enum-buildings.json'), JSON.stringify(bArr))
  writeAtomic(p('state', 'enum-listings.json'), JSON.stringify(lArr))
  return { buildings: bArr, listings: lArr }
}

async function cmdEnumerate() {
  const bMeta = await enumerateKind('loupan')
  const lMeta = await enumerateKind('office')
  const { buildings, listings } = collectEnum()
  log(
    `枚举完成：楼盘 ${buildings.length}（站点声称 ${bMeta.total}），房源 ${listings.length}（站点声称 ${lMeta.total}）`,
  )
  writeAtomic(
    p('state', 'enum-meta.json'),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        claimed: { buildings: bMeta.total, listings: lMeta.total },
        got: { buildings: buildings.length, listings: listings.length },
      },
      null,
      2,
    ),
  )
}

async function crawlDetails(kind) {
  const ids =
    kind === 'b'
      ? readJson(p('state', 'enum-buildings.json'), []).map((id) => ({
          id,
          url: `${BASE}/loupan/l${id}`,
          file: buildingFile(id),
        }))
      : readJson(p('state', 'enum-listings.json'), []).map(([id, b]) => ({
          id,
          url: `${BASE}/loupan/l${b}-x${id}.html`,
          file: listingFile(id),
        }))
  if (!ids.length) throw new Error('没有枚举结果，先跑 enumerate')
  // 楼盘页必有 loupanId 隐藏域；房源页必有「办公室概况」区块
  const expect = kind === 'b' ? 'id="loupanId"' : '办公室概况'
  const gone = loadGone()
  const todo = ids.filter((t) => !existsSync(t.file) && !gone.has(`${kind}:${t.id}`))
  log(
    `${kind === 'b' ? '楼盘' : '房源'}详情：共 ${ids.length}，已完成 ${ids.length - todo.length}，待抓 ${todo.length}${Number.isFinite(LIMIT) ? `（本次上限 ${LIMIT}）` : ''}`,
  )
  const startedAt = Date.now()
  let n = 0
  for (const t of todo) {
    if (n >= LIMIT) break
    const r = await fetchHtml(t.url, { expect })
    if (r.status === 'gone')
      appendJsonl(p('state', 'gone.jsonl'), { kind, id: t.id, url: t.url, at: new Date().toISOString() })
    else writeGz(t.file, r.html)
    if (++n % 100 === 0) progress(`  ${kind === 'b' ? '楼盘' : '房源'}`, n, Math.min(todo.length, LIMIT), startedAt)
  }
  log(`${kind === 'b' ? '楼盘' : '房源'}详情本轮结束：抓取 ${n}`)
}

/**
 * 图集地址有两种：OSS 绝对地址，以及对方站内的 `/uploads/…` 相对路径（如楼盘 5086）。
 * 相对路径补全为站内地址；其它形态（空、反斜杠路径等）丢弃。
 */
export function resolvePicUrl(raw) {
  const url = String(raw || '').trim()
  if (/^https?:\/\//.test(url)) return url
  if (url.startsWith('//')) return `https:${url}`
  if (url.startsWith('/')) return `${BASE}${url}`
  return null
}

/** 楼盘页 require 配置里内嵌的图集 JSON（pic_type 1/2 均为楼盘图）。 */
export function parseBuildingPics(html) {
  const m = html.match(/"buildingPicImages":(\[[\s\S]*?\])\s*[,}]/)
  if (!m) return []
  try {
    return JSON.parse(m[1])
  } catch {
    return []
  }
}

async function cmdImages() {
  const ids = readJson(p('state', 'enum-buildings.json'), [])
  const todo = []
  for (const id of ids) {
    const f = buildingFile(id)
    if (!existsSync(f)) continue
    const pics = parseBuildingPics(readGz(f))
    pics.forEach((pic, i) => {
      const url = resolvePicUrl(pic.pic_url)
      if (!url) return
      const name = decodeURIComponent(url.split('/').pop().split('?')[0]).replace(/[^\w.\-!]/g, '_')
      const file = p('img', 'b', String(id), `${String(i + 1).padStart(2, '0')}-${name}`)
      if (!existsSync(file)) todo.push({ id, url, file })
    })
  }
  log(`楼盘图片：待下载 ${todo.length}${Number.isFinite(LIMIT) ? `（本次上限 ${LIMIT}）` : ''}`)
  const startedAt = Date.now()
  let n = 0
  for (const t of todo) {
    if (n >= LIMIT) break
    for (let attempt = 0; ; attempt++) {
      // 站内 /uploads 图打的是对方的应用服务器，与页面同一节奏；OSS 图另起一路
      if (t.url.startsWith(BASE)) await throttle('site', INTERVAL_MS)
      else await throttle('img', IMG_INTERVAL_MS)
      try {
        // 对方 OSS 有防盗链（无 Referer 返回 403）。带对方站点的 Referer 属于绕过防盗链，
        // 用户在知悉法律风险后于 2026-10-06 拍板采用（OPT-104 §9 决定 ⑥）。站内 /uploads 图不设防。
        const res = await fetch(t.url, {
          headers: { 'User-Agent': UA, Referer: `${BASE}/` },
          signal: AbortSignal.timeout(60_000),
        })
        if (res.status === 404 || res.status === 403) {
          appendJsonl(p('state', 'img-missing.jsonl'), { ...t, status: res.status })
          break
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const buf = Buffer.from(await res.arrayBuffer())
        writeAtomic(t.file, buf)
        appendJsonl(p('state', 'img-log.jsonl'), {
          id: t.id,
          url: t.url,
          bytes: buf.length,
          sha1: createHash('sha1').update(buf).digest('hex'),
        })
        break
      } catch (err) {
        if (attempt >= 3) {
          appendJsonl(p('state', 'img-missing.jsonl'), { ...t, error: String(err) })
          break
        }
        await backoff(attempt, `图片 ${err}`)
      }
    }
    if (++n % 100 === 0) progress('  楼盘图片', n, Math.min(todo.length, LIMIT), startedAt)
  }
  log(`楼盘图片本轮结束：处理 ${n}`)
}

function cmdStatus() {
  const b = readJson(p('state', 'enum-buildings.json'), [])
  const l = readJson(p('state', 'enum-listings.json'), [])
  const gone = loadGone()
  const bDone = b.filter((id) => existsSync(buildingFile(id))).length
  const lDone = l.filter(([id]) => existsSync(listingFile(id))).length
  const goneB = [...gone].filter((g) => g.startsWith('b:')).length
  const goneL = [...gone].filter((g) => g.startsWith('l:')).length
  console.log(`数据目录：${DATA}`)
  console.log(`枚举：楼盘 ${b.length}，房源 ${l.length}`)
  console.log(`楼盘详情：${bDone}/${b.length}（gone ${goneB}）`)
  console.log(`房源详情：${lDone}/${l.length}（gone ${goneL}）`)
}

const COMMANDS = {
  enumerate: cmdEnumerate,
  buildings: () => crawlDetails('b'),
  listings: () => crawlDetails('l'),
  images: cmdImages,
  status: cmdStatus,
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  if (!COMMANDS[cmd]) {
    console.error(
      `用法：node crawl.mjs <${Object.keys(COMMANDS).join('|')}> [--limit N] [--pages a-b] [--refresh-lists]`,
    )
    process.exit(2)
  }
  mkdirSync(DATA, { recursive: true })
  try {
    await COMMANDS[cmd]()
  } catch (err) {
    if (err instanceof StopError) {
      log(`停机：${err.message}`)
      process.exit(3)
    }
    log(`异常退出：${err?.stack || err}`)
    process.exit(1)
  }
}
