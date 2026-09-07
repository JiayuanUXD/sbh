import type {
  AccessArgs,
  CollectionAfterChangeHook,
  CollectionAfterDeleteHook,
  CollectionConfig,
  Field,
  PayloadRequest,
} from 'payload'
import {
  tagsForLocationVisibilityChange,
  type CityCacheInvalidationRecord,
} from '@/domain/city-site-profile/cache-invalidator'
import { normalizeCitySlug } from '@/domain/city-site-profile/resolver'
import { findByIdSafe } from '@/domain/shared/transaction-safety'
import { getPermissionContext, type RequestContext } from '@/domain/auth/access'
import {
  hasMenuPermission,
  hasOperationPermission,
} from '@/domain/auth/permission-context'
import { GEOGRAPHY_MENU_CODES } from '@/domain/geography/geography-menu-codes'
import {
  LOCATION_TYPES,
  LOCATION_TYPE_LABELS,
} from '@/domain/geography/location-hierarchy'
import { protectLocation } from '@/domain/geography/location-protect'
import { protectLocationDelete } from '@/domain/geography/location-delete-guard'
import { createLocationReferencesEndpoint } from '@/endpoints/location-references-endpoint'
import { createLocationSearchEndpoint } from '@/endpoints/location-search-endpoint'
import { createLocationTreeEndpoint } from '@/endpoints/location-tree-endpoint'
import { invalidateCitySiteProfilePublicCache } from '@/lib/frontend/public-cache-revalidation'

type Identifier = number | string

type LocationCacheRecord = CityCacheInvalidationRecord & Readonly<{
  name?: unknown
  parent?: unknown
  status?: unknown
  frontendVisible?: unknown
  coverImage?: unknown
}>

const PUBLIC_LOCATION_FIELDS = [
  'name',
  'slug',
  'type',
  'status',
  'frontendVisible',
  'city',
  'parent',
  // OPT-060：首页商圈卡的背景图。漏在表外时，运营只改封面不会打任何失效标签,
  // 首页只能等 unstable_cache 自然过期。它是 upload 关系字段，故与 city/parent
  // 一样走 relationshipId 比较（见 fieldChanged）。
  'coverImage',
] as const

function relationshipId(value: unknown): Identifier | null {
  if (typeof value === 'number' || typeof value === 'string') return value
  if (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    (typeof value.id === 'number' || typeof value.id === 'string')
  ) {
    return value.id
  }
  return null
}

function toLocationCacheRecord(value: unknown): LocationCacheRecord | null {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('id' in value) ||
    (typeof value.id !== 'number' && typeof value.id !== 'string')
  ) {
    return null
  }
  return {
    id: value.id,
    city: 'city' in value ? value.city : undefined,
    coverImage: 'coverImage' in value ? value.coverImage : undefined,
    frontendVisible: 'frontendVisible' in value ? value.frontendVisible : undefined,
    name: 'name' in value ? value.name : undefined,
    parent: 'parent' in value ? value.parent : undefined,
    slug: 'slug' in value ? value.slug : undefined,
    status: 'status' in value ? value.status : undefined,
    type: 'type' in value ? value.type : undefined,
  }
}

function fieldChanged(
  field: (typeof PUBLIC_LOCATION_FIELDS)[number],
  current: LocationCacheRecord,
  previous: LocationCacheRecord,
): boolean {
  // 三者都是关系字段：depth 不同时可能是裸 id，也可能是展开后的对象，
  // 直接 Object.is 会把「同一个目标」判成变了。
  if (field === 'city' || field === 'parent' || field === 'coverImage') {
    return String(relationshipId(current[field]) ?? '') !== String(relationshipId(previous[field]) ?? '')
  }
  return !Object.is(current[field], previous[field])
}

function affectsPublicCityCache(
  current: LocationCacheRecord,
  previous: LocationCacheRecord | null,
): boolean {
  if (!previous) return true
  return PUBLIC_LOCATION_FIELDS.some((field) => fieldChanged(field, current, previous))
}

async function resolveOwningCitySlug(
  req: PayloadRequest,
  record: LocationCacheRecord,
): Promise<string | null> {
  if (record.type === 'city') return normalizeCitySlug(record.slug)

  if (typeof record.city === 'object' && record.city !== null && 'slug' in record.city) {
    const populatedSlug = normalizeCitySlug(record.city.slug)
    if (populatedSlug) return populatedSlug
  }

  const cityId = relationshipId(record.city)
  if (cityId === null) return null

  // findByIdSafe 而不是 try/catch 吞 NotFound：后者会连带回滚调用方的写入事务
  // （原因与实测见 domain/shared/transaction-safety.ts）
  const city = await findByIdSafe<{ type?: unknown; slug?: unknown }>({
    req,
    collection: 'locations',
    id: cityId,
    depth: 0,
    operation: 'locations-cache:location',
  })
  if (!city) return null
  return city.type === 'city' ? normalizeCitySlug(city.slug) : null
}

const invalidateLocationCityCache: CollectionAfterChangeHook = async ({
  doc,
  previousDoc,
  req,
}) => {
  const current = toLocationCacheRecord(doc)
  const previous = toLocationCacheRecord(previousDoc)
  if (!current || !affectsPublicCityCache(current, previous)) return doc

  const tags = new Set<string>()
  for (const record of [current, previous]) {
    if (!record) continue

    const citySlug = await resolveOwningCitySlug(req, record)
    if (!citySlug) {
      console.error('[city-profile-cache-invalidation] city_unresolved', {
        objectId: record.id,
        errorCode: 'city_slug_unresolved',
      })
    }
    for (const tag of tagsForLocationVisibilityChange(
      citySlug ? { ...record, citySlug } : record,
    )) {
      tags.add(tag)
    }
  }

  invalidateCitySiteProfilePublicCache([...tags], 'location')
  return doc
}

const invalidateDeletedLocationCityCache: CollectionAfterDeleteHook = async ({ doc, req }) => {
  const deleted = toLocationCacheRecord(doc)
  if (!deleted) return doc

  const citySlug = await resolveOwningCitySlug(req, deleted)
  if (!citySlug) {
    console.error('[city-profile-cache-invalidation] city_unresolved', {
      objectId: deleted.id,
      errorCode: 'city_slug_unresolved',
    })
  }

  invalidateCitySiteProfilePublicCache(
    tagsForLocationVisibilityChange(citySlug ? { ...deleted, citySlug } : deleted),
    'location',
  )
  return doc
}

/** 从固定枚举生成 select options，保持类型与标签单一真源 */
const TYPE_OPTIONS = LOCATION_TYPES.map((value) => ({
  label: LOCATION_TYPE_LABELS[value],
  value,
}))

/**
 * 写侧准入（2026-09-08 收口）
 *
 * 此前本集合只写了 `read`，create/update/delete 落到 Payload 3.86 的 `defaultAccess`
 * （`collections/config/sanitize.js`，判据仅 `Boolean(req.user)`）——**任何登录账号**
 * （经纪人、客服都算）都能通过 REST/GraphQL 增删改城市 / 行政区 / 商圈 / 地铁线路 / 站点。
 * 自定义视图的 `requireGeographyAccess` 只挡 `/admin/geography/*` 这四个页面路由，
 * 挡不住直接打 `/api/locations`。同族缺陷：BusinessAreaExtensions（2026-09-07 已收）、
 * OPT-051（collection 缺 delete）、OPT-053/055（Global 缺 update）。
 *
 * 危害面比商圈扩展大：地理树是楼盘、房源、线索、账号城市范围、城市站点配置的公共上游。
 */

/**
 * create / update：地理菜单码任一命中，或显式持有 `location:manage`。
 *
 * 与 BusinessAreaExtensions 同口径，理由也同：内置角色里只有 ADM 持有 `location:manage`
 * （OPS 没有），而 OPS 有 `locations` / `business-areas` 两个菜单码、今天就在用
 * `/admin/geography/*` 四个模块维护地理数据——那些页面的新建与编辑走的正是客户端
 * `fetch('/api/locations', { method: 'POST' | 'PATCH' })`（GeographyCreateViewClient、
 * GeographyListViewClient、MetroLineStationsPanel），会实打实经过本函数。
 * 只认操作码等于把 OPS 打回 403，顺手砍掉运营现有能力。
 *
 * 并上 `location:manage`，让「有地理操作码但没配菜单码」的自定义角色不被误伤。
 */
async function canManageLocation(args: AccessArgs): Promise<boolean> {
  const ctx = await getPermissionContext(args.req as RequestContext)
  if (!ctx) return false
  if (hasOperationPermission(ctx, 'location:manage')) return true
  return GEOGRAPHY_MENU_CODES.some((code) => hasMenuPermission(ctx, code))
}

/**
 * delete：**只认 `location:manage`**，比 create/update 严一档。
 *
 * 为什么不跟 create/update 同口径：
 *   - 本仓库 `payload.delete` 恒为物理删除（无软删，`trash` 只是查询过滤器），
 *     而地理节点是业务上游，删掉不可恢复；
 *   - `beforeDelete` 的 `protectLocationDelete` 只挡**有引用**的节点（抛
 *     `LOCATION_REFERENCED`），**无引用的叶子仍会被真删**——保护 hook 不是准入控制；
 *   - 四个地理模块页面里根本没有删除入口（`protectLocationDelete` 的注释写着
 *     「MVP 不提供删除入口」，已逐个 grep 确认 UI 无删除按钮），OPS 今天的能力里
 *     本来就不含删除。收到 `location:manage` **不减少任何在用能力**，只是把
 *     「绕过 UI 直接打 REST DELETE」这条路从「所有拿到地理菜单的人」收回给 ADM。
 *
 * 为什么不干脆 `() => false`：`immutableCode` 全局唯一、创建后不可改
 * （`protectLocation` 抛 `IMMUTABLE_CODE`），`type` 同理。录错代码时唯一的补救就是
 * 删掉重建——「停用」救不了，那个代码仍被占着。把最后这条通道关死等于逼人直接改库，
 * 比留给 ADM 更糟。PRD L113/L114 的口径是「**有引用**只能停用不能删」，
 * 也不是「一律不许删」。
 *
 * 当前只有 ADM（`operationPermissions: ['*']`）能通过，**无需迁移**：通配符由
 * `hasOperationPermission` 内部处理。将来要放给 OPS，走迁移授权 + 同步
 * `src/test/factory/roles.ts`（不同步会被 seed 擦掉，见 OPT-045 §9 的实测教训）。
 */
async function canDeleteLocation(args: AccessArgs): Promise<boolean> {
  const ctx = await getPermissionContext(args.req as RequestContext)
  if (!ctx) return false
  return hasOperationPermission(ctx, 'location:manage')
}

export const Locations: CollectionConfig = {
  slug: 'locations',
  labels: {
    singular: '区域',
    // Task 16：地理管理重构后 locations 不再出现在导航，plural 仅用于面包屑等，
    // 改为中性「地理数据」（排障兜底列表的入口仍在）。
    plural: '地理数据',
  },
  // 自定义端点挂 collection（不能放顶层 config.endpoints，否则被 slug 路由遮蔽 → 404）。
  endpoints: [
    // M2.2 区域引用数量：GET /api/locations/:id/references
    createLocationReferencesEndpoint(),
    // Task 13 全局搜索：GET /api/locations/search?q=&limit=
    createLocationSearchEndpoint(),
    // OPT-074 级联选择数据源：GET /api/locations/tree
    createLocationTreeEndpoint(),
  ],
  admin: {
    group: false,
    pagination: { defaultLimit: 25, limits: [10, 25, 50, 100] },
    useAsTitle: 'name',
    defaultColumns: ['name', 'type', 'immutableCode', 'parent', 'status', 'sortOrder'],
  },
  access: {
    // 读侧维持公开：C 端城市/商圈/地铁的展示直接依赖它，不能动。
    read: () => true,
    // 见上方 canManageLocation / canDeleteLocation 的注释：这三条缺一条
    // 就等于对所有登录账号开放对应动作。
    create: canManageLocation,
    update: canManageLocation,
    delete: canDeleteLocation,
  },
  hooks: {
    beforeChange: [protectLocation],
    afterChange: [invalidateLocationCityCache],
    afterDelete: [invalidateDeletedLocationCityCache],
    // M2.2 被引用节点保护：有下级或业务引用时禁止物理删除（PRD L114/L125）
    beforeDelete: [protectLocationDelete],
  },
  fields: [
    {
      type: 'row',
      fields: [
        {
          name: 'name',
          label: '名称',
          type: 'text',
          required: true,
        },
        {
          name: 'immutableCode',
          label: '区域代码',
          type: 'text',
          required: true,
          unique: true,
          admin: {
            readOnly: true,
            description: '全局唯一，创建后不可修改（大写字母/数字开头，2–64 位）',
          },
        },
      ],
    },
    {
      type: 'row',
      fields: [
        {
          name: 'slug',
          label: 'URL 标识',
          type: 'text',
          required: true,
          unique: true,
        },
        {
          name: 'type',
          label: '类型',
          type: 'select',
          required: true,
          options: TYPE_OPTIONS,
          admin: {
            readOnly: true,
            description: '固定层级：城市>行政区>商圈；城市>地铁线路>地铁站。创建后不可修改。',
          },
        },
      ],
    },
    {
      name: 'parent',
      label: '上级区域',
      type: 'relationship',
      relationTo: 'locations',
      admin: {
        // Task 14：城市无上级，非 city 才显示
        condition: (data: { type?: unknown }) => data?.type !== 'city',
        description: '类型决定合法上级；移动不可跨城市。城市无上级。',
      },
    },
    // 反范式城市字段：解锁「按城市」索引查询，避免逐级上溯解析归属城市。
    // 语义约定（后续所有查询都依赖，勿手写各处）：
    //   - 非 city 节点：city = 所属城市 id（由 protectLocation hook 在 beforeChange 写入）
    //   - city 节点自身：city 留空，不自引用（创建时自身 id 未知，自引用需 afterChange 回写，
    //     活动部件更多、失败模式更隐蔽，故不自引用）
    //   - 「某城市的全部节点（含城市自身）」必须走 cityScopeWhere() 辅助函数（location-city.ts），
    //     条件为 { or: [{ id: equals cityId }, { city: equals cityId }] }，不要各处手写。
    // 关键前提：protectLocation 已有「移动不可跨城市」硬约束 -> 节点归属城市一经创建永不改变 ->
    // city 字段不需要任何级联更新逻辑。只读：UI 不可编辑，由系统维护。
    {
      name: 'city',
      label: '所属城市',
      type: 'relationship',
      relationTo: 'locations',
      index: true,
      admin: {
        readOnly: true,
        description: '由系统按层级自动维护；城市节点本身留空（其城市即自身）。',
      },
    },
    {
      type: 'row',
      fields: [
        {
          name: 'status',
          label: '状态',
          type: 'select',
          required: true,
          defaultValue: 'active',
          options: [
            { label: '启用', value: 'active' },
            { label: '停用', value: 'disabled' },
          ],
          admin: {
            description: '停用后不出现在新业务候选，但历史引用仍展示。',
          },
        },
        {
          name: 'frontendVisible',
          label: '前台可见',
          type: 'checkbox',
          defaultValue: false,
          admin: {
            description: '仅启用节点可设为可见；停用时强制不可见。',
          },
        },
      ],
    },
    {
      type: 'row',
      fields: [
        {
          name: 'centerLatitude',
          label: '中心纬度',
          type: 'number',
          admin: {
            description: '-90 ~ 90，需与经度成对填写',
          },
        },
        {
          name: 'centerLongitude',
          label: '中心经度',
          type: 'number',
          admin: {
            description: '-180 ~ 180，需与纬度成对填写',
          },
        },
      ],
    },
    {
      name: 'description',
      label: '区域介绍',
      type: 'textarea',
      admin: {
        // Task 14：仅商圈与行政区有区域介绍
        condition: (data: { type?: unknown }) =>
          data?.type === 'business_area' || data?.type === 'district',
      },
    },
    {
      name: 'coverImage',
      label: '封面图',
      type: 'upload',
      relationTo: 'media',
      admin: {
        condition: (data: { type?: unknown }) =>
          data?.type === 'business_area' || data?.type === 'district',
        description:
          '首页商圈卡的背景图。留空时前台回退为该商圈下首个有封面的楼盘图片。',
      },
    },
    {
      type: 'row',
      fields: [
        {
          name: 'sortOrder',
          label: '排序',
          type: 'number',
          defaultValue: 100,
          validate: (val: unknown) => {
            if (val === null || val === undefined) return true
            if (typeof val !== 'number' || !Number.isInteger(val) || val < 0) {
              return '排序必须为非负整数'
            }
            return true
          },
        },
        {
          name: 'version',
          label: '版本号',
          type: 'number',
          defaultValue: 1,
          admin: {
            readOnly: true,
          },
        },
      ],
    },
    {
      // 商圈空间扩展面板（Task 11）：内嵌进商圈编辑页，替代「商圈管理」独立页。
      // 条件只按 type 收敛（不看 id）：新建商圈无 id 时由面板自身提示「保存后可配置空间信息」。
      name: 'businessAreaExtension',
      type: 'ui',
      admin: {
        condition: (data: { type?: unknown }) => data?.type === 'business_area',
        components: { Field: '/components/admin/BusinessAreaExtensionPanel' },
      },
    } as unknown as Field,
    {
      // 地铁线路的站点内嵌面板（Task 12）：内嵌进地铁线路编辑页，维护该线路全部站点。
      // 必须有 id 才展示：新建线路无 id 时没有站点可列，由面板自身在无 id 时返回 null。
      name: 'metroLineStations',
      type: 'ui',
      admin: {
        condition: (data: { type?: unknown; id?: unknown }) =>
          data?.type === 'metro_line' && Boolean(data?.id),
        components: { Field: '/components/admin/MetroLineStationsPanel' },
      },
    } as unknown as Field,
  ],
}
