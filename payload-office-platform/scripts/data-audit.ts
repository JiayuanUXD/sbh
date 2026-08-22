/**
 * M8.4 数据迁移双读报告（tasks.md M8.4 / R2, R3, R4, R6）
 *
 * 职责：
 *   - 统计核心业务表行数与状态分布（房源 / 楼盘 / 商户 / 线索 / 客户）
 *   - 双读验证：有效供给谓词过滤 vs 直接 SQL 计数的一致性
 *   - 完整性检查：必填字段、外键引用、关系有效期
 *   - 生成人工处理清单：无法自动判定的数据项
 *
 * 用法：
 *   pnpm script:data-audit
 *
 * 输出：
 *   - 控制台打印报告摘要
 *   - JSON 格式完整报告（stdout 或写入文件）
 *   - 人工处理清单（含原因 + 建议操作）
 *
 * 只读：本脚本不修改任何业务数据。
 */

import { getPayload } from 'payload'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import config from '@/payload.config'

import {
  getEffectiveSupplyWhere,
} from '@/domain/review/effective-supply'

interface AuditSummary {
  timestamp: string
  environment: string
  collections: Record<string, {
    total: number
    statusBreakdown?: Record<string, number>
  }>
  consistencyChecks: Array<{
    name: string
    status: 'pass' | 'fail' | 'warn'
    message: string
    details?: unknown
  }>
  manualReviewList: Array<{
    collection: string
    id: string | number
    reason: string
    suggestion: string
  }>
}

/**
 * 运行数据审计并生成报告。
 *
 * @param asOf 计算有效供给的参考时间（默认当前时间）
 */
export async function runDataAudit(asOf: Date = new Date()): Promise<AuditSummary> {
  const payload = await getPayload({ config })
  const summary: AuditSummary = {
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV ?? 'development',
    collections: {},
    consistencyChecks: [],
    manualReviewList: [],
  }

  try {
    // 1. 行数统计
    await collectRowCounts(payload, summary)

    // 2. 房源完整性检查
    await checkListingIntegrity(payload, summary)

    // 3. 楼盘完整性检查
    await checkBuildingIntegrity(payload, summary)

    // 4. 商户与关系检查
    await checkMerchantRelations(payload, summary, asOf)

    // 5. 线索/客户完整性检查
    await checkLeadIntegrity(payload, summary)

    // 6. 双读验证：有效供给谓词一致性
    await checkEffectiveSupplyConsistency(payload, summary, asOf)
  } finally {
    // Payload 3.x 不需要显式 disconnect，由框架管理
  }

  return summary
}

async function collectRowCounts(
  payload: Awaited<ReturnType<typeof getPayload>>,
  summary: AuditSummary,
): Promise<void> {
  const collections = ['listings', 'buildings', 'merchants', 'leads', 'customers', 'users', 'locations']
  for (const slug of collections) {
    try {
      const result = await payload.count({
        collection: slug as never,
        overrideAccess: true,
      })
      summary.collections[slug] = { total: result.totalDocs ?? 0 }
    } catch {
      summary.collections[slug] = { total: 0 }
      summary.consistencyChecks.push({
        name: `row-count.${slug}`,
        status: 'warn',
        message: `无法查询 ${slug} 行数`,
      })
    }
  }
}

async function checkListingIntegrity(
  payload: Awaited<ReturnType<typeof getPayload>>,
  summary: AuditSummary,
): Promise<void> {
  try {
    const result = await payload.find({
      collection: 'listings' as never,
      limit: 100,
      depth: 0,
      overrideAccess: true,
    })
    const docs = result.docs as Array<Record<string, unknown>>

    // 状态分布
    const statusBreakdown: Record<string, number> = {}
    for (const doc of docs) {
      const rs = String(doc.reviewStatus ?? 'not_submitted')
      const ps = String(doc.publicationStatus ?? 'draft')
      const key = `review:${rs}|pub:${ps}`
      statusBreakdown[key] = (statusBreakdown[key] ?? 0) + 1

      // 完整性检查：已发布房源必须有楼盘关联
      if (ps === 'published' && !doc.building) {
        summary.manualReviewList.push({
          collection: 'listings',
          id: String(doc.id ?? ''),
          reason: '已发布房源无楼盘关联',
          suggestion: '补充楼盘信息或下架',
        })
      }

      // 完整性检查：已审核通过但无商户关系
      if (rs === 'approved' && !doc.merchant) {
        summary.manualReviewList.push({
          collection: 'listings',
          id: String(doc.id ?? ''),
          reason: '审核通过房源无商户关联',
          suggestion: '补建商户关系或重新审核',
        })
      }
    }

    if (summary.collections.listings) {
      summary.collections.listings.statusBreakdown = statusBreakdown
    }
    summary.consistencyChecks.push({
      name: 'listing.integrity',
      status: 'pass',
      message: `检查了 ${docs.length} 条房源，${summary.manualReviewList.filter(i => i.collection === 'listings').length} 条需人工处理`,
    })
  } catch (err) {
    summary.consistencyChecks.push({
      name: 'listing.integrity',
      status: 'fail',
      message: `房源完整性检查失败: ${err instanceof Error ? err.message : String(err)}`,
    })
  }
}

async function checkBuildingIntegrity(
  payload: Awaited<ReturnType<typeof getPayload>>,
  summary: AuditSummary,
): Promise<void> {
  try {
    const result = await payload.find({
      collection: 'buildings' as never,
      limit: 100,
      depth: 0,
      overrideAccess: true,
    })
    const docs = result.docs as Array<Record<string, unknown>>

    for (const doc of docs) {
      // 在售楼盘无城市
      if (doc.status === 'active' && !doc.city) {
        summary.manualReviewList.push({
          collection: 'buildings',
          id: String(doc.id ?? ''),
          reason: '在售楼盘无城市关联',
          suggestion: '补充城市或区域信息',
        })
      }
    }

    summary.consistencyChecks.push({
      name: 'building.integrity',
      status: 'pass',
      message: `检查了 ${docs.length} 条楼盘，${summary.manualReviewList.filter(i => i.collection === 'buildings').length} 条需人工处理`,
    })
  } catch (err) {
    summary.consistencyChecks.push({
      name: 'building.integrity',
      status: 'fail',
      message: `楼盘完整性检查失败: ${err instanceof Error ? err.message : String(err)}`,
    })
  }
}

/**
 * 商户与关系检查（OPT-034 Task 7 更新）。
 *
 * `listing_merchant_relations` 表已在 OPT-034 删除，房源商户归属改为
 * `listings.merchant` 直写字段，不再有独立关系记录，也就不再有「关系过期」
 * 这个概念（字段本身无 effectiveTo）。原「过期关系」人工处理项改为语义等价的
 * 「房源引用的商户当前不合格」检查——直接核对被引用商户的 status /
 * qualificationStatus / qualificationExpiresAt，覆盖同一类运营风险
 * （挂牌商户后来被停用或资质过期，但房源仍挂着旧商户）。
 * `building-merchant-relations` 表未受本次改造影响，照常查询。
 */
async function checkMerchantRelations(
  payload: Awaited<ReturnType<typeof getPayload>>,
  summary: AuditSummary,
  asOf: Date,
): Promise<void> {
  try {
    const buildingRels = await payload.count({
      collection: 'building-merchant-relations' as never,
      overrideAccess: true,
    })
    const merchants = await payload.count({
      collection: 'merchants' as never,
      overrideAccess: true,
    })
    const listingsWithMerchant = await payload.count({
      collection: 'listings' as never,
      where: { merchant: { exists: true } } as never,
      overrideAccess: true,
    })
    const listingsWithoutMerchant = await payload.count({
      collection: 'listings' as never,
      where: { merchant: { exists: false } } as never,
      overrideAccess: true,
    })

    summary.collections['building-merchant-relations'] = { total: buildingRels.totalDocs ?? 0 }
    summary.collections.merchants = { total: merchants.totalDocs ?? 0 }

    summary.consistencyChecks.push({
      name: 'merchant.relations',
      status: 'pass',
      message:
        `商户 ${merchants.totalDocs} 家，楼盘关系 ${buildingRels.totalDocs} 条；` +
        `房源已绑定商户 ${listingsWithMerchant.totalDocs} 条，未绑定 ${listingsWithoutMerchant.totalDocs} 条` +
        `（OPT-034 起 listings.merchant 直写字段，无独立关系表）`,
    })

    // 检查：房源引用的商户当前已停用或资质过期
    const nowMs = asOf.getTime()
    const listingsResult = await payload.find({
      collection: 'listings' as never,
      where: { merchant: { exists: true } } as never,
      limit: 100,
      depth: 1,
      overrideAccess: true,
    })

    for (const doc of listingsResult.docs as Array<Record<string, unknown>>) {
      const merchant = doc.merchant
      if (typeof merchant !== 'object' || merchant === null) continue // 未展开（depth 异常）跳过，不误报
      const m = merchant as Record<string, unknown>
      const status = String(m.status ?? '')
      const qualificationStatus = String(m.qualificationStatus ?? '')
      const qualificationExpiresAt = m.qualificationExpiresAt
      const expired =
        typeof qualificationExpiresAt === 'string' &&
        new Date(qualificationExpiresAt).getTime() < nowMs
      if (status !== 'active' || qualificationStatus !== 'valid' || expired) {
        summary.manualReviewList.push({
          collection: 'listings',
          id: String(doc.id ?? ''),
          reason: `房源引用的商户不合格（status=${status || '未知'}, qualification=${qualificationStatus || '未知'}${expired ? ', 资质已过期' : ''}）`,
          suggestion: '确认商户资质或为房源更换供给商户',
        })
      }
    }
  } catch (err) {
    summary.consistencyChecks.push({
      name: 'merchant.relations',
      status: 'fail',
      message: `商户关系检查失败: ${err instanceof Error ? err.message : String(err)}`,
    })
  }
}

async function checkLeadIntegrity(
  payload: Awaited<ReturnType<typeof getPayload>>,
  summary: AuditSummary,
): Promise<void> {
  try {
    const result = await payload.find({
      collection: 'leads' as never,
      limit: 100,
      depth: 0,
      overrideAccess: true,
    })
    const docs = result.docs as Array<Record<string, unknown>>

    const stageBreakdown: Record<string, number> = {}
    let phoneMissing = 0

    for (const doc of docs) {
      const stage = String(doc.stage ?? 'new')
      stageBreakdown[stage] = (stageBreakdown[stage] ?? 0) + 1

      if (!doc.phone) {
        phoneMissing++
        summary.manualReviewList.push({
          collection: 'leads',
          id: String(doc.id ?? ''),
          reason: '线索无手机号',
          suggestion: '补充联系方式或归档为无效线索',
        })
      }
    }

    if (summary.collections.leads) {
      summary.collections.leads.statusBreakdown = stageBreakdown
    }

    summary.consistencyChecks.push({
      name: 'lead.integrity',
      status: phoneMissing > 0 ? 'warn' : 'pass',
      message: `检查了 ${docs.length} 条线索，${phoneMissing} 条无手机号`,
    })
  } catch (err) {
    summary.consistencyChecks.push({
      name: 'lead.integrity',
      status: 'fail',
      message: `线索完整性检查失败: ${err instanceof Error ? err.message : String(err)}`,
    })
  }
}

async function checkEffectiveSupplyConsistency(
  payload: Awaited<ReturnType<typeof getPayload>>,
  summary: AuditSummary,
  asOf: Date,
): Promise<void> {
  try {
    // 路径 A：通过有效供给谓词过滤
    const where = getEffectiveSupplyWhere(asOf)
    const filteredCount = await payload.count({
      collection: 'listings' as never,
      where: where as never,
      overrideAccess: true,
    })

    // 路径 B：按业务规则手动计数（审核通过 + 已发布）
    const manualCount = await payload.count({
      collection: 'listings' as never,
      where: {
        and: [
          { reviewStatus: { equals: 'approved' } },
          { publicationStatus: { equals: 'published' } },
        ],
      } as never,
      overrideAccess: true,
    })

    const diff = Math.abs((filteredCount.totalDocs ?? 0) - (manualCount.totalDocs ?? 0))

    summary.consistencyChecks.push({
      name: 'effective-supply.consistency',
      status: diff === 0 ? 'pass' : 'warn',
      message: `有效供给双读：谓词 ${filteredCount.totalDocs} vs 手动 ${manualCount.totalDocs}，差异 ${diff}`,
      details: {
        predicateCount: filteredCount.totalDocs,
        manualCount: manualCount.totalDocs,
        diff,
      },
    })
  } catch (err) {
    summary.consistencyChecks.push({
      name: 'effective-supply.consistency',
      status: 'fail',
      message: `有效供给双读验证失败: ${err instanceof Error ? err.message : String(err)}`,
    })
  }
}

/**
 * 打印人类可读的报告摘要到控制台。
 */
export function printAuditSummary(summary: AuditSummary): void {
  console.log('\n========== M8.4 数据迁移双读报告 ==========\n')
  console.log(`时间: ${summary.timestamp}`)
  console.log(`环境: ${summary.environment}\n`)

  console.log('── 行数统计 ──')
  for (const [slug, info] of Object.entries(summary.collections)) {
    console.log(`  ${slug}: ${info.total}`)
    if (info.statusBreakdown) {
      for (const [k, v] of Object.entries(info.statusBreakdown)) {
        console.log(`    ${k}: ${v}`)
      }
    }
  }

  console.log('\n── 一致性检查 ──')
  for (const check of summary.consistencyChecks) {
    const icon = check.status === 'pass' ? '✅' : check.status === 'fail' ? '❌' : '⚠️'
    console.log(`  ${icon} ${check.name}: ${check.message}`)
  }

  console.log(`\n── 人工处理清单 (${summary.manualReviewList.length} 条) ──`)
  if (summary.manualReviewList.length === 0) {
    console.log('  无')
  } else {
    for (const item of summary.manualReviewList.slice(0, 20)) {
      console.log(`  [${item.collection}] id=${item.id}`)
      console.log(`    原因: ${item.reason}`)
      console.log(`    建议: ${item.suggestion}`)
    }
    if (summary.manualReviewList.length > 20) {
      console.log(`  ... 还有 ${summary.manualReviewList.length - 20} 条`)
    }
  }

  const passCount = summary.consistencyChecks.filter(c => c.status === 'pass').length
  const warnCount = summary.consistencyChecks.filter(c => c.status === 'warn').length
  const failCount = summary.consistencyChecks.filter(c => c.status === 'fail').length
  console.log(`\n── 结果: ${passCount} 通过 / ${warnCount} 警告 / ${failCount} 失败 ──\n`)
}

// CLI 入口：使用 fileURLToPath + resolve 跨平台兼容（Windows 下反斜杠与 file:// URL 不一致）
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runDataAudit()
    .then((summary) => {
      printAuditSummary(summary)
      // JSON 输出到 stderr，方便管道捕获
      console.error(JSON.stringify(summary, null, 2))
      process.exit(0)
    })
    .catch((err) => {
      console.error('数据审计失败:', err)
      process.exit(1)
    })
}
