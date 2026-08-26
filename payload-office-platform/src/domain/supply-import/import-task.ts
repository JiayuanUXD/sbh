/**
 * 批量导入 Jobs Queue 写入层（OPT-041 Task 7）
 *
 * 这是整个批量导入功能里唯一真正改动业务数据的一层——预检（Task 6）只读不写，
 * 这里才把预检通过的行真正 create/update 进 buildings / listings。导入的房源
 * **直接上架**，写错会立刻出现在前台，故五条语义不可妥协：
 *
 *   1. 幂等键是 (dataSource.source='manual-import', dataSource.externalId)：
 *      命中则 update，未命中则 create。同一批跑两次，第二次全部落 updated，
 *      两次 affectedIds 相同。
 *   2. 落地状态显式写死，不依赖 `adminAutoPublish` 的副作用（该 hook 因操作者
 *      身份不同会产生不同结果，见 `domain/review/admin-auto-publish-hook.ts`）：
 *      房源 reviewStatus:'approved' + publicationStatus:'published' +
 *      supplyVisibilityHold:'normal'；楼盘 status:'published' +
 *      operationalStatus:'active'。
 *   3. update 时绝不改 slug——改 slug 会断掉已有的前台 URL。create 时才用
 *      slugify() 生成并处理冲突。
 *   4. 单行失败不阻断后续行，也不回滚已成功的行：每行独立 try/catch，失败计入
 *      failed 并记录原因，继续下一行。
 *   5. 唯一索引冲突（PG 23505）视为并发重复：重新按 externalId 查一次改走
 *      update，仍失败才计 failed。判定走全仓唯一实现
 *      `domain/shared/unique-violation.ts`——这套 Payload + drizzle/postgres
 *      适配器会把 23505（含本项目自建的局部唯一索引）在离开 create()/update()
 *      之前就转换成 `ValidationError`，原始 pg 错误不再可从 `.cause` 链拿到，
 *      只按 cause.code 找的写法对这个适配器版本恒为 false，详见该文件文件头。
 */

import type { Payload, PayloadRequest, TaskConfig } from 'payload'

import { isDecorationStatus, isListingType } from '@/domain/review/listing-fields'
import { isUniqueViolation } from '@/domain/shared/unique-violation'
import { ensureUniqueSlug, slugify } from '@/domain/shared/slug'
import {
  resolveDefaultSupplyMerchant,
  type MerchantLookupPort,
} from '@/domain/supply/default-merchant'
import type { ValidBuildingRow } from '@/domain/supply-import/building-row'
import type { ValidListingRow } from '@/domain/supply-import/listing-row'
import {
  mapBuildingMerchantRelationDocs,
  MERCHANT_RESOLUTION_CODES,
  resolveBuildingMerchant,
  type RawBuildingMerchantRelationDoc,
} from '@/domain/supply-import/resolve-merchant'

export const SUPPLY_IMPORT_TASK = 'run-supply-import'
export const SUPPLY_IMPORT_QUEUE = 'supply-imports'
export const SUPPLY_IMPORT_CHUNK = 20

/** 陈旧 processing 租约的释放阈值，与 `application-notify.ts` 的 15 分钟同口径。 */
export const SUPPLY_IMPORT_JOB_LEASE_MS = 15 * 60 * 1_000

export interface ImportRunResult {
  created: number
  updated: number
  failed: number
  affectedIds: Array<number | string>
  errors: Array<{ externalId: string; message: string }>
}

// ────────────────────────────────────────────────────────────
// 唯一索引冲突判定（调用 domain/shared/unique-violation.ts 的全仓唯一实现）
// ────────────────────────────────────────────────────────────

/*
 * 语义 5 撞的是迁移自建的局部唯一索引
 * `buildings_data_source_external_uniq` / `listings_data_source_external_uniq`
 *（见 migrations/20260822_001600_supply_import_unique_indexes.ts，
 * 建在 (data_source_source, data_source_external_id) 上）。
 *
 * 不传 `path`：这两个索引不是 Payload 从 `unique: true` 生成的，适配器映射不回字段，
 * `ValidationError` 条目的 `path` 恒为 `null`。表名之外的收窄由紧随其后的
 * 「按 externalId 重查一次」承担——查不到就原样 rethrow 原始错误
 *（见 writeBuildingRow / writeListingRow 的 catch 分支），所以即便撞的是同表另一个
 * 唯一约束（如 slug），也不会被吞成「并发重复」。
 *
 * 比此前那版按错误文案 `/must be unique|唯一/i` 匹配更严：文案匹配会把**任何** collection
 * 的唯一冲突都判成真，且随 i18n 语言配置漂移；按 tableName 判则只认这两张表。
 */
function isBuildingUniqueViolation(error: unknown): boolean {
  return isUniqueViolation(error, {
    tableName: 'buildings',
    column: 'data_source_external_id',
  })
}

function isListingUniqueViolation(error: unknown): boolean {
  return isUniqueViolation(error, {
    tableName: 'listings',
    column: 'data_source_external_id',
  })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * relationship 字段在生成类型里是 `number | <Doc>`（Postgres 适配器下 ID 恒为 number，
 * 与 bulk-import-endpoint.ts:numericId 同口径），而 ValidBuildingRow/ValidListingRow
 * 的 id 类型是宽松的 `number | string`（Task 4 解析层的通用产出）。这里收窄一次。
 */
function numericId(id: number | string): number {
  return typeof id === 'number' ? id : Number(id)
}

// ────────────────────────────────────────────────────────────
// 房源 rentUnit：ValidListingRow.rentUnit 取值域比 Listings.rentUnit（旧字段）宽
// （normalize.ts 的 parseRent 还会产出 'rmb-total'，旧字段 select 没有这个选项）。
// 不在这里猜测性地把 'rmb-total' 映射进结构化价格——期间/单位口径不明确，猜错
// 会让前台价格错一个数量级，宁可让该行失败并报错，由后续任务显式决定映射规则。
// ────────────────────────────────────────────────────────────

const LEGACY_RENT_UNITS = ['rmb-sqm-day', 'rmb-month', 'rmb-seat-month'] as const
type LegacyRentUnit = (typeof LEGACY_RENT_UNITS)[number]

function isLegacyRentUnit(value: string): value is LegacyRentUnit {
  return (LEGACY_RENT_UNITS as readonly string[]).includes(value)
}

// ────────────────────────────────────────────────────────────
// slug：create 时生成，update 时绝不传（不覆盖已有值）
// ────────────────────────────────────────────────────────────

async function uniqueSlugFor(
  payload: Payload,
  req: PayloadRequest | undefined,
  collection: 'buildings' | 'listings',
  base: string,
): Promise<string> {
  const baseSlug = slugify(base) || 'supply-import'
  return ensureUniqueSlug(baseSlug, async (candidate) => {
    const result = await payload.find({
      collection,
      where: { slug: { equals: candidate } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
      req,
    })
    return result.totalDocs > 0
  })
}

// ────────────────────────────────────────────────────────────
// 楼盘写入
// ────────────────────────────────────────────────────────────

async function findBuildingByExternalId(
  payload: Payload,
  req: PayloadRequest | undefined,
  externalId: string,
): Promise<number | null> {
  const result = await payload.find({
    collection: 'buildings',
    where: {
      and: [
        { 'dataSource.source': { equals: 'manual-import' } },
        { 'dataSource.externalId': { equals: externalId } },
      ],
    },
    limit: 1,
    depth: 0,
    overrideAccess: true,
    req,
  })
  return result.docs[0]?.id ?? null
}

/**
 * 楼盘模板「供给商户」列的落库（OPT-045 §5.3）：楼盘当前**没有**生效关系时建一条，
 * `effectiveFrom` 取导入时点、`effectiveTo` 留空（长期有效）。
 *
 * ## 只建不改，这是刻意的
 *
 * 楼盘已有生效关系时**一律不动**，不管指向的是不是同一个商户：
 *
 * - 同一个商户 → 本来就无事可做；
 * - 不同商户 → 「换供给商户」是有合规含义的业务变更，要走
 *   `building-merchant-relation-protect.ts` 那套重叠区间保护（关旧区间、开新区间），
 *   不该由一张表格静默完成。运营真要换，去楼盘商户关系里改。
 *
 * 这样重传（D6 鼓励的主路径）天然幂等：不会堆出重复关系，也不会触发重叠拦截。
 *
 * **失败不阻断楼盘本身**：关系没建上，房源侧还有平台自营回落兜底，房源照样能上架。
 * 为了一条锦上添花的关系让整行楼盘失败是错误的取舍。
 */
async function ensureBuildingMerchantRelation(
  payload: Payload,
  req: PayloadRequest | undefined,
  buildingId: number,
  buildingCityId: number | string | null,
  merchantId: number | string,
  now: Date,
): Promise<void> {
  const existing = await payload.find({
    collection: 'building-merchant-relations',
    where: { building: { equals: buildingId } },
    depth: 1,
    limit: 0,
    overrideAccess: true,
    req,
  })
  const relations = mapBuildingMerchantRelationDocs(
    existing.docs as unknown as RawBuildingMerchantRelationDoc[],
  )
  // 复用同一份「当前生效」判定：有生效关系就不动，无论指向谁。
  const current = resolveBuildingMerchant('', buildingId, buildingCityId, relations, now)
  const hasEffective =
    current.ok || current.code !== MERCHANT_RESOLUTION_CODES.NO_SUPPLY_MERCHANT_RELATION
  if (hasEffective) return

  await payload.create({
    collection: 'building-merchant-relations',
    data: {
      building: buildingId,
      merchant: numericId(merchantId),
      effectiveFrom: now.toISOString(),
    },
    overrideAccess: true,
    req,
  })
}

async function writeBuildingRow(
  payload: Payload,
  req: PayloadRequest | undefined,
  row: ValidBuildingRow,
): Promise<{ id: number; created: boolean }> {
  const syncedAt = new Date().toISOString()

  // 最终评审 Critical 3：createData / updateData 拆分（用户裁定方案 A）。此前
  // sharedData 同时用于 create 与 update，导致重传（D6 鼓励的主路径）会把
  // `status` / `operationalStatus` 强行改回导入时的写死值，抹掉运营用启停开关
  // 设置的 `operationalStatus:'inactive'`。update 分支只更新业务字段，完全不传
  // `status` / `operationalStatus`——谁下架的谁负责再上架。batch-rollback.ts:8-10
  // 的注释刻意声明"只动 status 不动 operationalStatus，两条轴独立"，这里与它保持一致。
  // OPT-045 新增四个业务字段（等级 / 竣工 / 最近地铁 / 在售单价）随 commonData 一起写。
  //
  // **留空即清空**——与本函数既有的 address / totalFloors / grossFloorArea 完全一致：
  // 模板是这些字段的唯一真相，重传一份没填等级的表会把等级清掉。这是刻意保持一致，
  // 不给新列另立一套「留空=不动」的规则（同一张表里两种语义比任何一种单独的语义都糟）。
  // 运营若在后台手改过这些字段，重传前要把值补进表格里。
  const commonData = {
    name: row.name,
    city: numericId(row.cityId),
    district: numericId(row.districtId),
    businessDistrict: row.businessAreaId === null ? null : numericId(row.businessAreaId),
    address: row.address,
    totalFloors: row.totalFloors,
    grade: row.grade,
    completionDate: row.completionDate,
    nearestMetro: row.nearestMetroId === null ? null : numericId(row.nearestMetroId),
    saleUnitPrice: row.saleUnitPrice,
    developerAndScale: { grossFloorArea: row.grossFloorArea },
    dataSource: {
      source: 'manual-import' as const,
      externalId: row.externalId,
      syncedAt,
    },
  }
  const createData = {
    ...commonData,
    // 语义 2：落地状态显式写死，不依赖 adminAutoPublish 的副作用。仅 create 分支写。
    status: 'published' as const,
    operationalStatus: 'active' as const,
  }
  const updateData = commonData

  /**
   * 楼盘写完后补建供给商户关系（OPT-045）。三条返回路径都要过这里，所以收口成一个
   * helper——漏掉任何一条都会让「填了商户列却没建关系」这种问题只在部分路径上出现，
   * 是最难复现的那类缺陷。
   *
   * 关系建失败**不让楼盘行失败**：房源侧还有平台自营回落兜底，房源照样能上架；
   * 为一条锦上添花的关系把整行楼盘判失败是错误的取舍。失败只留日志。
   */
  const finish = async (id: number, created: boolean) => {
    if (row.merchantId !== null) {
      try {
        await ensureBuildingMerchantRelation(payload, req, id, row.cityId, row.merchantId, new Date())
      } catch (error) {
        payload.logger.warn(
          {
            errorCode: 'supply_import_relation_failed',
            buildingId: id,
            externalId: row.externalId,
            message: errorMessage(error),
          },
          'supply_import_relation_failed',
        )
      }
    }
    return { id, created }
  }

  const existingId = await findBuildingByExternalId(payload, req, row.externalId)
  if (existingId !== null) {
    // 语义 3：update 绝不传 slug；Critical 3：update 绝不传 status/operationalStatus。
    const updated = await payload.update({
      collection: 'buildings',
      id: existingId,
      data: updateData,
      overrideAccess: true,
      req,
    })
    return finish(updated.id, false)
  }

  try {
    const slug = await uniqueSlugFor(payload, req, 'buildings', row.name)
    const created = await payload.create({
      collection: 'buildings',
      data: { ...createData, slug },
      overrideAccess: true,
      req,
    })
    return finish(created.id, true)
  } catch (error) {
    // 语义 5：唯一索引冲突视为并发重复，重新按 externalId 查一次改走 update。
    if (!isBuildingUniqueViolation(error)) throw error
    const raceId = await findBuildingByExternalId(payload, req, row.externalId)
    if (raceId === null) throw error
    const updated = await payload.update({
      collection: 'buildings',
      id: raceId,
      data: updateData,
      overrideAccess: true,
      req,
    })
    return finish(updated.id, false)
  }
}

// ────────────────────────────────────────────────────────────
// D10：房源商户——写入层从"同一来源"（building-merchant-relations）独立取值，
// 不信任预检阶段的判断结果本身（预检只保证"当时"通过），这是规格要求的兜底守卫，
// 防止预检与执行之间关系失效（比如运营在两次点击之间把商户停用了）。复用
// resolve-merchant.ts 的 resolveBuildingMerchant，不另写一份资质判定。
// ────────────────────────────────────────────────────────────

async function resolveListingMerchant(
  payload: Payload,
  req: PayloadRequest | undefined,
  buildingId: number,
  buildingCityId: number | string | null,
): Promise<number> {
  const result = await payload.find({
    collection: 'building-merchant-relations',
    where: { building: { equals: buildingId } },
    depth: 1,
    limit: 0,
    overrideAccess: true,
    req,
  })
  const relations = mapBuildingMerchantRelationDocs(
    result.docs as unknown as RawBuildingMerchantRelationDoc[],
  )
  // OPT-045：楼盘没有生效关系时回落到本城市的平台自营商户。写入层独立解析一次
  // （不信任预检结果，见本函数顶部注释），回落也要在这里重新查——预检与执行之间
  // 运营可能刚把那个商户停用。
  const fallbackMerchantId =
    buildingCityId === null
      ? undefined
      : await resolveDefaultSupplyMerchant(payload as unknown as MerchantLookupPort, {
          cityId: buildingCityId,
          req,
        })
  const resolved = resolveBuildingMerchant(
    `楼盘（编号 ${buildingId}）`,
    buildingId,
    buildingCityId,
    relations,
    new Date(),
    { merchantId: fallbackMerchantId ?? null },
  )
  if (!resolved.ok) {
    throw new Error(resolved.message)
  }
  return numericId(resolved.merchantId)
}

// ────────────────────────────────────────────────────────────
// 房源写入
// ────────────────────────────────────────────────────────────

interface FoundListing {
  id: number
  deletedAt: string | null
}

/**
 * 最终评审 Critical 4：`includeTrash` 默认 false（不含回收站，与此前行为一致）。
 * 补救分支（写入撞唯一索引冲突时）传 `includeTrash: true`——`Listings` 是
 * `trash: true` 的软删集合，回收站里的行仍占着局部唯一索引；重传时默认查询
 * 会漏过它、误判为"真的不存在"而走 create，撞 23505 后如果补救查询还是不含
 * trash 的同一个 find，仍然查不到，只能把裸 Postgres 错误 rethrow 给运营。
 */
async function findListingByExternalId(
  payload: Payload,
  req: PayloadRequest | undefined,
  externalId: string,
  options?: { includeTrash?: boolean },
): Promise<FoundListing | null> {
  const result = await payload.find({
    collection: 'listings',
    where: {
      and: [
        { 'dataSource.source': { equals: 'manual-import' } },
        { 'dataSource.externalId': { equals: externalId } },
      ],
    },
    limit: 1,
    depth: 0,
    overrideAccess: true,
    req,
    trash: options?.includeTrash ?? false,
  })
  const doc = result.docs[0]
  if (!doc) return null
  return { id: doc.id, deletedAt: (doc as { deletedAt?: string | null }).deletedAt ?? null }
}

/** 命中回收站中的文档时，给运营一句可操作的话，而不是让裸 Postgres 唯一索引错误冒泡上去。 */
class ListingInTrashError extends Error {
  constructor(externalId: string) {
    super(`编号「${externalId}」对应的房源在回收站中，请先还原或更换编号后再导入`)
    this.name = 'ListingInTrashError'
  }
}

async function writeListingRow(
  payload: Payload,
  req: PayloadRequest | undefined,
  row: ValidListingRow,
): Promise<{ id: number; created: boolean }> {
  if (!isListingType(row.listingType)) {
    throw new Error(`未知房源类型：${row.listingType}`)
  }
  if (row.decorationStatus !== null && !isDecorationStatus(row.decorationStatus)) {
    throw new Error(`未知装修状态：${row.decorationStatus}`)
  }
  // 旧版 rentUnit 只认三个租赁单位；出售行 rentUnit 为 null，跳过这道校验——
  // 它们的价格走结构化四件套（price.*），不落旧字段。
  if (row.rentUnit !== null && !isLegacyRentUnit(row.rentUnit)) {
    throw new Error(`租金单位「${row.rentUnit}」暂不支持导入，请改用元/㎡/天、元/月或元/工位/月的写法`)
  }

  const listingType = row.listingType
  const decorationStatus = row.decorationStatus
  const rentUnit = row.rentUnit
  const syncedAt = new Date().toISOString()
  const buildingId = numericId(row.buildingId)

  // D10：房源商户唯一来源是楼盘当前生效的供给商户关系，模板没有商户列。
  // 这里独立重新解析（不信任预检时的判断，见 resolveListingMerchant 顶部注释）——
  // 解析失败直接抛错，被下面 runSupplyImportBatch 的 per-row try/catch 接住，
  // 计入 failed 且带上可操作的原因，不阻断这一批的其它行。
  // OPT-045：三级解析。模板「供给商户」列已在预检层解析并合格性校验过，
  // 直接用——不必再查一次库。留空才走「楼盘关系 → 平台自营回落」。
  const merchantId =
    row.merchantId !== null
      ? numericId(row.merchantId)
      : await resolveListingMerchant(payload, req, buildingId, row.cityId)

  // 最终评审 Critical 3：createData / updateData 拆分（用户裁定方案 A）。此前
  // sharedData 同时用于 create 与 update，导致重传会把 `publicationStatus` /
  // `supplyVisibilityHold` / `reviewStatus` 强行改回导入时的写死值，抹掉
  // leased/sold/人工下架、风控冻结、驳回等真实状态。update 分支只更新业务字段
  // （标题/类型/面积/租金/楼层/装修/可租日期/商户/dataSource），完全不传这三个
  // 状态字段——它们都不是导入表能表达的信息，谁下架的谁负责再上架。
  const commonData = {
    title: row.title,
    listingType,
    building: buildingId,
    merchant: merchantId,
    area: row.area,
    // 旧字段只有租赁行有值（出售行两者均为 null）。保留它们是因为 rentUnit 仍是
    // C 端价格单位筛选的查询路径，且楼盘聚合的 rentRanges 还在消费。
    rent: row.rentAmount,
    rentUnit,
    // OPT-045：结构化价格四件套——**这才是前台价格展示、排序、筛选的真实来源**。
    // currency 固定 CNY（Listings.price.currency 的取值域只有它）。
    price: {
      amount: row.price.amount,
      currency: 'CNY' as const,
      period: row.price.period,
      unit: row.price.unit,
    },
    businessType: row.businessType,
    // 出售条款：只有出售行有值。租赁行写 null 而不是跳过——重传时要能把
    // 误填的出售条款清掉（与其它字段「留空即清空」一致）。
    saleTerms: row.saleTerms ?? {
      propertyRightYears: null,
      saleTaxBearer: null,
      saleFiveYearsUnique: null,
      saleParkingSpaces: null,
    },
    floor: row.floor === null ? null : String(row.floor),
    decorationStatus,
    availableFrom: row.availableFrom,
    dataSource: {
      source: 'manual-import' as const,
      externalId: row.externalId,
      syncedAt,
    },
  }
  const createData = {
    ...commonData,
    // 语义 2：落地状态显式写死，不依赖 adminAutoPublish 的副作用（规格 D4：导入的房源直接上架）。
    // 仅 create 分支写。
    reviewStatus: 'approved' as const,
    publicationStatus: 'published' as const,
    supplyVisibilityHold: 'normal' as const,
  }
  const updateData = commonData

  // 最终评审 Critical 4：默认查询不含回收站（includeTrash 缺省 false），行为与此前一致。
  const existing = await findListingByExternalId(payload, req, row.externalId)
  if (existing !== null) {
    // 语义 3：update 绝不传 slug；Critical 3：update 绝不传三个状态字段。
    const updated = await payload.update({
      collection: 'listings',
      id: existing.id,
      data: updateData,
      overrideAccess: true,
      req,
    })
    return { id: updated.id, created: false }
  }

  try {
    const slug = await uniqueSlugFor(payload, req, 'listings', row.title)
    const created = await payload.create({
      collection: 'listings',
      data: { ...createData, slug },
      overrideAccess: true,
      req,
    })
    return { id: created.id, created: true }
  } catch (error) {
    // 语义 5：唯一索引冲突视为并发重复，重新按 externalId 查一次改走 update。
    if (!isListingUniqueViolation(error)) throw error
    // 最终评审 Critical 4：补救查询必须含回收站——默认查询（includeTrash:false）
    // 找不到软删文档，才会走到这里撞 23505；补救查询若还是不含 trash 的同一个
    // find，仍会查不到、把裸 Postgres 错误 rethrow 给运营。
    const race = await findListingByExternalId(payload, req, row.externalId, { includeTrash: true })
    if (race === null) throw error
    if (race.deletedAt) {
      // 命中的是回收站里的文档，不是真的并发写入——不静默改走 update（那会在软删
      // 状态上产生一次奇怪的部分更新），给运营可操作的错误文案，计入 failed。
      throw new ListingInTrashError(row.externalId)
    }
    const updated = await payload.update({
      collection: 'listings',
      id: race.id,
      data: updateData,
      overrideAccess: true,
      req,
    })
    return { id: updated.id, created: false }
  }
}

// ────────────────────────────────────────────────────────────
// 批处理入口
// ────────────────────────────────────────────────────────────

export async function runSupplyImportBatch(params: {
  payload: Payload
  req?: PayloadRequest
  type: 'buildings' | 'listings'
  validRows: ReadonlyArray<ValidBuildingRow | ValidListingRow>
}): Promise<ImportRunResult> {
  const { payload, req, type, validRows } = params
  const result: ImportRunResult = {
    created: 0,
    updated: 0,
    failed: 0,
    affectedIds: [],
    errors: [],
  }

  for (const row of validRows) {
    try {
      // 语义 4：单行独立 try/catch，失败不阻断后续行，也不回滚已成功的行。
      const outcome =
        type === 'buildings'
          ? await writeBuildingRow(payload, req, row as ValidBuildingRow)
          : await writeListingRow(payload, req, row as ValidListingRow)
      if (outcome.created) result.created += 1
      else result.updated += 1
      result.affectedIds.push(outcome.id)
    } catch (error) {
      result.failed += 1
      result.errors.push({ externalId: row.externalId, message: errorMessage(error) })
    }
  }

  return result
}

// ────────────────────────────────────────────────────────────
// 批次记录里的 validRows 结构守卫（Task 6 的 PersistedValidRow：ValidXxxRow + rowNumber，
// 未从 bulk-import-endpoint.ts 导出，这里按实际落库形状各写一份判断，不改变其定义）
// ────────────────────────────────────────────────────────────

function isNumberOrString(value: unknown): value is number | string {
  return typeof value === 'number' || typeof value === 'string'
}

function isNullableNumberOrString(value: unknown): value is number | string | null {
  return value === null || isNumberOrString(value)
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === 'number'
}

function toValidBuildingRow(value: unknown): ValidBuildingRow | null {
  if (typeof value !== 'object' || value === null) return null
  const row = value as Record<string, unknown>
  if (typeof row.externalId !== 'string') return null
  if (typeof row.name !== 'string') return null
  if (!isNumberOrString(row.cityId)) return null
  if (!isNumberOrString(row.districtId)) return null
  if (!isNullableNumberOrString(row.businessAreaId)) return null
  if (!isNullableString(row.address)) return null
  if (!isNullableNumber(row.totalFloors)) return null
  if (!isNullableNumber(row.grossFloorArea)) return null
  // OPT-045 新增字段一律「缺失即 null」而不是判非法：本函数重校验的是**已入队 job**
  // 的载荷，部署前入队、部署后才执行的 job 不带这些键。硬校验会让那批 job 整体失败，
  // 而它们本身完全合法。
  return {
    externalId: row.externalId,
    name: row.name,
    cityId: row.cityId,
    districtId: row.districtId,
    businessAreaId: row.businessAreaId,
    address: row.address,
    totalFloors: row.totalFloors,
    grossFloorArea: row.grossFloorArea,
    merchantId: isNullableNumberOrString(row.merchantId) ? row.merchantId : null,
    grade: typeof row.grade === 'string' ? (row.grade as ValidBuildingRow['grade']) : null,
    completionDate: isNullableString(row.completionDate) ? row.completionDate : null,
    nearestMetroId: isNullableNumberOrString(row.nearestMetroId) ? row.nearestMetroId : null,
    saleUnitPrice: isNullableNumber(row.saleUnitPrice) ? row.saleUnitPrice : null,
  }
}

function toValidListingRow(value: unknown): ValidListingRow | null {
  if (typeof value !== 'object' || value === null) return null
  const row = value as Record<string, unknown>
  if (typeof row.externalId !== 'string') return null
  if (typeof row.title !== 'string') return null
  if (typeof row.listingType !== 'string') return null
  if (!isNumberOrString(row.buildingId)) return null
  if (!isNullableNumberOrString(row.cityId)) return null
  if (typeof row.area !== 'number') return null
  if (!isNullableNumber(row.rentAmount)) return null
  if (!isNullableString(row.rentUnit)) return null
  if (!isNullableNumber(row.floor)) return null
  if (!isNullableString(row.decorationStatus)) return null
  if (!isNullableString(row.availableFrom)) return null

  // OPT-045：`price` 是新增的必需字段，但**部署前入队的 job 载荷里没有它**。
  // 那些 job 一定是租赁行（当时出售根本导不进来），且一定有 rentAmount/rentUnit，
  // 所以能无损重建出结构化价格——而不是让那批本身合法的 job 整体失败。
  const price = toPrice(row.price) ?? rebuildLeasePrice(row.rentAmount, row.rentUnit)
  if (price === null) return null

  return {
    externalId: row.externalId,
    title: row.title,
    listingType: row.listingType,
    buildingId: row.buildingId,
    cityId: row.cityId,
    area: row.area,
    rentAmount: row.rentAmount,
    rentUnit: row.rentUnit,
    price,
    businessType: row.businessType === 'sale' ? 'sale' : 'lease',
    floor: row.floor,
    decorationStatus: row.decorationStatus,
    availableFrom: row.availableFrom,
    merchantId: isNullableNumberOrString(row.merchantId) ? row.merchantId : null,
    saleTerms: toSaleTerms(row.saleTerms),
  }
}

/** 载荷里的 price 三件套；形状不对返回 null（交给调用方回落重建）。 */
function toPrice(value: unknown): ValidListingRow['price'] | null {
  if (typeof value !== 'object' || value === null) return null
  const p = value as Record<string, unknown>
  if (typeof p.amount !== 'number') return null
  if (typeof p.period !== 'string' || typeof p.unit !== 'string') return null
  return {
    amount: p.amount,
    period: p.period as ValidListingRow['price']['period'],
    unit: p.unit as ValidListingRow['price']['unit'],
  }
}

/** 从旧版 rentAmount/rentUnit 重建结构化价格（映射表与 listing-row.ts 同源同口径）。 */
function rebuildLeasePrice(
  rentAmount: number | null,
  rentUnit: string | null,
): ValidListingRow['price'] | null {
  if (rentAmount === null || rentUnit === null) return null
  const mapped = LEGACY_TO_PRICE[rentUnit]
  if (mapped === undefined) return null
  return { amount: rentAmount, ...mapped }
}

const LEGACY_TO_PRICE: Record<
  string,
  { period: ValidListingRow['price']['period']; unit: ValidListingRow['price']['unit'] }
> = {
  'rmb-sqm-day': { period: 'day', unit: 'sqm' },
  'rmb-month': { period: 'month', unit: 'suite' },
  'rmb-seat-month': { period: 'month', unit: 'seat' },
}

/** 载荷里的 saleTerms；缺失或形状不对一律视为 null（租赁行本来就没有）。 */
function toSaleTerms(value: unknown): ValidListingRow['saleTerms'] {
  if (typeof value !== 'object' || value === null) return null
  const t = value as Record<string, unknown>
  return {
    propertyRightYears:
      typeof t.propertyRightYears === 'string'
        ? (t.propertyRightYears as NonNullable<ValidListingRow['saleTerms']>['propertyRightYears'])
        : null,
    saleTaxBearer:
      typeof t.saleTaxBearer === 'string'
        ? (t.saleTaxBearer as NonNullable<ValidListingRow['saleTerms']>['saleTaxBearer'])
        : null,
    saleFiveYearsUnique: typeof t.saleFiveYearsUnique === 'boolean' ? t.saleFiveYearsUnique : null,
    saleParkingSpaces: typeof t.saleParkingSpaces === 'number' ? t.saleParkingSpaces : null,
  }
}

// ────────────────────────────────────────────────────────────
// affectedIds / writeErrors 的持久化辅助（评审 Task 7 第 1 轮 Critical 1 + Important 2）
//
// Critical 1：崩溃/实例回收后 recoverStaleSupplyImportJobs 会把陈旧 job 重新放回队列，
// 同一 batchId 的 handler 会再跑一次。整批重跑对行写入本身是幂等安全的（语义 1），
// 但如果每次 handler 进来都把 affectedIds 从空数组重新累积、再整体覆盖批次字段，
// 会在下面两种情况下把已经持久化的锚点冲掉：
//   1) 重跑尚未跑完所有分片就再次崩溃——本次已写的分片数比上次少，覆盖后批次字段
//      比真实情况小；
//   2) 某一行在上次成功、这次因为外部条件变化（比如引用的楼盘被删）转为失败——
//      它对应的已上架房源仍然真实存在，但这次的 chunkResult 不会再产出它的 id，
//      覆盖式写入会让这个真实存在、正在前台可见的对象永久丢失回滚锚点。
// 修法：handler 开始时把批次里已持久化的 affectedIds 读出来做种子，此后只做并集
// 合并（去重、保持已存在项在前），不再整体覆盖——已经落库的锚点只增不减。
//
// Important 2：chunkResult.errors 此前直接丢弃，运营只能看到 stats.failed 的数字，
// 看不到具体是哪几行、为什么失败。这里把错误累积进 rowErrors 这个既有 json 字段的
// 一个新增子键 writeErrors，与 Task 6 预检阶段写入的 errors/rawRows/rawRowNumbers
// 并列、互不覆盖——预检错误是"这行数据本身不合法"，写入错误是"数据合法但落库时
// 出了别的问题（比如并发下彻底失败、引用对象不存在）"，语义不同不能混在一个数组里。
// writeErrors **不做跨次运行的并集**：不同于 affectedIds（丢了等于丢失真实存在的
// 回滚锚点），错误信息反映的是"当前这次运行观察到的问题"，跨次保留旧错误反而可能
// 误导运营去修一个这次其实已经不存在的问题；每次运行以本次结果整体覆盖 writeErrors，
// 这一点在 Task 8 消费前必须清楚：writeErrors 是"最近一次运行的快照"，不是历史累计。
// ────────────────────────────────────────────────────────────

interface PersistedWriteError {
  externalId: string
  message: string
}

function isIdValue(value: unknown): value is number | string {
  return typeof value === 'number' || typeof value === 'string'
}

/** 从批次的 json 字段里安全取出已持久化的 affectedIds（结构可能损坏/为空）。 */
function toIdArray(value: unknown): Array<number | string> {
  if (!Array.isArray(value)) return []
  return value.filter(isIdValue)
}

/** 并集合并：已存在的项保持原有顺序在前，新增项按出现顺序追加，去重。 */
function mergeIds(
  existing: ReadonlyArray<number | string>,
  incoming: ReadonlyArray<number | string>,
): Array<number | string> {
  const seen = new Set(existing.map(String))
  const merged = [...existing]
  for (const id of incoming) {
    const key = String(id)
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(id)
  }
  return merged
}

/** 批次 rowErrors 是自由 json 字段；取出既有对象形态（非对象/数组时按空对象处理），
 * 好让本次写入只替换 writeErrors 这一个子键，不动 Task 6 预检阶段写的其它键。 */
function toRowErrorsRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/** 行结构守卫失败时（json 字段被外部写坏），尽量取出 externalId 供错误列表定位；取不到就给占位。 */
function extractExternalIdForError(raw: unknown): string {
  if (typeof raw === 'object' && raw !== null) {
    const externalId = (raw as Record<string, unknown>).externalId
    if (typeof externalId === 'string' && externalId.trim() !== '') return externalId
  }
  return '(未知编号)'
}

// ────────────────────────────────────────────────────────────
// TaskConfig：读批次 → running → 按 SUPPLY_IMPORT_CHUNK 分片写入 → 每片更新 stats →
// 完成后 completed；任务整体抛错则 failed，但保留已写入的 affectedIds（Task 9 回滚锚点）。
// ────────────────────────────────────────────────────────────

interface SupplyImportBatchStats {
  processed: number
  created: number
  updated: number
  failed: number
}

type SupplyImportTaskType = {
  input: { batchId: number }
  output: { created: number; updated: number; failed: number }
}

export const supplyImportTask: TaskConfig<SupplyImportTaskType> = {
  slug: SUPPLY_IMPORT_TASK,
  label: '批量导入写入',
  inputSchema: [{ name: 'batchId', type: 'number', required: true }],
  outputSchema: [
    { name: 'created', type: 'number', required: true },
    { name: 'updated', type: 'number', required: true },
    { name: 'failed', type: 'number', required: true },
  ],
  handler: async ({ input, req }) => {
    const payload = req.payload
    const batchId = input.batchId

    await payload.update({
      collection: 'supply-import-batches',
      id: batchId,
      data: { status: 'running' },
      overrideAccess: true,
      req,
    })

    const batch = await payload.findByID({
      collection: 'supply-import-batches',
      id: batchId,
      depth: 0,
      overrideAccess: true,
      req,
    })

    const rawRows = Array.isArray(batch.validRows) ? batch.validRows : []
    const rows: Array<ValidBuildingRow | ValidListingRow> = []
    // Important 2：结构守卫失败的行也要有一条 writeErrors 记录，不能只在 stats.failed
    // 里加一个数字却不说是哪一行。
    const writeErrors: PersistedWriteError[] = []
    let structuralFailures = 0
    for (const raw of rawRows) {
      const row = batch.type === 'buildings' ? toValidBuildingRow(raw) : toValidListingRow(raw)
      if (row) {
        rows.push(row)
      } else {
        structuralFailures += 1
        writeErrors.push({
          externalId: extractExternalIdForError(raw),
          message: '批次行数据结构异常，请重新预检',
        })
      }
    }

    const stats: SupplyImportBatchStats = {
      processed: 0,
      created: 0,
      updated: 0,
      failed: structuralFailures,
    }
    // Critical 1：种子必须来自批次里已经持久化的 affectedIds，不能从空数组重新累积——
    // 见上方大注释，整体覆盖会在崩溃重跑或行状态转失败时丢失已上架对象的回滚锚点。
    let affectedIds: Array<number | string> = toIdArray(batch.affectedIds)

    const persistRowErrors = (): Record<string, unknown> => ({
      ...toRowErrorsRecord(batch.rowErrors),
      writeErrors,
    })

    try {
      for (let i = 0; i < rows.length; i += SUPPLY_IMPORT_CHUNK) {
        const chunk = rows.slice(i, i + SUPPLY_IMPORT_CHUNK)
        const chunkResult = await runSupplyImportBatch({
          payload,
          req,
          type: batch.type,
          validRows: chunk,
        })
        stats.processed += chunk.length
        stats.created += chunkResult.created
        stats.updated += chunkResult.updated
        stats.failed += chunkResult.failed
        // Critical 1：并集合并，绝不整体覆盖——已持久化的锚点只增不减。
        affectedIds = mergeIds(affectedIds, chunkResult.affectedIds)
        writeErrors.push(...chunkResult.errors)

        // 分片进度：前端轮询靠 stats 显示进度。
        await payload.update({
          collection: 'supply-import-batches',
          id: batchId,
          data: { stats, affectedIds, rowErrors: persistRowErrors() },
          overrideAccess: true,
          req,
        })
      }
    } catch (error) {
      // 任务整体抛错 → failed，但保留已写入的 affectedIds，让 Task 9 的回滚仍有锚点。
      await payload
        .update({
          collection: 'supply-import-batches',
          id: batchId,
          data: {
            status: 'failed',
            stats,
            affectedIds,
            rowErrors: persistRowErrors(),
            finishedAt: new Date().toISOString(),
          },
          overrideAccess: true,
          req,
        })
        .catch(() => null)
      throw error
    }

    await payload.update({
      collection: 'supply-import-batches',
      id: batchId,
      data: {
        status: 'completed',
        finishedAt: new Date().toISOString(),
        stats,
        affectedIds,
        rowErrors: persistRowErrors(),
      },
      overrideAccess: true,
      req,
    })

    return { output: { created: stats.created, updated: stats.updated, failed: stats.failed } }
  },
}

// ────────────────────────────────────────────────────────────
// 陈旧 job 恢复：released 掉超过租约期仍 processing=true 的 job（进程崩溃/CloudRun 实例
// 回收等场景），让下一轮 autoRun 重新领取。同一批次的行写入是幂等的（语义 1），
// 整批重跑安全，不需要从半途断点续传。写法与 application-notify.ts 的
// recoverStaleCityPartnerNotificationJobs 一致：where 子句本身是原子的，
// 并发多个 reaper 幂等，新鲜 job（updated_at 晚于 cutoff）不会被误抢。
// ────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────
// D11 评审第 1 轮 Important 1：缓存失效**不**放在这个 handler 里。
// 这个 TaskConfig 由 payload.config.ts 的 Jobs Queue cron autoRun 驱动，运行在
// cron/worker 上下文——不在任何 Next 请求/渲染范围内。`revalidateTag` 需要
// work store，脱离请求上下文调用会抛错；`revalidatePublicCacheTags`
// （lib/frontend/public-cache-revalidation.ts）又把这类异常逐个吞成
// console.error，于是"导入后立即可见"会静默退化回 cached-queries.ts 的 5 分钟
// TTL——正是 D11 要修的问题，放在这里等于没修。缓存失效改为放在
// bulk-import-endpoint.ts 的 GET /bulk-import/batches/:id（轮询端点，运行在真实
// 请求上下文里）：观察到批次进入终态（completed/failed）且 affectedIds 非空时
// 触发。revalidateTag 幂等，重复轮询多触发几次不是问题，不为此加
// "恰好一次" 的 schema 字段。
// ────────────────────────────────────────────────────────────

export async function recoverStaleSupplyImportJobs(payload: Payload, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - SUPPLY_IMPORT_JOB_LEASE_MS).toISOString()
  const result = await payload.db.pool.query<{ id: number }>(
    `
    UPDATE payload_jobs
    SET processing = false, updated_at = NOW()
    WHERE queue = $1
      AND updated_at <= $2
      AND task_slug = $3
      AND processing = true
      AND completed_at IS NULL
      AND has_error IS NOT TRUE
    RETURNING id
  `,
    [SUPPLY_IMPORT_QUEUE, cutoff, SUPPLY_IMPORT_TASK],
  )
  return result.rowCount ?? result.rows.length
}
