/**
 * 新建表单的默认供给商户
 *
 * 运营在后台新建房源时，「供给商户」总要手动点一次同一个值。这里给它一个
 * 表单默认值，行为与「计价周期」默认「每月」一致：新建时预选，编辑既有文档不受影响
 * （Payload 的 `defaultValue` 只在字段值为 undefined 时生效，天然只作用于新建）。
 *
 * ⚠️ **这只是表单便利，不等于房源在前台可见。**
 * 前台有效供给判的是 `listing-merchant-relations` 里「当前有效」的关系记录，
 * 不是 `listings.merchant` 这个字段（两者没有同步逻辑）。而完整度校验用
 * `snapshot.merchant != null` **近似**判断「有没有有效商户关系」，所以填上这个字段
 * 会让完整度不再提示缺商户——但关系记录仍然不存在、前台仍然看不到。
 * 真实案例：生产 listing #2464「test08192325」已发布、自身条件全齐，
 * 却因 `listing_merchant_relations` 为 0 条而前台不可见。
 *
 * 因此本模块**只挑合格商户**（启用 + 资质有效）：默认值若指向一个停用商户，
 * 会让上述误导更深一层——完整度绿了、关系建了、前台还是不可见。
 *
 * 跨环境可移植：商户表没有稳定业务码（只有 name / type），所以按**名称**解析，
 * 并允许用 `DEFAULT_SUPPLY_MERCHANT_NAME` 覆盖。解析不到就不给默认值，
 * 绝不硬编码 id——生产的「官网」是 id=1，别的环境未必是。
 */

/** 默认供给商户名称；可用环境变量覆盖，缺省为「官网」。 */
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
}

/**
 * 从候选里挑出默认商户 id；没有合格候选返回 null。
 *
 * 只接受 `status=active` 且 `qualificationStatus=valid` 的商户：预选一个不合格的
 * 商户比不预选更糟——运营以为填好了，前台依然排除它（§9 商户不合格）。
 *
 * 纯函数，无 IO，便于单测。
 */
export function pickDefaultMerchant(
  candidates: ReadonlyArray<DefaultMerchantCandidate>,
): number | string | null {
  for (const c of candidates) {
    if (c.status !== 'active') continue
    if (c.qualificationStatus !== 'valid') continue
    if (c.id === null || c.id === undefined) continue
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

/**
 * 查库解析默认商户 id。
 *
 * `overrideAccess: true`：这是表单默认值，不该因为当前用户对 merchants 的读权限
 * 收窄就静默变成空——那会表现为「有的人有默认值、有的人没有」，极难排查。
 *
 * **任何异常都吞掉并返回 undefined**：默认值是锦上添花，绝不能因为它让整个
 * 新建表单加载失败。
 */
export async function resolveDefaultSupplyMerchant(
  payload: MerchantLookupPort,
  req?: unknown,
  env: Record<string, string | undefined> = process.env,
): Promise<number | string | undefined> {
  try {
    const name = getDefaultSupplyMerchantName(env)
    const result = await payload.find({
      collection: 'merchants',
      where: {
        name: { equals: name },
        status: { equals: 'active' },
        qualificationStatus: { equals: 'valid' },
      },
      depth: 0,
      limit: 1,
      overrideAccess: true,
      req,
    })
    return pickDefaultMerchant(result.docs ?? []) ?? undefined
  } catch {
    return undefined
  }
}
