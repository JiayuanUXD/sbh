/**
 * 合并重复行政区 + 规范化区域 slug（一次性数据订正）
 *
 * 背景：库里的行政区来自两批数据——早期 seed（slug 干净如 xuhui，但没有下级商圈）
 * 与汇租导入（slug 为中文逐字转拼音如 xu-hui-qu，但下级商圈完整）。两批并存导致：
 *   - 首页/搜索的区域下拉同时出现「徐汇」与「徐汇区」，用户选错即漏房源；
 *   - 同一个区的商圈被拆散在多个父节点下（浦东甚至有三份）。
 *
 * 本脚本对每组重复：把「被合并方」的下级区域与楼盘重指向「保留方」，随后停用
 * 被合并方；并统一保留方的名称、slug 与排序值。
 *
 * 不删除节点：location-delete-guard 禁止删除被引用的区域，且停用可逆、可回滚。
 * 被合并方引用清零后，如需彻底删除可在后台手动操作。
 *
 * 用法：
 *   pnpm districts:merge:plan      仅输出变更报告，不写库
 *   pnpm districts:merge:execute   实际执行
 *
 * 幂等：重复执行不会产生额外变更（已指向保留方的记录会被跳过）。
 */
import { getPayload } from 'payload'
import config from '@/payload.config'

const EXECUTE = process.argv.includes('--execute')

/** 保留方：id → 规范化后的名称 / slug / 排序值 */
type KeepSpec = { id: number; name: string; slug: string; sortOrder: number; mergeFrom: number[] }

/**
 * 行政区规范化表。
 *
 * 保留方一律选 slug 干净的那个节点（早期 seed 批）；名称统一为民政部标准写法
 * （「黄浦」→「黄浦区」）。sortOrder 按中心城区优先，10 递增，杜绝并列。
 */
const DISTRICTS: KeepSpec[] = [
  { id: 6, name: '黄浦区', slug: 'huangpu', sortOrder: 10, mergeFrom: [22] },
  { id: 2, name: '静安区', slug: 'jingan', sortOrder: 20, mergeFrom: [24] },
  { id: 7, name: '徐汇区', slug: 'xuhui', sortOrder: 30, mergeFrom: [19] },
  { id: 8, name: '长宁区', slug: 'changning', sortOrder: 40, mergeFrom: [11] },
  { id: 3, name: '浦东新区', slug: 'pudong', sortOrder: 50, mergeFrom: [32, 28] },
  { id: 35, name: '虹口区', slug: 'hongkou', sortOrder: 60, mergeFrom: [] },
  { id: 26, name: '普陀区', slug: 'putuo', sortOrder: 70, mergeFrom: [] },
  { id: 30, name: '杨浦区', slug: 'yangpu', sortOrder: 80, mergeFrom: [] },
  { id: 16, name: '闵行区', slug: 'minhang', sortOrder: 90, mergeFrom: [] },
]

/**
 * 商圈 slug 规范化表：全拼音、小写、无连字符，与行政区同风格。
 * 排序值按知名度给定，同样 10 递增。
 */
const BUSINESS_AREAS: Array<{ id: number; slug: string; sortOrder: number }> = [
  { id: 5, slug: 'lujiazui', sortOrder: 10 },
  { id: 4, slug: 'nanjingxilu', sortOrder: 20 },
  { id: 23, slug: 'huaihaizhonglu', sortOrder: 30 },
  { id: 13, slug: 'hongqiao', sortOrder: 40 },
  { id: 33, slug: 'zhangjiang', sortOrder: 50 },
  { id: 34, slug: 'shibobinjiang', sortOrder: 60 },
  { id: 21, slug: 'caohejing', sortOrder: 70 },
  { id: 36, slug: 'sichuanbeilu', sortOrder: 80 },
  { id: 31, slug: 'wujiaochang', sortOrder: 90 },
  { id: 14, slug: 'zhongshangongyuan', sortOrder: 100 },
  { id: 25, slug: 'tianmuxilu', sortOrder: 110 },
  { id: 29, slug: 'tangqiao', sortOrder: 120 },
  { id: 20, slug: 'shanghainanzhan', sortOrder: 130 },
  { id: 15, slug: 'hongqiaohuochezhan', sortOrder: 140 },
  { id: 12, slug: 'xianxiaxincun', sortOrder: 150 },
  { id: 27, slug: 'zhenru', sortOrder: 160 },
  { id: 17, slug: 'qishenlu', sortOrder: 170 },
  { id: 18, slug: 'shenzhuanggongyequ', sortOrder: 180 },
]

const payload = await getPayload({ config })
const changes: string[] = []
const note = (s: string) => {
  changes.push(s)
  console.log(s)
}

async function repointChildren(fromId: number, toId: number) {
  const kids = await payload.find({
    collection: 'locations',
    where: { parent: { equals: fromId } },
    limit: 200,
    depth: 0,
  })
  for (const kid of kids.docs) {
    note(`  下级区域「${kid.name}」(${kid.id}) 父节点 ${fromId} → ${toId}`)
    if (EXECUTE) {
      await payload.update({ collection: 'locations', id: kid.id, data: { parent: toId } })
    }
  }
}

async function repointBuildings(fromId: number, toId: number) {
  const blds = await payload.find({
    collection: 'buildings',
    where: { district: { equals: fromId } },
    limit: 500,
    depth: 0,
  })
  for (const b of blds.docs) {
    note(`  楼盘「${b.name}」(${b.id}) 行政区 ${fromId} → ${toId}`)
    if (EXECUTE) {
      await payload.update({ collection: 'buildings', id: b.id, data: { district: toId } })
    }
  }
}

console.log(`\n===== 行政区合并与 slug 规范化（${EXECUTE ? '执行' : '预演'}）=====\n`)

for (const d of DISTRICTS) {
  const keep = await payload.findByID({ collection: 'locations', id: d.id, depth: 0 }).catch(() => null)
  if (!keep) {
    console.error(`❌ 保留方 ${d.id} 不存在，中止`)
    process.exit(1)
  }
  console.log(`【${d.name}】保留 id=${d.id}`)

  for (const fromId of d.mergeFrom) {
    const dup = await payload.findByID({ collection: 'locations', id: fromId, depth: 0 }).catch(() => null)
    if (!dup) {
      console.log(`  (${fromId} 已不存在，跳过)`)
      continue
    }
    console.log(`  合并 ← 「${dup.name}」(${fromId}, ${dup.slug})`)
    await repointChildren(fromId, d.id)
    await repointBuildings(fromId, d.id)
    if (dup.status === 'active') {
      note(`  停用「${dup.name}」(${fromId})`)
      if (EXECUTE) {
        // location-protect 会在 status 非 active 时强制 frontendVisible=false
        await payload.update({
          collection: 'locations',
          id: fromId,
          data: { status: 'disabled', frontendVisible: false },
        })
      }
    }
  }

  const needsUpdate =
    keep.name !== d.name || keep.slug !== d.slug || keep.sortOrder !== d.sortOrder ||
    keep.frontendVisible !== true
  if (needsUpdate) {
    note(`  规范化：名称「${keep.name}」→「${d.name}」 slug ${keep.slug} → ${d.slug} 排序 ${keep.sortOrder} → ${d.sortOrder}`)
    if (EXECUTE) {
      await payload.update({
        collection: 'locations',
        id: d.id,
        data: { name: d.name, slug: d.slug, sortOrder: d.sortOrder, frontendVisible: true },
      })
    }
  }
  console.log('')
}

console.log('===== 商圈 slug 规范化 =====\n')
for (const ba of BUSINESS_AREAS) {
  const doc = await payload.findByID({ collection: 'locations', id: ba.id, depth: 0 }).catch(() => null)
  if (!doc) {
    console.log(`  (商圈 ${ba.id} 不存在，跳过)`)
    continue
  }
  if (doc.slug !== ba.slug || doc.sortOrder !== ba.sortOrder) {
    note(`  「${doc.name}」 slug ${doc.slug} → ${ba.slug}  排序 ${doc.sortOrder} → ${ba.sortOrder}`)
    if (EXECUTE) {
      await payload.update({
        collection: 'locations',
        id: ba.id,
        data: { slug: ba.slug, sortOrder: ba.sortOrder },
      })
    }
  }
}

console.log(`\n===== 合计 ${changes.length} 项变更 =====`)
if (!EXECUTE) console.log('（预演模式，未写库；确认无误后加 --execute）')
process.exit(0)
