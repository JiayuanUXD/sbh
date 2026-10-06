#!/usr/bin/env node
/**
 * 汇租选址采集进度看板（OPT-104）。零依赖，只读 HZX_DATA_DIR，不发任何外部请求。
 *
 *   node scripts/import-huizuxuanzhi/progress.mjs --data E:/hzx-data     # http://127.0.0.1:3740
 *   （也认 HZX_DATA_DIR 环境变量；端口用 HZX_PROGRESS_PORT 改）
 *
 * 进度按「页面请求」计：楼盘列表页 + 房源列表页 + 楼盘详情页 + 房源详情页，四段依次执行。
 * 速率取 fetch-log 最近 30 分钟的实际请求数；采集器单线程、请求起点间隔约 2.25 秒，
 * 各阶段速率基本一致，所以后续阶段的预计时间直接沿用当前速率。
 *
 * 枚举没跑完之前，详情页总数用站点声称的楼盘 / 房源数估算；枚举完成后换成实际枚举数。
 */
import { existsSync, openSync, readFileSync, readSync, readdirSync, statSync, closeSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseTotalPages, readGz } from './crawl.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const argData = process.argv.indexOf('--data')
const DATA = resolve(
  (argData > 0 ? process.argv[argData + 1] : undefined) || process.env.HZX_DATA_DIR || join(HERE, 'data'),
)
const PORT = Number(process.env.HZX_PROGRESS_PORT || 3740)
const RATE_WINDOW_MIN = 30
const STALE_AFTER_MS = 3 * 60 * 1000
const BUCKET_MIN = 10
const HISTORY_HOURS = 24

const p = (...parts) => join(DATA, ...parts)
const readJson = (file, fallback) => {
  try {
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback
  } catch {
    return fallback
  }
}

// ---------------------------------------------------------------------------
// fetch-log 增量读取：文件会涨到十几 MB，每次只读新增的字节
// ---------------------------------------------------------------------------

const log = { offset: 0, carry: '', buckets: new Map(), recent: [], errors: [], first: null, last: null, total: 0 }

function ingestFetchLog() {
  const file = p('state', 'fetch-log.jsonl')
  if (!existsSync(file)) return
  const size = statSync(file).size
  if (size < log.offset) Object.assign(log, { offset: 0, carry: '', buckets: new Map(), recent: [], errors: [], first: null, last: null, total: 0 })
  if (size === log.offset) return
  const fd = openSync(file, 'r')
  const buf = Buffer.alloc(size - log.offset)
  readSync(fd, buf, 0, buf.length, log.offset)
  closeSync(fd)
  log.offset = size
  const text = log.carry + buf.toString('utf8')
  const lines = text.split('\n')
  log.carry = lines.pop() ?? ''
  for (const line of lines) {
    if (!line.trim()) continue
    let e
    try {
      e = JSON.parse(line)
    } catch {
      continue
    }
    const t = Date.parse(e.at)
    if (!Number.isFinite(t)) continue
    log.total++
    log.first ??= t
    log.last = t
    const key = Math.floor(t / (BUCKET_MIN * 60_000)) * BUCKET_MIN * 60_000
    const b = log.buckets.get(key) ?? { n: 0, ms: 0, err: 0 }
    b.n++
    b.ms += Number(e.ms) || 0
    const isError = e.error || (e.status && e.status !== 200 && e.status !== 500)
    if (isError) b.err++
    log.buckets.set(key, b)
    const item = { at: e.at, url: e.url, status: e.status ?? null, error: e.error ?? null, ms: e.ms ?? null }
    log.recent.push(item)
    if (log.recent.length > 12) log.recent.shift()
    if (isError) {
      log.errors.push(item)
      if (log.errors.length > 20) log.errors.shift()
    }
  }
}

// ---------------------------------------------------------------------------
// 落盘文件计数（缓存 10 秒：房源详情 5.7 万个文件，没必要每次都扫）
// ---------------------------------------------------------------------------

let countCache = { at: 0, value: null }
function countFiles() {
  if (Date.now() - countCache.at < 10_000 && countCache.value) return countCache.value
  const countDir = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.html.gz')).length : 0)
  const countShards = (dir) =>
    existsSync(dir) ? readdirSync(dir).reduce((sum, shard) => sum + countDir(join(dir, shard)), 0) : 0
  const gone = { b: 0, l: 0 }
  const goneFile = p('state', 'gone.jsonl')
  if (existsSync(goneFile))
    for (const line of readFileSync(goneFile, 'utf8').split('\n'))
      if (line.trim()) {
        try {
          const g = JSON.parse(line)
          if (g.kind === 'b') gone.b++
          else if (g.kind === 'l') gone.l++
        } catch {
          // 半行（采集器正在写）下次再读
        }
      }
  const value = {
    listLoupan: countDir(p('raw', 'list-loupan')),
    listOffice: countDir(p('raw', 'list-office')),
    buildings: countShards(p('raw', 'b')),
    listings: countShards(p('raw', 'l')),
    gone,
  }
  countCache = { at: Date.now(), value }
  return value
}

function listMeta(kind) {
  const f = p('raw', `list-${kind}`, 'p1.html.gz')
  if (!existsSync(f)) return null
  try {
    return parseTotalPages(readGz(f))
  } catch {
    return null
  }
}

/** 最近一条「停机 / 异常退出 / 本轮结束」日志，用于判断采集器状态 */
function lastLifecycleLine() {
  const dir = p('logs')
  if (!existsSync(dir)) return null
  const files = readdirSync(dir)
    .filter((f) => /^crawl-.*\.log$/.test(f))
    .sort()
  for (const f of files.reverse()) {
    const lines = readFileSync(join(dir, f), 'utf8').trim().split('\n').reverse()
    const hit = lines.find((l) => /停机|异常退出|本轮结束|枚举完成/.test(l))
    if (hit) return hit
  }
  return null
}

// ---------------------------------------------------------------------------
// 汇总
// ---------------------------------------------------------------------------

function snapshot() {
  ingestFetchLog()
  const now = Date.now()
  const files = countFiles()
  const loupanMeta = listMeta('loupan')
  const officeMeta = listMeta('office')
  const enumBuildings = readJson(p('state', 'enum-buildings.json'), [])
  const enumListings = readJson(p('state', 'enum-listings.json'), [])

  const loupanPages = loupanMeta?.pages ?? 184
  const officePages = officeMeta?.pages ?? 2875
  const enumDone = files.listLoupan >= loupanPages && files.listOffice >= officePages && enumListings.length > 1000
  const buildingTotal = enumDone ? enumBuildings.length : (loupanMeta?.total ?? 3665)
  const listingTotal = enumDone ? enumListings.length : (officeMeta?.total ?? 57500)

  const phases = [
    { key: 'list-loupan', label: '楼盘列表页', done: Math.min(files.listLoupan, loupanPages), total: loupanPages },
    { key: 'list-office', label: '房源列表页', done: Math.min(files.listOffice, officePages), total: officePages },
    {
      key: 'buildings',
      label: '楼盘详情页',
      done: Math.min(files.buildings + files.gone.b, buildingTotal),
      total: buildingTotal,
      estimated: !enumDone,
      gone: files.gone.b,
    },
    {
      key: 'listings',
      label: '房源详情页',
      done: Math.min(files.listings + files.gone.l, listingTotal),
      total: listingTotal,
      estimated: !enumDone,
      gone: files.gone.l,
    },
  ]

  // 速率：最近 30 分钟的请求数
  const windowStart = now - RATE_WINDOW_MIN * 60_000
  let windowCount = 0
  let windowMs = 0
  for (const [key, b] of log.buckets) {
    if (key + BUCKET_MIN * 60_000 <= windowStart) continue
    windowCount += b.n
    windowMs += b.ms
  }
  // 窗口里最早一桶可能只有一部分落在窗口内；采集刚开始时窗口也不满，按实际跨度折算
  const span = Math.min(RATE_WINDOW_MIN * 60_000, Math.max(60_000, now - Math.max(windowStart, log.first ?? now)))
  const ratePerMin = windowCount > 0 ? windowCount / (span / 60_000) : 0

  // 各阶段依次执行：累加剩余量得到每段的完成时刻
  let cumulative = 0
  for (const ph of phases) {
    const remaining = Math.max(0, ph.total - ph.done)
    cumulative += remaining
    ph.remaining = remaining
    ph.eta = remaining === 0 ? null : ratePerMin > 0 ? now + (cumulative / ratePerMin) * 60_000 : null
  }
  const total = phases.reduce((s, ph) => s + ph.total, 0)
  const done = phases.reduce((s, ph) => s + ph.done, 0)
  const remaining = total - done

  const lifecycle = lastLifecycleLine()
  const lastAge = log.last ? now - log.last : null
  let state = 'running'
  if (remaining === 0) state = 'done'
  else if (lifecycle && /停机|异常退出/.test(lifecycle) && (lastAge === null || lastAge > 60_000)) state = 'stopped'
  else if (lastAge === null || lastAge > STALE_AFTER_MS) state = 'stale'

  const historyStart = Math.floor((now - HISTORY_HOURS * 3600_000) / (BUCKET_MIN * 60_000)) * BUCKET_MIN * 60_000
  const history = []
  for (let t = historyStart; t <= now; t += BUCKET_MIN * 60_000) {
    const b = log.buckets.get(t)
    history.push({ t, n: b?.n ?? 0, avgMs: b && b.n ? Math.round(b.ms / b.n) : null, err: b?.err ?? 0 })
  }
  // 去掉采集开始前的空桶
  const firstUsed = history.findIndex((h) => h.n > 0)
  const trimmed = firstUsed > 0 ? history.slice(firstUsed) : history

  return {
    now,
    dataDir: DATA,
    state,
    lifecycle,
    lastRequestAt: log.last,
    startedAt: log.first,
    totalRequests: log.total,
    ratePerMin,
    avgMsWindow: windowCount ? Math.round(windowMs / windowCount) : null,
    total,
    done,
    remaining,
    eta: remaining === 0 ? null : ratePerMin > 0 ? now + (remaining / ratePerMin) * 60_000 : null,
    phases,
    history: trimmed,
    bucketMinutes: BUCKET_MIN,
    recent: log.recent.slice().reverse(),
    errors: log.errors.slice().reverse(),
    errorCount: [...log.buckets.values()].reduce((s, b) => s + b.err, 0),
    goneTotal: files.gone.b + files.gone.l,
  }
}

// ---------------------------------------------------------------------------
// 页面
// ---------------------------------------------------------------------------

const PAGE = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>采集进度</title>
<style>
  :root {
    color-scheme: light;
    --page: #f9f9f7; --surface: #fcfcfb; --ink: #0b0b0b; --ink-2: #52514e; --muted: #898781;
    --grid: #e1e0d9; --axis: #c3c2b7; --ring: rgba(11,11,11,0.10);
    --accent: #2a78d6; --track: #cde2fb; --accent-hover: #1c5cab;
    --good: #0ca30c; --warning: #fab219; --serious: #ec835a; --critical: #d03b3b;
  }
  @media (prefers-color-scheme: dark) {
    :root:where(:not([data-theme="light"])) {
      color-scheme: dark;
      --page: #0d0d0d; --surface: #1a1a19; --ink: #ffffff; --ink-2: #c3c2b7; --muted: #898781;
      --grid: #2c2c2a; --axis: #383835; --ring: rgba(255,255,255,0.10);
      --accent: #3987e5; --track: #184f95; --accent-hover: #86b6ef;
    }
  }
  :root[data-theme="dark"] {
    color-scheme: dark;
    --page: #0d0d0d; --surface: #1a1a19; --ink: #ffffff; --ink-2: #c3c2b7; --muted: #898781;
    --grid: #2c2c2a; --axis: #383835; --ring: rgba(255,255,255,0.10);
    --accent: #3987e5; --track: #184f95; --accent-hover: #86b6ef;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--page); color: var(--ink); font: 14px/1.5 system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
  .wrap { max-width: 1080px; margin: 0 auto; padding: 24px 16px 48px; }
  header { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; justify-content: space-between; margin-bottom: 20px; }
  h1 { font-size: 20px; font-weight: 600; margin: 0; }
  .sub { color: var(--ink-2); font-size: 13px; }
  .badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; box-shadow: inset 0 0 0 1px var(--ring); background: var(--surface); font-weight: 600; font-size: 13px; }
  .badge svg { flex: none; }
  .card { background: var(--surface); border-radius: 12px; box-shadow: inset 0 0 0 1px var(--ring); padding: 20px; margin-bottom: 16px; }
  .hero { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 2fr); gap: 20px; align-items: center; }
  @media (max-width: 760px) { .hero { grid-template-columns: 1fr; } }
  .hero-label { color: var(--ink-2); font-size: 13px; }
  .hero-value { font-size: 48px; font-weight: 600; line-height: 1.1; letter-spacing: -0.5px; margin: 4px 0; }
  .hero-note { color: var(--ink-2); }
  .tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .tile { padding: 12px 14px; border-radius: 10px; box-shadow: inset 0 0 0 1px var(--ring); }
  .tile .k { color: var(--ink-2); font-size: 12px; }
  .tile .v { font-size: 22px; font-weight: 600; }
  .tile .d { color: var(--muted); font-size: 12px; }
  .tile .unit { font-size: 13px; font-weight: 400; color: var(--ink-2); }
  h2 { font-size: 15px; font-weight: 600; margin: 0 0 14px; }
  .phase { display: grid; grid-template-columns: 96px minmax(0, 1fr) 210px; gap: 14px; align-items: center; padding: 10px 0; border-top: 1px solid var(--grid); }
  .phase:first-of-type { border-top: 0; }
  @media (max-width: 760px) { .phase { grid-template-columns: 1fr; gap: 6px; } }
  .phase .name { font-weight: 600; }
  .meter { height: 10px; border-radius: 5px; background: var(--track); overflow: hidden; }
  .meter > i { display: block; height: 100%; border-radius: 5px; background: var(--accent); min-width: 0; }
  .phase .num { font-variant-numeric: tabular-nums; color: var(--ink-2); font-size: 13px; }
  .phase .eta { font-size: 13px; }
  .chart-wrap { position: relative; }
  svg.chart { width: 100%; height: 220px; display: block; overflow: visible; }
  svg.chart text { fill: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
  .col { fill: var(--accent); }
  .col:hover, .col.on { fill: var(--accent-hover); }
  .tip { position: absolute; pointer-events: none; background: var(--surface); color: var(--ink); box-shadow: 0 4px 16px rgba(0,0,0,.15), inset 0 0 0 1px var(--ring); border-radius: 8px; padding: 8px 10px; font-size: 12px; white-space: nowrap; transform: translate(-50%, -100%); display: none; }
  .tip b { font-size: 14px; }
  .tip .s { color: var(--ink-2); }
  details { margin-top: 10px; }
  summary { cursor: pointer; color: var(--ink-2); font-size: 13px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { text-align: left; padding: 6px 8px; border-top: 1px solid var(--grid); vertical-align: top; }
  th { color: var(--ink-2); font-weight: 600; border-top: 0; }
  td.n { font-variant-numeric: tabular-nums; text-align: right; }
  td.url { word-break: break-all; color: var(--ink-2); }
  .grid2 { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; }
  @media (max-width: 760px) { .grid2 { grid-template-columns: 1fr; } }
  .empty { color: var(--muted); font-size: 13px; }
  .hint { margin-top: 8px; color: var(--ink-2); font-size: 12px; }
  code { font-family: ui-monospace, Consolas, monospace; font-size: 12px; background: var(--page); padding: 1px 4px; border-radius: 4px; word-break: break-all; }
  .loading { opacity: .55; transition: opacity .2s; }
</style>
</head>
<body>
<div class="wrap" id="root">
  <header>
    <div>
      <h1>汇租选址采集进度</h1>
      <div class="sub" id="sub">加载中…</div>
    </div>
    <span class="badge" id="badge"></span>
  </header>

  <section class="card hero">
    <div>
      <div class="hero-label">预计完成时间（北京时间）</div>
      <div class="hero-value" id="eta">—</div>
      <div class="hero-note" id="etaNote"></div>
    </div>
    <div class="tiles">
      <div class="tile"><div class="k">总进度</div><div class="v" id="pct">—</div><div class="d" id="pctNote"></div></div>
      <div class="tile"><div class="k">当前速率</div><div class="v" id="rate">—</div><div class="d" id="rateNote"></div></div>
      <div class="tile"><div class="k">请求报错</div><div class="v" id="errs">—</div><div class="d">429 / 403 / 5xx（不含「已不存在」）/ 网络错误</div></div>
      <div class="tile"><div class="k">对方已不存在</div><div class="v" id="gone">—</div><div class="d">详情页返回「发生错误」，记为下架候选</div></div>
    </div>
  </section>

  <section class="card">
    <h2>分阶段进度</h2>
    <div id="phases"></div>
  </section>

  <section class="card">
    <h2 id="chartTitle">每 10 分钟请求数</h2>
    <div class="chart-wrap" id="chartWrap">
      <svg class="chart" id="chart" role="img" aria-label="每 10 分钟请求数柱状图"></svg>
      <div class="tip" id="tip"></div>
    </div>
    <details><summary>查看数据表</summary><div id="histTable"></div></details>
  </section>

  <div class="grid2">
    <section class="card"><h2>最近报错</h2><div id="errors"></div></section>
    <section class="card"><h2>最近请求</h2><div id="recent"></div></section>
  </div>
</div>
<script>
const TZ = 'Asia/Shanghai'
const dtParts = new Intl.DateTimeFormat('zh-CN', { timeZone: TZ, month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
// 「10月7日 周三 21:17」——Intl 默认会拼成「10/7周三 21:17」
const fmtDateTime = { format: (t) => { const p = Object.fromEntries(dtParts.formatToParts(t).map((x) => [x.type, x.value])); return p.month + '月' + p.day + '日 ' + p.weekday + ' ' + p.hour + ':' + p.minute } }
const fmtTime = new Intl.DateTimeFormat('zh-CN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })
const fmtFull = new Intl.DateTimeFormat('zh-CN', { timeZone: TZ, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
const nf = new Intl.NumberFormat('zh-CN')
const $ = (id) => document.getElementById(id)
const el = (tag, attrs = {}, text) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text != null) e.textContent = text; return e }
const svgEl = (tag, attrs = {}) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e }

function duration(ms) {
  if (ms == null || !Number.isFinite(ms)) return '—'
  const m = Math.round(ms / 60000)
  if (m < 60) return m + ' 分钟'
  const h = Math.floor(m / 60), r = m % 60
  if (h < 24) return h + ' 小时 ' + r + ' 分'
  return Math.floor(h / 24) + ' 天 ' + (h % 24) + ' 小时'
}

const ICONS = {
  running: '<circle cx="8" cy="8" r="6" fill="var(--good)"/><path d="M5.2 8.2l1.9 1.9 3.7-4" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  done: '<circle cx="8" cy="8" r="6" fill="var(--good)"/><path d="M5.2 8.2l1.9 1.9 3.7-4" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  stale: '<path d="M8 1.8l6.6 11.6H1.4z" fill="var(--warning)"/><path d="M8 6v3.6M8 11.4v.1" stroke="#0b0b0b" stroke-width="1.6" stroke-linecap="round"/>',
  stopped: '<circle cx="8" cy="8" r="6" fill="var(--critical)"/><path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4" stroke="#fff" stroke-width="1.6" stroke-linecap="round"/>',
}
const STATE_LABEL = { running: '运行中', done: '已完成', stale: '可能已停止', stopped: '已停机' }

function renderBadge(d) {
  const b = $('badge')
  b.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">' + ICONS[d.state] + '</svg>'
  b.appendChild(document.createTextNode(STATE_LABEL[d.state]))
  b.title = d.lifecycle || ''
}

function renderHero(d) {
  const ageSec = d.lastRequestAt ? Math.round((d.now - d.lastRequestAt) / 1000) : null
  $('sub').textContent = '数据目录 ' + d.dataDir + ' · 每 10 秒刷新 · 最近一次请求 ' + (ageSec == null ? '无' : ageSec + ' 秒前')
  if (d.state === 'done') { $('eta').textContent = '已完成'; $('etaNote').textContent = '全部页面已落盘' }
  else if (d.eta) {
    $('eta').textContent = fmtDateTime.format(d.eta)
    $('etaNote').textContent = '还需约 ' + duration(d.eta - d.now) + '，按最近 30 分钟速率估算' + (d.state !== 'running' ? '（采集器当前不在跑，恢复后才会继续）' : '')
  } else { $('eta').textContent = '—'; $('etaNote').textContent = '最近 30 分钟没有请求，无法估算' }
  const pct = d.total ? (d.done / d.total) * 100 : 0
  $('pct').textContent = pct.toFixed(1) + '%'
  $('pctNote').textContent = nf.format(d.done) + ' / ' + nf.format(d.total) + ' 个页面'
  $('rate').textContent = d.ratePerMin ? d.ratePerMin.toFixed(1) : '—'
  if (d.ratePerMin) $('rate').appendChild(el('span', { class: 'unit' }, ' 次/分钟'))
  $('rateNote').textContent = d.avgMsWindow != null ? '平均响应 ' + nf.format(d.avgMsWindow) + ' 毫秒 · 累计请求 ' + nf.format(d.totalRequests) : ''
  $('errs').textContent = nf.format(d.errorCount)
  $('gone').textContent = nf.format(d.goneTotal)
  if (d.state === 'stale' || d.state === 'stopped') {
    let hint = document.getElementById('resumeHint')
    if (!hint) { hint = el('div', { id: 'resumeHint', class: 'hint' }); $('etaNote').after(hint) }
    hint.textContent = ''
    hint.appendChild(document.createTextNode('恢复采集：'))
    hint.appendChild(el('code', {}, 'cd E:/wt-hzx/payload-office-platform && HZX_DATA_DIR=E:/hzx-data NODE_USE_ENV_PROXY=1 node scripts/import-huizuxuanzhi/crawl.mjs listings'))
    if (d.lifecycle) hint.appendChild(el('div', {}, '最近一条状态日志：' + d.lifecycle))
  } else document.getElementById('resumeHint')?.remove()
}

function renderPhases(d) {
  const root = $('phases'); root.textContent = ''
  for (const ph of d.phases) {
    const row = el('div', { class: 'phase' })
    row.appendChild(el('div', { class: 'name' }, ph.label))
    const mid = el('div')
    const meter = el('div', { class: 'meter', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(ph.total), 'aria-valuenow': String(ph.done), 'aria-label': ph.label })
    const fill = el('i'); fill.style.width = (ph.total ? Math.min(100, (ph.done / ph.total) * 100) : 0) + '%'
    meter.appendChild(fill); mid.appendChild(meter)
    const pct = ph.total ? ((ph.done / ph.total) * 100).toFixed(1) + '%' : '—'
    mid.appendChild(el('div', { class: 'num' }, nf.format(ph.done) + ' / ' + nf.format(ph.total) + (ph.estimated ? '（总数为站点声称值，枚举完成后修正）' : '') + ' · ' + pct + (ph.gone ? ' · 已不存在 ' + nf.format(ph.gone) : '')))
    row.appendChild(mid)
    let etaText
    if (ph.remaining === 0) etaText = '✓ 已完成'
    else if (ph.done === 0 && d.phases.some((x) => x !== ph && x.remaining > 0 && d.phases.indexOf(x) < d.phases.indexOf(ph))) etaText = '排队中 · 预计 ' + (ph.eta ? fmtDateTime.format(ph.eta) : '—') + ' 完成'
    else etaText = '预计 ' + (ph.eta ? fmtDateTime.format(ph.eta) : '—') + ' 完成'
    row.appendChild(el('div', { class: 'eta' }, etaText))
    root.appendChild(row)
  }
}

function niceMax(v) {
  if (v <= 0) return 10
  const exp = Math.pow(10, Math.floor(Math.log10(v)))
  for (const m of [1, 2, 2.5, 5, 10]) if (m * exp >= v) return m * exp
  return 10 * exp
}

function renderChart(d) {
  const svg = $('chart'); svg.textContent = ''
  const tip = $('tip')
  const data = d.history
  const W = svg.clientWidth || 900, H = 220, padL = 40, padR = 8, padT = 10, padB = 26
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H)
  const maxV = niceMax(Math.max(...data.map((h) => h.n), 1))
  const innerW = W - padL - padR, innerH = H - padT - padB
  const y = (v) => padT + innerH - (v / maxV) * innerH
  for (let i = 0; i <= 4; i++) {
    const v = (maxV / 4) * i, yy = y(v)
    svg.appendChild(svgEl('line', { x1: padL, x2: W - padR, y1: yy, y2: yy, stroke: i === 0 ? 'var(--axis)' : 'var(--grid)', 'stroke-width': 1 }))
    const t = svgEl('text', { x: padL - 6, y: yy + 4, 'text-anchor': 'end' }); t.textContent = nf.format(v); svg.appendChild(t)
  }
  if (!data.length) return
  const slot = innerW / data.length
  const bw = Math.max(1, Math.min(24, slot - 2))
  const labelEvery = Math.max(1, Math.ceil(data.length / 8))
  data.forEach((h, i) => {
    const x = padL + i * slot + (slot - bw) / 2
    const top = y(h.n), height = padT + innerH - top
    if (h.n > 0) {
      const r = Math.min(4, bw / 2, height)
      const path = 'M' + x + ',' + (padT + innerH) + 'V' + (top + r) + 'Q' + x + ',' + top + ' ' + (x + r) + ',' + top + 'H' + (x + bw - r) + 'Q' + (x + bw) + ',' + top + ' ' + (x + bw) + ',' + (top + r) + 'V' + (padT + innerH) + 'Z'
      svg.appendChild(svgEl('path', { d: path, class: 'col', 'data-i': i }))
    }
    // 命中区覆盖整个槽位，比柱子本身大
    const hit = svgEl('rect', { x: padL + i * slot, y: padT, width: slot, height: innerH, fill: 'transparent', tabindex: '0', 'data-i': i })
    const show = () => {
      svg.querySelectorAll('.col.on').forEach((c) => c.classList.remove('on'))
      svg.querySelector('.col[data-i="' + i + '"]')?.classList.add('on')
      tip.textContent = ''
      tip.appendChild(el('b', {}, nf.format(h.n) + ' 次'))
      tip.appendChild(el('div', { class: 's' }, fmtTime.format(h.t) + '–' + fmtTime.format(h.t + d.bucketMinutes * 60000)))
      tip.appendChild(el('div', { class: 's' }, h.avgMs != null ? '平均响应 ' + nf.format(h.avgMs) + ' 毫秒' : '无请求'))
      if (h.err) tip.appendChild(el('div', { class: 's' }, '报错 ' + h.err + ' 次'))
      const box = svg.getBoundingClientRect(), scale = box.width / W
      tip.style.left = (padL + i * slot + slot / 2) * scale + 'px'
      tip.style.top = (Math.min(top, padT + innerH - 4) - 6) * scale + 'px'
      tip.style.display = 'block'
    }
    const hide = () => { tip.style.display = 'none'; svg.querySelector('.col[data-i="' + i + '"]')?.classList.remove('on') }
    hit.addEventListener('pointermove', show); hit.addEventListener('focus', show)
    hit.addEventListener('pointerleave', hide); hit.addEventListener('blur', hide)
    svg.appendChild(hit)
    if (i % labelEvery === 0) {
      const t = svgEl('text', { x: padL + i * slot + slot / 2, y: H - 8, 'text-anchor': 'middle' }); t.textContent = fmtTime.format(h.t); svg.appendChild(t)
    }
  })
  $('chartTitle').textContent = '每 ' + d.bucketMinutes + ' 分钟请求数（最近 ' + duration(data.length * d.bucketMinutes * 60000) + '）'
  const table = el('table'); const head = el('tr')
  for (const h of ['时段', '请求数', '平均响应（毫秒）', '报错']) head.appendChild(el('th', {}, h))
  table.appendChild(head)
  data.slice().reverse().forEach((h) => {
    const tr = el('tr')
    tr.appendChild(el('td', {}, fmtDateTime.format(h.t)))
    tr.appendChild(el('td', { class: 'n' }, nf.format(h.n)))
    tr.appendChild(el('td', { class: 'n' }, h.avgMs == null ? '—' : nf.format(h.avgMs)))
    tr.appendChild(el('td', { class: 'n' }, String(h.err)))
    table.appendChild(tr)
  })
  $('histTable').textContent = ''; $('histTable').appendChild(table)
}

function renderList(rootId, rows, emptyText) {
  const root = $(rootId); root.textContent = ''
  if (!rows.length) { root.appendChild(el('div', { class: 'empty' }, emptyText)); return }
  const table = el('table'); const head = el('tr')
  for (const h of ['时间', '状态', '耗时', '地址']) head.appendChild(el('th', {}, h))
  table.appendChild(head)
  for (const r of rows) {
    const tr = el('tr')
    tr.appendChild(el('td', {}, fmtFull.format(Date.parse(r.at))))
    tr.appendChild(el('td', {}, r.error ? '网络错误' : r.status === 500 ? '500（已不存在）' : String(r.status)))
    tr.appendChild(el('td', { class: 'n' }, r.ms == null ? '—' : nf.format(r.ms) + 'ms'))
    tr.appendChild(el('td', { class: 'url' }, (r.url || '').replace('https://www.huizuxuanzhi.com', '')))
    table.appendChild(tr)
  }
  root.appendChild(table)
}

let last = null
async function refresh() {
  $('root').classList.add('loading')
  try {
    const res = await fetch('/api/progress', { cache: 'no-store' })
    last = await res.json()
    renderBadge(last); renderHero(last); renderPhases(last); renderChart(last)
    renderList('errors', last.errors, '暂无报错')
    renderList('recent', last.recent, '暂无请求')
  } catch (e) {
    $('sub').textContent = '看板服务连不上：' + e
  } finally {
    $('root').classList.remove('loading')
  }
}
refresh()
setInterval(refresh, 10000)
addEventListener('resize', () => last && renderChart(last))
</script>
</body>
</html>`

createServer((req, res) => {
  if (req.url === '/api/progress') {
    let body
    try {
      body = JSON.stringify(snapshot())
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: String(e) }))
      return
    }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(body)
    return
  }
  if (req.url === '/' || req.url?.startsWith('/?')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(PAGE)
    return
  }
  res.writeHead(404)
  res.end()
}).listen(PORT, '127.0.0.1', () => {
  console.log(`采集进度看板：http://127.0.0.1:${PORT}  （数据目录 ${DATA}）`)
})
