/**
 * OPT-038 Task 5 证据脚本：**「城市有 featuredRegions」这一状态**的真实路由走查。
 *
 * 为什么需要临时写库：本地库 7 个 city-site-profile 的 `featuredRegions` **全是空数组**
 * （Task 4 §7.5 实测），所以接线后 `/hangzhou` 上商圈段**正确地整段不渲染**。
 * 只看默认状态无法证明「Task 4 的映射在真实路由上真的被读出来了」——
 * 而那正是本任务最容易出「读代码看不出来」的地方。
 *
 * 做法（与 Task 4 的 depth 探针同一套纪律）：
 *   1. 开头 fail-fast 拒绝非 localhost 的 DATABASE_URL；
 *   2. 记录原值 → 临时写入（6 个真实杭州商圈 + 其中两个补「区域介绍」）；
 *   3. 打生产 server 的 `/hangzhou`，**真读 HTTP 状态码**，四断点截图 + 量盒模型；
 *   4. `finally` 里逐条还原（含 frontendVisible 与 description）。
 *
 * 刻意构造三种区位副标形态，让「缺失怎么显示」在真实路由上一眼可读：
 *   - business_area + description  → 「上城区 · ……」两段
 *   - business_area 无 description → 只剩「上城区」
 *   - district（parent 就是城市）  → 两段都没有 ⇒ 整行不渲染（**不是一个「—」**）
 *
 * 运行（cwd = payload-office-platform，生产 server 已在 TASK5_BASE 上跑起来）：
 *   node --env-file-if-exists=.env.local --import tsx \
 *     scripts/verification/opt038-task5-districts-probe.ts
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getPayload } from 'payload'
import config from '@/payload.config'

const requireFromCwd = createRequire(join(process.cwd(), 'package.json'))
const { chromium } = requireFromCwd('@playwright/test') as typeof import('@playwright/test')

/**
 * ⚠️ 本脚本**自己起一台 server**（端口 3921），不复用外面那台。
 * 原因：`findPublicCityProfile` 走 Next 的标签化缓存（`public:city-profile:<slug>`），
 * 而本脚本在 Next 进程之外写库，`revalidateTag` 只会抛
 * 「static generation store missing」——外面那台 server 会一直端着改动前的 profile，
 * 于是「商圈段没渲染」这个观察值根本不是页面的真实行为。
 * 第一次跑就踩到了这条：临时写入成功、页面依旧 0 个商圈格。
 */
const PROBE_PORT = Number(process.env.TASK5_PROBE_PORT ?? 3921)
const BASE = `http://127.0.0.1:${PROBE_PORT}`
const OUT = process.env.TASK5_OUT ?? '../artifacts/verification/OPT-038'
const SHOTS = join(OUT, 'task5-shots')
const CITY_SLUG = 'hangzhou'
const BREAKPOINTS = [375, 768, 1440, 1920]

/** 临时补的「区域介绍」。只给两条，另外几条留空以走查缺失形态。 */
const TEMP_DESCRIPTIONS: Record<string, string> = {
  '钱江新城': '钱塘江北岸的城市新中心，金融与总部办公集聚。',
  '未来科技城': '数字经济与研发办公高地，互联网企业密集。',
}

async function startServer(): Promise<ChildProcess> {
  const child = spawn('npx', ['next', 'start', '-p', String(PROBE_PORT)], {
    env: {
      ...process.env,
      CI: '1',
      NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sbh-286300-10-1253925058.sh.run.tcloudbase.com',
      MULTI_CITY_ROUTING_ENABLED: 'false',
    },
    stdio: 'ignore',
    shell: process.platform === 'win32',
  })
  for (let i = 0; i < 60; i += 1) {
    await new Promise((r) => setTimeout(r, 1000))
    try {
      const res = await fetch(`${BASE}/city-partner`)
      if (res.status === 200) return child
    } catch {
      // still booting
    }
  }
  child.kill()
  throw new Error(`探针 server 在 ${BASE} 上 60s 内没起来`)
}

function assertLocalDatabase() {
  const url = process.env.DATABASE_URL ?? ''
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
    throw new Error(`拒绝运行：本脚本会临时写库，DATABASE_URL 必须指向本地库。当前=${url}`)
  }
}

async function main() {
  assertLocalDatabase()
  mkdirSync(SHOTS, { recursive: true })
  const payload = await getPayload({ config })

  const city = (await payload.find({
    collection: 'locations', depth: 0, limit: 1,
    where: { and: [{ type: { equals: 'city' } }, { slug: { equals: CITY_SLUG } }] },
  })).docs[0]
  if (!city) throw new Error(`本地库没有 ${CITY_SLUG} 城市节点`)

  const profile = (await payload.find({
    collection: 'city-site-profiles', depth: 0, limit: 1,
    where: { city: { equals: city.id } },
  })).docs[0]
  if (!profile) throw new Error(`没有 ${CITY_SLUG} 的 city-site-profile`)

  // 两个 business_area（有上级行政区）+ 一个 district（上级是城市本身）混着取，
  // 这样三种区位副标形态在一屏里都能看到。
  const picked = (await payload.find({
    collection: 'locations', depth: 0, limit: 40, sort: ['type', 'sortOrder', 'id'],
    where: { and: [{ city: { equals: city.id } }, { type: { in: ['district', 'business_area'] } }] },
  })).docs.filter((doc) => ['钱江新城', '未来科技城', '黄龙', '滨江高新区', '上城区', '西湖区'].includes(String((doc as { name?: unknown }).name)))
  if (picked.length < 6) throw new Error(`挑到的候选不足 6 个（${picked.length}）`)

  const originals = picked.map((doc) => {
    const d = doc as unknown as Record<string, unknown>
    return { id: d.id as number, frontendVisible: d.frontendVisible as boolean, description: (d.description ?? null) as string | null, name: String(d.name) }
  })
  // ⚠️ 起始状态守卫：本脚本「还原成观察到的原值」。如果上一轮跑残留了脏值，
  // 这一轮会把脏值当成原值再写回去，一路级联下去谁都看不出来。
  // 所以对预期的干净起点做断言（本地库这几个节点本来就是 fv=false / desc=null）。
  const dirty = originals.filter((o) => o.frontendVisible !== false || o.description !== null)
  if (dirty.length > 0) {
    throw new Error(
      `拒绝运行：候选节点不是干净起点（可能是上一轮没还原干净）：${JSON.stringify(dirty)}。` +
      '请先把它们改回 frontendVisible=false / description=null 再跑。',
    )
  }
  const originalFeatured = ((profile as unknown as Record<string, unknown>).featuredRegions ?? []) as unknown[]

  const report: Record<string, unknown> = { base: BASE, city: city.id, picked: originals.map((o) => o.name), breakpoints: [] }
  let server: ChildProcess | null = null

  try {
    // ── 临时写入 ────────────────────────────────────────────────────────────
    for (const original of originals) {
      await payload.update({
        collection: 'locations', id: original.id,
        data: {
          frontendVisible: true,
          ...(TEMP_DESCRIPTIONS[original.name] ? { description: TEMP_DESCRIPTIONS[original.name] } : {}),
        },
        overrideAccess: true,
      })
    }
    await payload.update({
      collection: 'city-site-profiles', id: profile.id,
      data: { featuredRegions: originals.map((o) => o.id) },
      overrideAccess: true,
    })

    // ── 打真实路由（临时写入之后才起 server，绕开标签化缓存） ────────────────
    server = await startServer()
    const browser = await chromium.launch()
    const page = await browser.newPage()
    try {
      // ⚠️ 先打两次丢弃：`findPublicCityProfile` 走 Next 的标签化缓存，而
      // `unstable_cache` 的条目**落盘在 .next/cache**，换一个 server 进程也还在。
      // 第一次请求会命中上一轮跑剩下的旧条目（featuredRegions 为空），
      // 由 stale-while-revalidate 在后台刷新，从第二次起才是新数据。
      // 第一版脚本没有这两下，于是「375 商圈段 0 格 / 768 起 6 格」——
      // 那不是断点行为（section 渲不渲染是服务端决定的，与视口无关），是缓存的第一拍。
      for (let i = 0; i < 2; i += 1) {
        await page.goto(`${BASE}/${CITY_SLUG}`, { waitUntil: 'networkidle' })
        await new Promise((r) => setTimeout(r, 500))
      }
      for (const width of BREAKPOINTS) {
        await page.setViewportSize({ width, height: 900 })
        // 改视口后必须 reload（工作项 §5.5.2）
        const res = await page.goto(`${BASE}/${CITY_SLUG}`, { waitUntil: 'networkidle' })
        if (res?.status() !== 200) throw new Error(`/${CITY_SLUG} @${width} → HTTP ${res?.status()}（期望 200）`)
        const data = await page.evaluate(() => {
          const de = document.documentElement
          const grid = document.querySelector('.rc-district-grid')
          const cells = Array.from(document.querySelectorAll('.rc-district'))
          return {
            overflowX: de.scrollWidth - de.clientWidth,
            sectionCount: document.querySelectorAll('.rc-section').length,
            gridCols: grid ? getComputedStyle(grid).gridTemplateColumns : null,
            cellCount: cells.length,
            cells: cells.map((cell) => ({
              name: cell.querySelector('.rc-district__name')?.textContent ?? null,
              area: cell.querySelector('.rc-district__area')?.textContent ?? null,
            })),
            hasDash: document.body.innerText.includes('—'),
            heading: document.querySelector('#city-featured-regions')?.textContent ?? null,
            lead: document.querySelector('.rc-districts__lead')?.textContent ?? null,
            h1Count: document.querySelectorAll('h1').length,
            statusRoleCount: document.querySelectorAll('[role="status"]').length,
          }
        })
        ;(report.breakpoints as unknown[]).push({ width, ...data })
        await page.screenshot({ path: join(SHOTS, `hangzhou-districts-${width}.jpg`), fullPage: true, type: 'jpeg', quality: 72 })
      }
    } finally {
      await browser.close()
    }
  } finally {
    if (server) {
      // Windows 下 next start 是孙进程，按端口收拾干净
      spawn('npx', ['kill-port', String(PROBE_PORT)], { stdio: 'ignore', shell: process.platform === 'win32' })
      server.kill()
    }
    // ── 还原（无论上面成败） ────────────────────────────────────────────────
    await payload.update({
      collection: 'city-site-profiles', id: profile.id,
      data: { featuredRegions: originalFeatured as never },
      overrideAccess: true,
    })
    for (const original of originals) {
      await payload.update({
        collection: 'locations', id: original.id,
        data: { frontendVisible: original.frontendVisible, description: original.description },
        overrideAccess: true,
      })
    }
    // 还原后**自查**：只打一句「已还原」而不核对，等于把还原当成了信仰。
    const restored = (await payload.find({
      collection: 'city-site-profiles', depth: 0, limit: 1, where: { city: { equals: city.id } },
    })).docs[0] as unknown as Record<string, unknown>
    const restoredNodes = (await payload.find({
      collection: 'locations', depth: 0, limit: 40,
      where: { id: { in: originals.map((o) => o.id) } },
    })).docs as unknown as Record<string, unknown>[]
    const stillDirty = restoredNodes.filter((d) => d.frontendVisible !== false || (d.description ?? null) !== null)
    console.log('还原后的 featuredRegions：', JSON.stringify(restored.featuredRegions))
    console.log('还原后仍为脏的节点：', JSON.stringify(stillDirty.map((d) => ({ id: d.id, name: d.name, fv: d.frontendVisible, desc: d.description }))))
    if (stillDirty.length > 0 || (Array.isArray(restored.featuredRegions) && restored.featuredRegions.length > 0)) {
      throw new Error('还原失败：本地库被留下了临时写入，请手工清理后再跑')
    }
    writeFileSync(join(OUT, 'task5-districts-probe.json'), JSON.stringify(report, null, 2), 'utf8')
    console.log(`写入 ${join(OUT, 'task5-districts-probe.json')}`)
  }
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
