/**
 * 导入上海全部商圈（数据源：汇租选址 huizuxuanzhi.com）
 *
 * 站点把商圈挂在区域页 /loupan/{区域id} 上，以 data-category="shangquan" 的
 * 锚点渲染。本脚本分两阶段：
 *
 *   --crawl    按区抓取商圈清单，落到 data/business-areas.json（限流 2s/次）
 *   --plan     读取 JSON，报告将新建哪些区/商圈，不写库
 *   --execute  实际写库
 *
 * 写入约定（按既定决策）：
 *   - 新建商圈一律 frontendVisible=false，由运营按需放出，避免前台被上百个
 *     无楼盘的空商圈淹没；
 *   - 缺失的行政区（宝山、嘉定、松江等）自动创建，同样 frontendVisible=false；
 *   - slug 用全拼音、小写、无连字符，与 merge-duplicate-districts.ts 统一后的
 *     风格一致（实测 pinyin-pro 产出与手工规范化结果逐条相同）；
 *   - immutableCode 形如 SH-<区拼音>-<商圈拼音>，符合 ^[A-Z0-9][A-Z0-9_-]{1,63}$。
 *
 * 幂等：按「同一父区下的同名商圈」判重，重复执行不会新建。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { pinyin } from 'pinyin-pro'
import { getPayload } from 'payload'
import config from '@/payload.config'

const MODE = process.argv.includes('--crawl')
  ? 'crawl'
  : process.argv.includes('--execute')
    ? 'execute'
    : 'plan'

const DATA_FILE = 'scripts/import-huizuxuanzhi/data/business-areas.json'
const BASE = 'https://www.huizuxuanzhi.com'
const DELAY_MS = 2000
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept-Language': 'zh-CN,zh;q=0.9',
}

/** 站点区域短名 → 本站标准行政区名 */
const DISTRICTS: Array<{ siteId: number; siteName: string; name: string }> = [
  { siteId: 803, siteName: '黄浦', name: '黄浦区' },
  { siteId: 804, siteName: '徐汇', name: '徐汇区' },
  { siteId: 805, siteName: '长宁', name: '长宁区' },
  { siteId: 806, siteName: '静安', name: '静安区' },
  { siteId: 807, siteName: '普陀', name: '普陀区' },
  { siteId: 809, siteName: '虹口', name: '虹口区' },
  { siteId: 810, siteName: '杨浦', name: '杨浦区' },
  { siteId: 811, siteName: '闵行', name: '闵行区' },
  { siteId: 812, siteName: '宝山', name: '宝山区' },
  { siteId: 813, siteName: '嘉定', name: '嘉定区' },
  { siteId: 814, siteName: '浦东', name: '浦东新区' },
  { siteId: 815, siteName: '金山', name: '金山区' },
  { siteId: 816, siteName: '松江', name: '松江区' },
  { siteId: 817, siteName: '青浦', name: '青浦区' },
  { siteId: 818, siteName: '奉贤', name: '奉贤区' },
  { siteId: 819, siteName: '崇明', name: '崇明区' },
]

type Crawled = { district: string; siteId: number; areas: Array<{ name: string; siteId: number }> }

const slugOf = (name: string) =>
  pinyin(name, { toneType: 'none', type: 'array' }).join('').toLowerCase().replace(/[^a-z0-9]/g, '')

const codeOf = (districtSlug: string, areaSlug: string) =>
  `SH-${districtSlug.toUpperCase()}-${areaSlug.toUpperCase()}`.slice(0, 64)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------------------
// 阶段一：抓取
// ---------------------------------------------------------------------------
if (MODE === 'crawl') {
  const out: Crawled[] = []
  for (const d of DISTRICTS) {
    const res = await fetch(`${BASE}/loupan/${d.siteId}`, { headers: HEADERS })
    if (!res.ok) {
      console.error(`❌ ${d.name} HTTP ${res.status}`)
      continue
    }
    const html = await res.text()
    const found = [...html.matchAll(/data-itemid="(\d+)"[^>]*data-category="shangquan"[^>]*>([^<]+)</g)]
    const areas = found
      .map((m) => ({ siteId: Number(m[1]), name: m[2].trim() }))
      .filter((a) => a.siteId > 0 && a.name && a.name !== '全部')
    out.push({ district: d.name, siteId: d.siteId, areas })
    console.log(`${d.name}: ${areas.length} 个商圈`)
    await sleep(DELAY_MS)
  }
  const dir = DATA_FILE.slice(0, DATA_FILE.lastIndexOf('/'))
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(DATA_FILE, JSON.stringify(out, null, 2), 'utf-8')
  console.log(`\n✅ 共 ${out.reduce((n, d) => n + d.areas.length, 0)} 个商圈 → ${DATA_FILE}`)
  process.exit(0)
}

// ---------------------------------------------------------------------------
// 阶段二：导入
// ---------------------------------------------------------------------------
if (!existsSync(DATA_FILE)) {
  console.error(`❌ 缺少 ${DATA_FILE}，请先执行 pnpm business-areas:crawl`)
  process.exit(1)
}
const crawled: Crawled[] = JSON.parse(readFileSync(DATA_FILE, 'utf-8'))
const payload = await getPayload({ config })
const EXECUTE = MODE === 'execute'

const city = await payload.find({ collection: 'locations', where: { type: { equals: 'city' } }, limit: 1, depth: 0 })
if (city.docs.length === 0) {
  console.error('❌ 未找到城市节点')
  process.exit(1)
}
const cityId = city.docs[0].id

const claimedSlugs = new Set<string>()
let newDistricts = 0
let newAreas = 0
let skipped = 0

console.log(`\n===== 导入商圈（${EXECUTE ? '执行' : '预演'}）=====\n`)

for (const d of crawled) {
  // 行政区：按标准名查，缺失则创建（前台不可见，等有内容再放出）
  const existing = await payload.find({
    collection: 'locations',
    where: { type: { equals: 'district' }, name: { equals: d.district }, status: { equals: 'active' } },
    limit: 1,
    depth: 0,
  })
  let districtId: number
  let districtSlug: string
  if (existing.docs.length > 0) {
    districtId = existing.docs[0].id as number
    districtSlug = existing.docs[0].slug as string
  } else {
    districtSlug = slugOf(d.district.replace(/区$/, ''))
    console.log(`＋ 新建行政区「${d.district}」slug=${districtSlug}`)
    newDistricts++
    if (!EXECUTE) {
      districtId = -1
    } else {
      const created = await payload.create({
        collection: 'locations',
        data: {
          name: d.district,
          slug: districtSlug,
          type: 'district',
          immutableCode: `SH-${districtSlug.toUpperCase()}`,
          parent: cityId,
          status: 'active',
          frontendVisible: false,
          sortOrder: 1000,
        },
      })
      districtId = created.id as number
    }
  }

  for (const [i, area] of d.areas.entries()) {
    if (districtId > 0) {
      const dup = await payload.find({
        collection: 'locations',
        where: { type: { equals: 'business_area' }, name: { equals: area.name }, parent: { equals: districtId } },
        limit: 1,
        depth: 0,
      })
      if (dup.docs.length > 0) {
        skipped++
        continue
      }
    }
    // slug 全局唯一。跨区重名确有其事（长宁「虹桥」是虹桥开发区，闵行「虹桥」
    // 是虹桥商务区），撞名时前缀所属区消歧，而不是丢弃其中一个。
    const baseSlug = slugOf(area.name)
    let areaSlug = baseSlug
    const taken = await payload.find({
      collection: 'locations',
      where: { slug: { equals: areaSlug } },
      limit: 1,
      depth: 0,
    })
    if (taken.docs.length > 0 || claimedSlugs.has(areaSlug)) {
      areaSlug = `${districtSlug}-${areaSlug}`
      console.log(`  ⚠ slug 撞名，改用 ${areaSlug}`)
    }
    claimedSlugs.add(areaSlug)
    console.log(`  ＋ ${d.district} / ${area.name}  slug=${areaSlug}`)
    newAreas++
    if (EXECUTE) {
      await payload.create({
        collection: 'locations',
        data: {
          name: area.name,
          slug: areaSlug,
          type: 'business_area',
          immutableCode: codeOf(districtSlug, baseSlug),
          parent: districtId,
          status: 'active',
          frontendVisible: false,
          sortOrder: 1000 + i * 10,
        },
      })
    }
  }
}

console.log(`\n===== 新建行政区 ${newDistricts} 个｜新建商圈 ${newAreas} 个｜已存在跳过 ${skipped} 个 =====`)
if (!EXECUTE) console.log('（预演模式，未写库）')
process.exit(0)
