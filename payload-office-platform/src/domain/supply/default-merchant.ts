/**
 * 平台自营（默认）供给商户
 *
 * 两个消费方：
 * 1. **后台新建表单的默认值** —— 运营新建房源 / 楼盘商户关系时预选，省掉每次手点。
 *    Payload 的 `defaultValue` 只在字段值为 undefined 时生效，天然只作用于新建。
 * 2. **批量导入的商户回落**（OPT-045）—— 楼盘没有生效供给商户时回落到本城市的
 *    平台自营商户，否则 §8 会把整批房源挡在前台之外。
 *
 * ## 解析条件（OPT-045 D2/D3）
 *
 * `isPlatformDefault` + `status=active` + 资质有效 + **`serviceCities` 覆盖目标城市**。
 *
 * **不再按名称解析。** 旧实现按名称找「官网」，其注释自己就承认「商户表没有稳定
 * 业务码（只有 name / type）」。一个名字尚可将就；D3 之后七城各有一个平台自营商户，
 * 靠名字约定同步必然漂，且失效方式是静默的——回落变成 null，房源导进来但前台隐身。
 *
 * ## 城市那条为什么必须在这里判，而不是甩给前台精筛
 *
 * 旧注释写着服务城市「由前台精筛 §10 兜底」。后台表单可以这样将就，因为运营会当场
 * 看到房源不出现；**导入不行**，一次几百条，没人逐条去前台核。不判的后果是把 404
 * 换个地方发生：房源写成 `published`、`merchant` 也填上了，前台照样看不见，
 * 只是原因码从 §8 变成 §10。这正是 OPT-041 终审 D10 踩过那个坑的翻版。
 *
 * 所以 `resolveDefaultSupplyMerchant` 接受一个可选的 `cityId`：
 * - **传了**（导入路径）：在 SQL 层就要求 `serviceCities` 含该城市，挑不到返回 undefined，
 *   由调用方判错误行并给出可操作文案；
 * - **没传**（后台表单默认值）：只挑「启用 + 资质有效」，行为与改动前一致。
 *
 * ## 一条已订正的过期说明
 *
 * 旧注释称「前台有效供给判的是 `listing-merchant-relations` 里的关系记录，不是
 * `listings.merchant` 这个字段」——**那张表已被 OPT-034 删除**，`listings.merchant`
 * 现在就是唯一真相（`supply-adapter.ts` 的 `JOIN merchants m ON m.id = l.merchant_id`
 * 是 INNER JOIN，NULL 直接排除）。`Listings.ts` 的对应注释早已订正，本文件此前没跟上。
 */

/**
 * 默认商户名称回落（**仅用于没有任何 `isPlatformDefault` 商户的旧环境**）。
 *
 * 保留它是为了让「迁移已上、但 D3 的数据变更还没跑」的环境不至于突然全线失去默认值。
 * 一旦目标环境标好了 `isPlatformDefault`，这条路径就不会被走到。
 */
export function getDefaultSupplyMerchantName(
  env: Record<string, string | undefined> = process.env,
): string {
  const raw = env.DEFAULT_SUPPLY_MERCHANT_NAME?.trim()
  return raw && raw.length > 0 ? raw : '官网'
}

/** 候选商户的最小读模型（只取判定需要的字段）。 */
export interface DefaultMerchantCandidate {
  id: number | string
  name?: unknown
  status?: unknown
  qualificationStatus?: unknown
  isPlatformDefault?: unknown
  serviceCities?: unknown
}

/** 从 relationship 值（可能是裸 id 或已展开文档）里抽 id。 */
function extractId(value: unknown): number | string | null {
  if (typeof value === 'number' || typeof value === 'string') return value
  if (typeof value === 'object' && value !== null && 'id' in value) {
    const id = (value as { id: unknown }).id
    if (typeof id === 'number' || typeof id === 'string') return id
  }
  return null
}

/** 候选的服务城市 id 集合（未展开 / 非数组一律视为空）。 */
export function serviceCityIdsOf(candidate: DefaultMerchantCandidate): Array<number | string> {
  const raw = candidate.serviceCities
  if (!Array.isArray(raw)) return []
  return raw.map(extractId).filter((id): id is number | string => id !== null)
}

/**
 * 从候选里挑出默认商户 id；没有合格候选返回 null。
 *
 * 只接受 `status=active` 且 `qualificationStatus=valid` 的商户：预选一个不合格的
 * 商户比不预选更糟——运营以为填好了，前台依然排除它（§9 商户不合格）。
 *
 * `cityId` 传入时额外要求 `serviceCities` 覆盖它（§10）。传 null / undefined 时
 * 跳过城市判定，保持后台表单默认值的旧行为。
 *
 * 纯函数，无 IO，便于单测。
 */
export function pickDefaultMerchant(
  candidates: ReadonlyArray<DefaultMerchantCandidate>,
  cityId?: number | string | null,
): number | string | null {
  for (const c of candidates) {
    if (c.status !== 'active') continue
    if (c.qualificationStatus !== 'valid') continue
    if (c.id === null || c.id === undefined) continue
    if (cityId !== null && cityId !== undefined) {
      const covered = serviceCityIdsOf(c).some((id) => String(id) === String(cityId))
      if (!covered) continue
    }
    return c.id
  }
  return null
}

/** Payload Local API 的最小查询端口（便于测试 mock）。 */
export interface MerchantLookupPort {
  find: (params: {
    collection: string
    where: Record<string, unknown>
    depth?: number
    limit?: number
    overrideAccess?: boolean
    req?: unknown
  }) => Promise<{ docs: DefaultMerchantCandidate[] }>
}

export interface ResolveDefaultSupplyMerchantOptions {
  /**
   * 目标城市 id。传入即启用 §10 判定（`serviceCities` 必须覆盖它）。
   * 导入路径**必须**传；后台表单默认值不传。
   */
  cityId?: number | string | null
  req?: unknown
  env?: Record<string, string | undefined>
}

/**
 * 查库解析平台自营商户 id。
 *
 * `overrideAccess: true`：这是表单默认值 / 系统级回落，不该因为当前用户对 merchants
 * 的读权限收窄就静默变成空——那会表现为「有的人有默认值、有的人没有」，极难排查。
 *
 * **任何异常都吞掉并返回 undefined**：对表单来说默认值是锦上添花，绝不能因为它让
 * 整个新建表单加载失败；对导入来说 undefined 会走到「判错误行」分支，也是安全的。
 *
 * 解析顺序：先按 `isPlatformDefault` 找；一个都没有（旧环境还没跑 D3 的数据变更）
 * 再按名称回落一次。两条路径都遵守同样的合格性与城市判定。
 */
export async function resolveDefaultSupplyMerchant(
  payload: MerchantLookupPort,
  reqOrOptions?: unknown,
  legacyEnv: Record<string, string | undefined> = process.env,
): Promise<number | string | undefined> {
  // 兼容两种调用形态：旧的 (payload, req, env) 与新的 (payload, options)。
  // 旧调用点（Listings / BuildingMerchantRelations 的 defaultValue）不必改签名。
  const options: ResolveDefaultSupplyMerchantOptions =
    reqOrOptions !== null &&
    typeof reqOrOptions === 'object' &&
    ('cityId' in reqOrOptions || 'req' in reqOrOptions || 'env' in reqOrOptions)
      ? (reqOrOptions as ResolveDefaultSupplyMerchantOptions)
      : { req: reqOrOptions, env: legacyEnv }

  const env = options.env ?? legacyEnv
  const cityId = options.cityId ?? null
  const req = options.req

  const baseWhere = {
    status: { equals: 'active' },
    qualificationStatus: { equals: 'valid' },
  }

  try {
    const byFlag = await payload.find({
      collection: 'merchants',
      where: { ...baseWhere, isPlatformDefault: { equals: true } },
      // depth:1 让 serviceCities 展开，§10 判定才有 id 可比
      depth: 1,
      limit: 50,
      overrideAccess: true,
      req,
    })
    const picked = pickDefaultMerchant(byFlag.docs ?? [], cityId)
    if (picked !== null) return picked

    // 旧环境回落：还没有任何 isPlatformDefault 商户时，按名称再找一次。
    // 已有标记但都不覆盖该城市 —— 那是真实的配置缺口，不该被名称路径掩盖。
    if ((byFlag.docs ?? []).length > 0) return undefined

    const byName = await payload.find({
      collection: 'merchants',
      where: { ...baseWhere, name: { equals: getDefaultSupplyMerchantName(env) } },
      depth: 1,
      limit: 1,
      overrideAccess: true,
      req,
    })
    return pickDefaultMerchant(byName.docs ?? [], cityId) ?? undefined
  } catch {
    return undefined
  }
}
