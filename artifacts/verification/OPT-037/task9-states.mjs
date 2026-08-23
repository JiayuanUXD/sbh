/**
 * OPT-037 Task 9 —— 状态走查（无图房源 / 概况字段齐全 / 超长标题）验证脚本。
 *
 * 为什么单独一支脚本：这三个状态在隔离库 `sbh_dev_opt035` 的种子数据里**不存在**
 * （11 条种子房源全部带 3 张 gallery、标题最长 21 字、spaceDetails/costTerms 几乎
 * 全空）。用真实数据走查不到的状态，只能临时造：本脚本先把要改的列快照下来，
 * 改完截图，最后**无条件还原**（finally 里执行，脚本中途报错也会还原）。
 *
 * 为什么脚本自己拉起 / 杀掉 dev server：`getCachedListingBySlug` 走
 * `unstable_cache`（revalidate 300，见 src/lib/frontend/cached-queries.ts），
 * 直接改库后前台在 5 分钟内看不到变化——**实测确认过**：改标题后 1.5s 请求页面，
 * 旧标题原样返回。缓存是进程内的，重启 server 才会清掉。别删掉这段重启逻辑
 * 换成 sleep，那只是把 5 分钟的等待藏起来。
 *
 * 跑法（先确保没有别的 next dev 占着同一个工作目录——Next 16 一个目录只允许一个）：
 *   node artifacts/verification/OPT-037/task9-states.mjs
 *
 * 输出：artifacts/verification/OPT-037/task9-states.json + 同目录 task9-state-*.png。
 */
import { chromium } from 'file:///E:/github/sbh/payload-office-platform/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs'
// pg 是 CommonJS，只能默认导入后解构（具名导入会 SyntaxError）。
import pg from 'file:///E:/github/sbh/payload-office-platform/node_modules/.pnpm/pg@8.20.0/node_modules/pg/lib/index.js'
import { spawn } from 'node:child_process'
import fs from 'node:fs'

const APP = 'E:/github/sbh/payload-office-platform'
const OUT = 'E:/github/sbh/artifacts/verification/OPT-037'
const PORT = Number(process.env.VERIFY_PORT ?? 3731)
const ORIGIN = `http://localhost:${PORT}`
const SLUG = 'jingan-serviced-office-42-seats'
const VIEWPORTS = [
  [375, 812],
  [768, 1024],
  [1440, 900],
  [1920, 1080],
]

// 隔离库：凭据取自 .env.local 但**只替换库名**，不打印、不写进产物。
// .env.local 默认库是 `postgres`（本机上它并不是空库，见 task-9-report.md），
// 隔离库固定 sbh_dev_opt035。
const envLocal = fs.readFileSync(`${APP}/.env.local`, 'utf8')
const dbUrl = new URL(envLocal.match(/DATABASE_URL=(\S+)/)[1])
dbUrl.pathname = '/sbh_dev_opt035'
const DATABASE_URL = dbUrl.toString()

const { Client } = pg

const sql = async (fn) => {
  const client = new Client({ connectionString: DATABASE_URL })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

/** 需要快照/还原的列，按表分组。 */
const LISTING_COLUMNS = [
  'title',
  'cover_image_id',
  'decoration_status',
  'minimum_lease_months',
  'payment_terms',
  'registration_status',
  'space_details_efficiency_rate',
  'space_details_net_ceiling_height',
  'cost_terms_deposit_months',
  'cost_terms_property_fee_inclusion',
  'cost_terms_property_fee_amount',
  'cost_terms_invoice_status',
  'verification_info_verified_at',
  'verification_info_price_verified_at',
]
const BUILDING_COLUMNS = [
  'building_services_air_conditioning',
  'building_services_network',
  'building_services_parking_fee',
]

async function snapshot() {
  return sql(async (c) => {
    const listing = (
      await c.query(
        `select id, ${LISTING_COLUMNS.join(', ')} from listings where slug = $1`,
        [SLUG],
      )
    ).rows[0]
    const building = (
      await c.query(
        `select b.id, ${BUILDING_COLUMNS.map((x) => `b.${x}`).join(', ')}
           from buildings b join listings l on l.building_id = b.id where l.slug = $1`,
        [SLUG],
      )
    ).rows[0]
    const gallery = (
      await c.query(
        `select * from listings_gallery where _parent_id = $1 order by _order`,
        [listing.id],
      )
    ).rows
    const mediaItems = (
      await c.query(
        `select * from listings_media_items where _parent_id = $1 order by _order`,
        [listing.id],
      )
    ).rows
    return { listing, building, gallery, mediaItems }
  })
}

async function restore(snap) {
  await sql(async (c) => {
    await c.query(
      `update listings set ${LISTING_COLUMNS.map((col, i) => `${col} = $${i + 2}`).join(', ')}
         where id = $1`,
      [snap.listing.id, ...LISTING_COLUMNS.map((col) => snap.listing[col])],
    )
    await c.query(
      `update buildings set ${BUILDING_COLUMNS.map((col, i) => `${col} = $${i + 2}`).join(', ')}
         where id = $1`,
      [snap.building.id, ...BUILDING_COLUMNS.map((col) => snap.building[col])],
    )
    for (const table of ['listings_gallery', 'listings_media_items']) {
      const rows = table === 'listings_gallery' ? snap.gallery : snap.mediaItems
      const existing = (await c.query(`select count(*)::int n from ${table} where _parent_id = $1`, [
        snap.listing.id,
      ])).rows[0].n
      if (existing > 0 || rows.length === 0) continue
      const cols = Object.keys(rows[0])
      for (const row of rows) {
        await c.query(
          `insert into ${table} (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
          cols.map((col) => row[col]),
        )
      }
    }
  })
}

/** 状态定义：每个状态给一段 SQL，跑完重启 server 再截图。 */
const STATES = {
  // 概况面板字段齐全 + 核验行有值：证明「行渲染的是值」而不是清一色 —，
  // 也是决策卡核验区从「整块不渲染」翻到「渲染两行」的另一半。
  'overview-full': async (c, snap) => {
    await c.query(
      `update listings set
         decoration_status = 'fully_fitted', minimum_lease_months = 24,
         payment_terms = '押二付三', registration_status = 'available',
         space_details_efficiency_rate = 72, space_details_net_ceiling_height = 2.9,
         cost_terms_deposit_months = 2, cost_terms_property_fee_inclusion = 'excluded',
         cost_terms_property_fee_amount = 28, cost_terms_invoice_status = 'included',
         verification_info_verified_at = '2026-08-11T00:00:00.000Z',
         verification_info_price_verified_at = '2026-08-15T00:00:00.000Z'
       where id = $1`,
      [snap.listing.id],
    )
    await c.query(
      `update buildings set
         building_services_air_conditioning = 'VRV 多联机 · 可加时',
         building_services_network = '电信 / 联通 / 移动 双线接入',
         building_services_parking_fee = '1200 元/月/位'
       where id = $1`,
      [snap.building.id],
    )
  },
  // 无图：mediaItems 与 gallery 同时清空，DetailGallery 才会交给 NoImageHeroGrid
  // （组件里是 `mediaItems.length > 0 ? mediaItems : gallery` 的两级兜底）。
  nomedia: async (c, snap) => {
    await c.query('delete from listings_media_items where _parent_id = $1', [snap.listing.id])
    await c.query('delete from listings_gallery where _parent_id = $1', [snap.listing.id])
    // coverImage 也要清：`mapListingDetail` 的 gallery 是 **coverImage + gallery 行**
    // 去重合并（mappers.ts:840），只删两张表时封面还在，画廊照样有一张图，
    // NoImageHeroGrid 永远轮不上——第一版就是这么"验过"的。
    await c.query('update listings set cover_image_id = null where id = $1', [snap.listing.id])
  },
  // 超长标题：种子最长 21 字，撑不到标题栏换行与吸附条 ellipsis 的边界。
  longtitle: async (c, snap) => {
    await c.query('update listings set title = $2 where id = $1', [
      snap.listing.id,
      '静安南京西路核心商圈 · 嘉里中心南楼 12 层整层精装带家具服务式办公室 · 可注册可分割 · 近 2/12/13 号线南京西路站',
    ])
  },
}

function startServer() {
  // 光重启进程不够：`unstable_cache` 的条目在 dev 下**落盘**，跨进程存活。
  // 落点是 `.next/dev/cache/fetch-cache`（Next 16 dev），**不是** `.next/cache`
  // ——第二版脚本删错了目录，三个状态截出来的仍是同一份基线数据
  // （overviewValues 一字不差），差点当成"状态渲染正确"。判据不是"我清了缓存"，
  // 而是「同一进程里 REST `/api/listings` 返回新值、页面返回旧值」——那一刻才
  // 定位到落点。只删 fetch-cache 子目录：同级的 turbopack 目录是编译缓存
  // （2GB+），一起删会让每个状态多花几分钟重新编译。
  fs.rmSync(`${APP}/.next/dev/cache/fetch-cache`, { recursive: true, force: true })
  fs.rmSync(`${APP}/.next/cache`, { recursive: true, force: true })
  const child = spawn(
    'pnpm',
    ['exec', 'next', 'dev', '-p', String(PORT)],
    {
      cwd: APP,
      env: { ...process.env, DATABASE_URL, MULTI_CITY_ROUTING_ENABLED: '' },
      shell: true,
      stdio: 'ignore',
    },
  )
  return child
}

async function waitForServer() {
  for (let i = 0; i < 90; i += 1) {
    try {
      const res = await fetch(`${ORIGIN}/listings/${SLUG}`)
      if (res.status === 200) return
    } catch {
      /* 还没起来 */
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
  throw new Error('dev server 未在 180s 内就绪')
}

async function stopServer(child) {
  // Windows 下 pnpm → next 是子进程树，kill 父进程不够，用 taskkill /T。
  await new Promise((resolve) => {
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { shell: true }).on('close', resolve)
  })
  await new Promise((r) => setTimeout(r, 1500))
}

const report = {}
const snap = await snapshot()
fs.mkdirSync(OUT, { recursive: true })

try {
  for (const [state, mutate] of Object.entries(STATES)) {
    await sql((c) => mutate(c, snap))
    const child = startServer()
    try {
      await waitForServer()
      const browser = await chromium.launch()
      report[state] = {}
      for (const [w, h] of VIEWPORTS) {
        const page = await browser.newPage({ viewport: { width: w, height: h } })
        await page.goto(`${ORIGIN}/listings/${SLUG}`, { waitUntil: 'networkidle' })
        report[state][w] = await page.evaluate(() => ({
          overflow: {
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
          },
          title: document.querySelector('.dt-titlebar__title')?.textContent ?? null,
          titleRect: (() => {
            const el = document.querySelector('.dt-titlebar__title')
            if (!el) return null
            const r = el.getBoundingClientRect()
            return { w: Math.round(r.width), h: Math.round(r.height) }
          })(),
          galleryPresent: !!document.querySelector('.detail-gallery'),
          noMediaGrid: !!document.querySelector('.dt-nomedia'),
          noMediaSpecs: Array.from(document.querySelectorAll('.dt-keyspecs__item')).map((el) =>
            el.textContent.replace(/\s+/g, ' ').trim(),
          ),
          overviewValues: Array.from(document.querySelectorAll('.dt-overview .dt-spec__row')).map(
            (el) => el.textContent.replace(/\s+/g, ' ').trim(),
          ),
          verifyRows: Array.from(document.querySelectorAll('.dt-decision__verify-row')).map((el) =>
            el.textContent.replace(/\s+/g, ' ').trim(),
          ),
          decisionSummary: document.querySelector('.dt-decision__summary')?.textContent ?? null,
        }))
        await page.screenshot({ path: `${OUT}/task9-state-${state}-${w}.png`, fullPage: true })
        // 超长标题还要看吸附条里的 ellipsis：滚到页尾让它挂载。
        if (state === 'longtitle' && w >= 1024) {
          await page.evaluate(() =>
            window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }),
          )
          await page.waitForTimeout(400)
          report[state][w].stickyBarTitle = await page.evaluate(() => {
            const el = document.querySelector('.dt-sticky-bar__title')
            if (!el) return null
            const r = el.getBoundingClientRect()
            return { w: Math.round(r.width), clipped: el.scrollWidth > el.clientWidth }
          })
          await page.screenshot({ path: `${OUT}/task9-state-${state}-sticky-${w}.png` })
        }
        await page.close()
      }
      await browser.close()
    } finally {
      await stopServer(child)
    }
    await restore(snap)
  }
} finally {
  // 无条件还原：上面每个状态跑完已经还原一次，这里兜住"中途抛错"的路径。
  await restore(snap)
  fs.writeFileSync(`${OUT}/task9-states.json`, JSON.stringify(report, null, 2))
}

console.log(JSON.stringify(report, null, 2))
