/**
 * 合并重复区域节点 + 规范化 slug（一次性数据订正，环境无关）
 *
 * 背景：区域数据来自两批——早期 seed（slug 干净如 xuhui）与汇租导入（slug 为
 * 中文逐字转拼音如 xu-hui-qu）。两批并存导致：
 *   - 区域下拉同时出现「徐汇」与「徐汇区」，用户选错即漏房源；
 *   - 同一个区的商圈被拆散在多个父节点下（浦东有三份，生产连城市都有两份）。
 *
 * 关键：**不能按 id 定位节点**。本地与生产的自增 id 完全不同（本地长宁区是
 * 8/11，生产是 7），硬编码 id 会把无关节点当成合并目标。故一律按 slug 解析：
 * 两个环境的 slug 命名同源，是稳定的跨环境标识。
 *
 * 每组保留「规范 slug」的节点；若该节点不存在（生产上部分区只有导入批一份），
 * 则保留组内首个节点并把它的 slug 改成规范值。随后把其余节点的下级区域与楼盘
 * 重指向保留方，再停用它们。
 *
 * 不删除节点：location-delete-guard 禁止删除被引用区域，停用可逆、可回滚。
 *
 * 用法：
 *   pnpm districts:merge:plan      仅输出变更报告，不写库
 *   pnpm districts:merge:execute   实际执行
 *
 * 幂等：重复执行不产生额外变更。
 */
import { pinyin } from 'pinyin-pro'
import { getPayload } from 'payload'
import config from '@/payload.config'
import type { Location } from '@/payload-types'

const EXECUTE = process.argv.includes('--execute')

/** 规范组：canonical 为目标 slug，aliases 是应并入它的历史 slug */
type CanonicalGroup = { canonical: string; name: string; aliases: string[]; sortOrder: number }

const CITIES: CanonicalGroup[] = [
  { canonical: 'shanghai', name: '上海', aliases: ['shang-hai'], sortOrder: 10 },
]

/**
 * 行政区规范表。名称统一为民政部标准写法，sortOrder 按中心城区优先 10 递增
 * 以杜绝并列（此前大量并列 100，谁排第一不确定）。
 */
const DISTRICTS: CanonicalGroup[] = [
  { canonical: 'huangpu', name: '黄浦区', aliases: ['huang-pu-qu'], sortOrder: 10 },
  { canonical: 'jingan', name: '静安区', aliases: ['jing-an-qu'], sortOrder: 20 },
  { canonical: 'xuhui', name: '徐汇区', aliases: ['xu-hui-qu'], sortOrder: 30 },
  { canonical: 'changning', name: '长宁区', aliases: ['chang-ning-qu'], sortOrder: 40 },
  { canonical: 'pudong', name: '浦东新区', aliases: ['pu-dong-xin-qu', 'pu-dong-qu'], sortOrder: 50 },
  { canonical: 'hongkou', name: '虹口区', aliases: ['hong-kou-qu'], sortOrder: 60 },
  { canonical: 'putuo', name: '普陀区', aliases: ['pu-tuo-qu'], sortOrder: 70 },
  { canonical: 'yangpu', name: '杨浦区', aliases: ['yang-pu-qu'], sortOrder: 80 },
  { canonical: 'minhang', name: '闵行区', aliases: ['min-xing-qu'], sortOrder: 90 },
]

/** 商圈排序：按知名度给定；未列出的排在其后，保持原有相对顺序 */
const AREA_ORDER = [
  '陆家嘴', '南京西路', '淮海中路', '虹桥', '张江', '世博滨江', '漕河泾',
  '四川北路', '五角场', '中山公园', '天目西路', '塘桥', '上海南站',
  '虹桥火车站', '仙霞新村', '真如', '七莘路', '莘庄工业区',
]

const slugOf = (name: string) =>
  pinyin(name, { toneType: 'none', type: 'array' }).join('').toLowerCase().replace(/[^a-z0-9]/g, '')

const payload = await getPayload({ config })
let changes = 0
const note = (s: string) => {
  changes++
  console.log(s)
}

async function bySlug(slug: string): Promise<Location | null> {
  const r = await payload.find({ collection: 'locations', where: { slug: { equals: slug } }, limit: 1, depth: 0 })
  return (r.docs[0] as Location) ?? null
}

async function repoint(fromId: number, toId: number) {
  const kids = await payload.find({
    collection: 'locations', where: { parent: { equals: fromId } }, limit: 300, depth: 0,
  })
  for (const kid of kids.docs) {
    note(`    下级「${kid.name}」(${kid.id}) 父节点 → ${toId}`)
    if (EXECUTE) await payload.update({ collection: 'locations', id: kid.id, data: { parent: toId } })
  }
  for (const field of ['district', 'businessDistrict', 'city'] as const) {
    const blds = await payload.find({
      collection: 'buildings', where: { [field]: { equals: fromId } }, limit: 500, depth: 0,
    })
    for (const b of blds.docs) {
      note(`    楼盘「${b.name}」(${b.id}) ${field} → ${toId}`)
      if (EXECUTE) await payload.update({ collection: 'buildings', id: b.id, data: { [field]: toId } })
    }
  }
}

async function processGroups(groups: CanonicalGroup[], label: string) {
  console.log(`\n===== ${label} =====\n`)
  for (const g of groups) {
    // 组内所有实际存在的节点：规范 slug 优先作为保留方
    const canonicalDoc = await bySlug(g.canonical)
    const aliasDocs: Location[] = []
    for (const a of g.aliases) {
      const d = await bySlug(a)
      if (d) aliasDocs.push(d)
    }
    if (!canonicalDoc && aliasDocs.length === 0) {
      console.log(`【${g.name}】本环境不存在，跳过`)
      continue
    }
    // 规范 slug 不存在时（生产上部分区只有导入批一份），保留别名中的第一个并改名
    const keep = canonicalDoc ?? aliasDocs.shift()!
    console.log(`【${g.name}】保留 id=${keep.id}（当前 slug=${keep.slug}）`)

    for (const dup of aliasDocs) {
      if (dup.id === keep.id) continue
      console.log(`  合并 ← 「${dup.name}」(${dup.id}, ${dup.slug})`)
      await repoint(dup.id as number, keep.id as number)
      if (dup.status === 'active') {
        note(`    停用「${dup.name}」(${dup.id})`)
        if (EXECUTE) {
          // location-protect 会在 status 非 active 时强制 frontendVisible=false
          await payload.update({
            collection: 'locations', id: dup.id,
            data: { status: 'disabled', frontendVisible: false },
          })
        }
      }
    }

    if (keep.slug !== g.canonical || keep.name !== g.name || keep.sortOrder !== g.sortOrder || !keep.frontendVisible) {
      note(`    规范化：「${keep.name}」→「${g.name}」 slug ${keep.slug} → ${g.canonical} 排序 ${keep.sortOrder} → ${g.sortOrder}`)
      if (EXECUTE) {
        await payload.update({
          collection: 'locations', id: keep.id,
          data: { name: g.name, slug: g.canonical, sortOrder: g.sortOrder, frontendVisible: true },
        })
      }
    }
  }
}

console.log(`\n########## 区域订正（${EXECUTE ? '执行' : '预演'}）##########`)

await processGroups(CITIES, '城市')
await processGroups(DISTRICTS, '行政区')

// 商圈：slug 按拼音规范化（与行政区同风格），排序按知名度
console.log('\n===== 商圈 slug 与排序 =====\n')
const areas = await payload.find({
  collection: 'locations', where: { type: { equals: 'business_area' } }, limit: 300, depth: 0,
  sort: 'id',
})
// 知名度表按名字查，而跨区重名确有其事（长宁「虹桥」是虹桥开发区，闵行「虹桥」
// 是虹桥商务区）。同名只让首个取到该档位，其余保持原值，避免重新制造并列。
const rankedNames = new Set<string>()
for (const area of areas.docs as Location[]) {
  const desired = slugOf(area.name)
  const rank = rankedNames.has(area.name) ? -1 : AREA_ORDER.indexOf(area.name)
  if (rank >= 0) rankedNames.add(area.name)
  // 未列入知名度表的保持原有排序值——导入脚本已按区内顺序给过 1000/1010/1020…，
  // 压平成同一个值反而会重新制造并列。
  const sortOrder = rank >= 0 ? (rank + 1) * 10 : (area.sortOrder ?? 1000)
  // slug 全局唯一：目标 slug 被别的节点占用时保持原样，交由导入脚本的消歧规则处理
  const taken = desired !== area.slug ? await bySlug(desired) : null
  const nextSlug = taken ? area.slug : desired
  if (nextSlug !== area.slug || area.sortOrder !== sortOrder) {
    note(`  「${area.name}」 slug ${area.slug} → ${nextSlug}  排序 ${area.sortOrder} → ${sortOrder}${taken ? '（slug 已被占用，保持原值）' : ''}`)
    if (EXECUTE) {
      await payload.update({ collection: 'locations', id: area.id, data: { slug: nextSlug, sortOrder } })
    }
  }
}

console.log(`\n########## 合计 ${changes} 项变更 ##########`)
if (!EXECUTE) console.log('（预演模式，未写库；确认无误后加 --execute）')
process.exit(0)
