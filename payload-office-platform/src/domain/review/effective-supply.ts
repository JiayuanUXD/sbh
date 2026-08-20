/**
 * 统一有效供给谓词（tasks.md M4.7 / design §3.6 有效供给 10 条 / R3）
 *
 * 「有效供给」= 允许在 C 端曝光、可进入推荐/跟进候选池的房源。design 列 10 条，
 * 按可判定层次拆成两层：
 *
 *   1) getEffectiveSupplyWhere(asOf) —— 查询层可直接表达的条件，返回 Payload where
 *      片段（fail-closed 正向谓词，只用 equals/exists，绝不用 not_equals 以免 NULL 漏网）：
 *        §1 未逻辑删除            deletedAt exists:false
 *        §2 已发布                publicationStatus = published
 *        §3 审核通过              reviewStatus = approved
 *        §4 未被供给可见性冻结    supplyVisibilityHold = normal
 *        §7 楼盘/城市/行政区启用  building.operationalStatus / city.status / district.status = active
 *      （§5「未被生效举报冻结」由 M6.2 listingReportPauseWhere / getPausedListingIds 提供，
 *        举报是独立 collection（listing-reports），需通过 targetListing 关联查询被举报的
 *        listing IDs，调用方在查询 listings 时使用 id: { not_in: pausedIds } 排除。）
 *
 *   2) isListingEffectivelySupplied(snapshot, asOf) —— 需已解析关联数据才能判定的条件，
 *      逐条给出排除原因（供实时预览 / 诊断 / 审计一次性回显）：
 *        §8  房源已设置供给商户（listings.merchant 非空）    NO_SUPPLY_MERCHANT
 *        §9  商户启用 + 资质通过且未过期            MERCHANT_INELIGIBLE
 *        §10 商户服务城市覆盖楼盘城市              MERCHANT_INELIGIBLE
 *
 *      OPT-034 起 §8 的半开区间关系（listing_merchant_relations，[effectiveFrom,
 *      effectiveTo) 判定生效商户）已删除：供给商户直接取自 listings.merchant，
 *      不再有"关系尚未生效 / 已过期"这层时间窗口——字段有值即视为已设置。
 *
 *   3) 举报暂停谓词（M6.2 新增，§5）：
 *        - listingReportPauseWhere()        返回 listing-reports 的 where 条件
 *        - getPausedListingIds(payload)     查询 listing-reports，返回被暂停的 listing IDs
 *        - isListingPaused(pausedIds, id)   判断 listing 是否在暂停列表中
 *        - extractPausedListingIds(reports) 从已查询的 reports 数组提取 listing IDs（便于测试）
 *
 * 无 payload / React 依赖，可独立单测。查询层用 where 片段先粗筛，
 * 已解析的候选再过 isListingEffectivelySupplied 精筛（媒体/关系/商户）。
 */

import { checkMerchantEligibility } from '@/domain/supply/building-merchant-relation'
import { getListingPublicBuildingWhere } from '@/domain/supply/public-building'

/**
 * 媒体数量**不再是**前台可见性条件（2026-08-19 用户决定）。
 *
 * 原 design §6「有效媒体 ≥ 3」曾同时是三道门：前台可见、提交审核必填、已上架地板。
 * 现在只剩**提交审核必填**一道（`listing-completeness.ts` 的 `MIN_SUBMIT_MEDIA`）。
 * 无图房源照常在 C 端曝光，卡片与详情页走缺省图降级（`ui/Media.tsx`、`DetailGallery`）。
 *
 * 因此本模块不再有 `MIN_EFFECTIVE_MEDIA` / `INSUFFICIENT_MEDIA`——它们一旦留着，
 * 就会有人以为前台还在按图片数筛，把口径重新叉开。SQL 侧的对应条件
 * （`supply-adapter.ts` 的 `media` CTE 与 `g.n >= 3`）已一并去掉。
 */

/** 精筛层排除原因码（前端展示 / 诊断 / 审计）。 */
export const EFFECTIVE_SUPPLY_EXCLUSION_CODES = {
  /** 房源未设置供给商户（listings.merchant 为空） */
  NO_SUPPLY_MERCHANT: 'NO_SUPPLY_MERCHANT',
  /** 商户不合格（停用 / 资质无效或过期 / 服务城市不覆盖楼盘城市） */
  MERCHANT_INELIGIBLE: 'MERCHANT_INELIGIBLE',
} as const

export type EffectiveSupplyExclusionCode =
  (typeof EFFECTIVE_SUPPLY_EXCLUSION_CODES)[keyof typeof EFFECTIVE_SUPPLY_EXCLUSION_CODES]

/** 有效供给谓词的可选收窄条件。 */
export interface EffectiveSupplyScope {
  /**
   * 只保留指定租售类型。**不传则不过滤**（保持改造前行为）。
   *
   * 刻意不设默认值：谓词回答的是「这套房源合不合格」，租售是另一个维度。给它一个
   * 隐式默认（比如默认排除 sale）会让出售频道的开发者踩坑——查不到数据但看不出
   * 原因。显式参数在类型层可见，每个调用点必须自己声明意图：
   *
   *   - 租赁列表 / 首页精选 / 在租面积聚合  → 'lease'
   *   - 出售频道列表                        → 'sale'
   *   - 楼盘详情页供给分组 / sitemap        → 不传（需要全集，自己分组）
   *   - 相关推荐                            → 跟随当前房源的 businessType
   */
  businessType?: 'lease' | 'sale'
}

/**
 * 查询层可表达的有效供给正向谓词（fail-closed）。
 * @param _asOf 判定基准时刻（当前查询层条件与时刻无关，保留参数以便未来接入时间敏感条件）。
 * @param scope 可选收窄条件；不传时行为与改造前一致。
 */
export function getEffectiveSupplyWhere(
  _asOf: Date,
  scope?: Readonly<EffectiveSupplyScope>,
): Record<string, Readonly<{ equals: string }> | Readonly<{ exists: false }>> {
  return {
    deletedAt: { exists: false },
    publicationStatus: { equals: 'published' },
    reviewStatus: { equals: 'approved' },
    supplyVisibilityHold: { equals: 'normal' },
    ...getListingPublicBuildingWhere(),
    // 正向 equals 而非 not_equals：后者遇到 NULL 会返回 NULL 而非 true，历史行会
    // 静默漏网。业务上 business_type 加列时带 DEFAULT 'lease' 已回填既有行，批次 2
    // 的迁移再补一次残留 NULL 回填，批次 3 改必填后彻底闭环。
    ...(scope?.businessType ? { businessType: { equals: scope.businessType } } : {}),
  }
}

/**
 * 精筛层入参：房源已解析的供给商户快照。
 *
 * OPT-034 起商户直接取自 listings.merchant，不再经由 listing-merchant-relations
 * 关系表解析——`merchant` 为 null 意味着房源未设置供给商户（§8 NO_SUPPLY_MERCHANT），
 * 非 null 时进入 §9-§10 商户合格性判定。
 */
export interface EffectiveSupplySnapshot {
  merchant: {
    /** 商户 id（用于诊断 / 审计回显；判定本身不依赖它） */
    id: number | string | null
    /** 商户启停状态 */
    status: unknown
    /** 商户资质状态 */
    qualificationStatus: unknown
    /** 资质到期时刻；null 视为无到期日 */
    qualificationExpiresAt: string | Date | null | undefined
    /** 商户服务城市 id 列表 */
    serviceCityIds: ReadonlyArray<number | string>
  } | null
  /** 楼盘所在城市 id */
  buildingCityId: number | string | null | undefined
}

export interface EffectiveSupplyResult {
  eligible: boolean
  reasons: EffectiveSupplyExclusionCode[]
}

/**
 * 已解析候选是否满足查询层无法表达的有效供给条件（关系 §8 / 商户 §9-§10）。
 * 收集全部不满足原因，便于一次性提示。查询层条件（§1-§4、§7）由
 * getEffectiveSupplyWhere 在库侧保证，本函数不重复判定。
 *
 * 媒体数量已不在此列：见文件头部说明。
 */
export function isListingEffectivelySupplied(
  snapshot: EffectiveSupplySnapshot,
  asOf: Date,
): EffectiveSupplyResult {
  const reasons: EffectiveSupplyExclusionCode[] = []

  // §8 房源必须已设置供给商户（listings.merchant 非空）。没有商户就没有后续
  // 资格数据可判，直接短路返回——不再有"关系尚未生效 / 已过期"的中间态。
  if (snapshot.merchant === null) {
    reasons.push(EFFECTIVE_SUPPLY_EXCLUSION_CODES.NO_SUPPLY_MERCHANT)
    return { eligible: false, reasons }
  }

  // §9-§10 商户启用 + 资质有效 + 服务城市覆盖楼盘城市
  const merchantCheck = checkMerchantEligibility({
    status: snapshot.merchant.status,
    qualificationStatus: snapshot.merchant.qualificationStatus,
    qualificationExpiresAt: snapshot.merchant.qualificationExpiresAt,
    serviceCityIds: snapshot.merchant.serviceCityIds,
    buildingCityId: snapshot.buildingCityId,
    now: asOf,
  })
  if (!merchantCheck.eligible) {
    reasons.push(EFFECTIVE_SUPPLY_EXCLUSION_CODES.MERCHANT_INELIGIBLE)
  }

  return { eligible: reasons.length === 0, reasons }
}

// ────────────────────────────────────────────────────────────
// M6.2 举报暂停谓词（design §5 第 5 条：未被有效举报暂停）
// ────────────────────────────────────────────────────────────

/**
 * Payload Local API 查询端口（最小化接口，便于测试 mock）。
 *
 * 仅暴露 find 方法，用于查询 listing-reports 中 supplyPaused=true 的记录。
 * 真实环境由 Payload req.payload 提供；测试用 mock 实现。
 */
export interface PayloadQueryPort {
  find: (params: {
    collection: string
    where: Record<string, unknown>
    /** 关联深度：0 表示只返回 ID；缺省由实现决定 */
    depth?: number
    /** 返回条数上限 */
    limit?: number
    /** Payload 分页页码（从 1 开始） */
    page?: number
    /** 排序字段 */
    sort?: string
    /** 是否绕过 access（用于内部查询） */
    overrideAccess?: boolean
    /** 可选的 Payload 请求上下文 */
    req?: unknown
  }) => Promise<{
    docs: Array<Record<string, unknown> & PausedReportLike>
    hasNextPage?: boolean
    nextPage?: number | null
    page?: number
    totalPages?: number
  }>
}

/** 举报记录的最小读模型（用于 extractPausedListingIds）。 */
export interface PausedReportLike {
  /** 被举报房源 ID 或完整对象 */
  targetListing?: string | number | { id: string | number } | null
}

/**
 * listing-reports 的"已暂停供给"where 片段（design §5 第 5 条）。
 *
 * 返回正向谓词 `supplyPaused: { equals: true }`：fail-closed，
 * 只匹配显式标记为暂停的举报。调用方在查询 listing-reports 时使用此 where，
 * 拿到 docs 后通过 extractPausedListingIds 提取 listing IDs。
 *
 * 注意：举报是独立 collection，不是 listings 字段。调用方需要：
 *   ```ts
 *   const pausedIds = await getPausedListingIds(payload)
 *   const listings = await payload.find({
 *     collection: 'listings',
 *     where: { id: { not_in: pausedIds }, ...getEffectiveSupplyWhere(asOf) },
 *   })
 *   ```
 */
export function listingReportPauseWhere(): Record<string, unknown> {
  return {
    supplyPaused: { equals: true },
  }
}

/**
 * 从已查询的 reports 数组提取 targetListing ID 列表（去重）。
 *
 * 处理 targetListing 的两种形态：
 *   - number | string（Payload depth=0 时返回 ID）
 *   - { id: string | number }（Payload depth≥1 时返回完整对象）
 *
 * 同步纯函数，便于单测；getPausedListingIds 内部调用此函数。
 */
export function extractPausedListingIds(
  reports: ReadonlyArray<PausedReportLike>,
): Array<string | number> {
  const ids = new Set<string | number>()
  for (const r of reports) {
    const tl = r?.targetListing
    if (tl === null || tl === undefined) continue
    if (typeof tl === 'string' || typeof tl === 'number') {
      ids.add(tl)
      continue
    }
    if (typeof tl === 'object' && 'id' in tl && tl.id !== null && tl.id !== undefined) {
      ids.add(tl.id)
    }
  }
  return [...ids]
}

/**
 * 查询 listing-reports 中 supplyPaused=true 的所有举报，返回 targetListing IDs。
 *
 * 调用方在查询 listings 时使用 `id: { not_in: pausedIds }` 排除这些房源。
 *
 * 实现细节：
 *   - 使用 listingReportPauseWhere() 作为查询条件
 *   - depth=0 只返回 ID（避免加载完整文档）
 *   - overrideAccess=true 绕过 read 权限（C 端公开查询不应受客服权限限制）
 *   - limit=1000 兜底（超过的暂停举报属于异常情况，需人工介入）
 */
export async function getPausedListingIds(
  payload: PayloadQueryPort,
): Promise<Array<string | number>> {
  const ids = new Set<string | number>()
  let page = 1

  for (;;) {
    // Any page failure intentionally propagates. Callers must not publish a
    // partial exclusion set because that would make paused supply visible.
    const result = await payload.find({
      collection: 'listing-reports',
      where: listingReportPauseWhere(),
      depth: 0,
      limit: 1000,
      page,
      overrideAccess: true,
    })
    for (const id of extractPausedListingIds(result.docs)) ids.add(id)

    const nextPage =
      typeof result.nextPage === 'number'
        ? result.nextPage
        : result.hasNextPage
          ? page + 1
          : null
    if (nextPage === null || nextPage <= page) break
    page = nextPage
  }

  return [...ids]
}

/**
 * 判断指定 listing 是否在暂停列表中。
 *
 * 用于已查询 listings 候选后再过滤（如实时预览场景），避免在数据库层
 * 用 not_in 大列表过滤。
 *
 * 入参 pausedIds 应来自 getPausedListingIds 结果。
 */
export function isListingPaused(
  pausedIds: ReadonlyArray<string | number>,
  listingId: string | number,
): boolean {
  for (const id of pausedIds) {
    if (typeof id === 'string' && typeof listingId === 'string') {
      if (id === listingId) return true
      continue
    }
    if (typeof id === 'number' && typeof listingId === 'number') {
      if (id === listingId) return true
      continue
    }
    // 跨类型比较：转字符串后比较（兼容 number ID 与 string ID 混用场景）
    if (String(id) === String(listingId)) return true
  }
  return false
}
