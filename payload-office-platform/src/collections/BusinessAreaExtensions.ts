import type { AccessArgs, CollectionConfig } from 'payload'
import { getPermissionContext, type RequestContext } from '@/domain/auth/access'
import {
  hasMenuPermission,
  hasOperationPermission,
} from '@/domain/auth/permission-context'
import { createLocationFieldGuard } from '@/domain/geography/location-field-guard'
import { activeLocationFilter, locationTypeFilter } from '@/domain/geography/location-hierarchy'
import { protectBusinessAreaExtension } from '@/domain/geography/business-area-extension-protect'
import { GEOGRAPHY_MENU_CODES } from '@/domain/geography/geography-menu-codes'

/**
 * 写侧准入（2026-09-07 收口）
 *
 * 缺 create/update/delete 时 Payload 3.86 会补上 `defaultAccess`
 * （`collections/config/sanitize.js`，判据仅 `Boolean(req.user)`）——任何登录账号
 * 都能改商圈边界 / 扩展中心点 / 别名 / 站点关联，delete 还是硬删（本仓库
 * `payload.delete` 恒为物理删除）。`admin.hidden` 只影响后台 UI，
 * REST/GraphQL 端点照常开放，挡不住这条路径。同族缺陷：OPT-051（collection 缺
 * delete）、OPT-053/055（Global 缺 update）。
 *
 * 为什么不是「只认 location:manage」：内置角色里只有 ADM 持有该操作码（OPS 没有），
 * 而 OPS 有 `business-areas` 菜单码、今天就在用「商圈管理」页里的内嵌面板配置扩展。
 * 只认操作码等于顺手砍掉运营的现有能力，把面板打回 403。
 *
 * 口径改为对齐**承载这张表的那个模块**：
 *   - 页面：`requireGeographyAccess(req, module.menuCodes)`（商圈模块为 `business-areas`）
 *   - 面板自己调的两个 endpoint：`GEOGRAPHY_MENU_CODES`（`locations` | `business-areas`）
 * 再并上 `location:manage`，让「有地理操作码但没配菜单码」的自定义角色不被误伤。
 */
async function canManageBusinessAreaExtension(args: AccessArgs): Promise<boolean> {
  const ctx = await getPermissionContext(args.req as RequestContext)
  if (!ctx) return false
  if (hasOperationPermission(ctx, 'location:manage')) return true
  return GEOGRAPHY_MENU_CODES.some((code) => hasMenuPermission(ctx, code))
}

/**
 * 商圈扩展（tasks.md M2.3 / PRD 02-02 商圈配置）
 *
 * 只承接商圈的空间与展示扩展：边界多边形、扩展中心点、别名、同城既有站点关联。
 * 基础字段（名称/代码/层级/启停/排序/可见性）由「城市区域」页唯一维护，本表不存储、
 * 只按不可变 ID 引用 → 「禁止在扩展页修改基础字段」由结构天然保证。
 *
 * 写侧不变量统一由 protectBusinessAreaExtension 把关（自身及祖先启用、同城站点、版本锁等）。
 */
export const BusinessAreaExtensions: CollectionConfig = {
  slug: 'business-area-extensions',
  labels: {
    singular: '商圈扩展',
    plural: '商圈管理',
  },
  admin: {
    // Task 11：从 Payload 自带导航隐藏，日常配置走「商圈管理」编辑页的内嵌面板
    // （BusinessAreaExtensionPanel）；collection、protect hook 与直接 URL 全部保留，
    // 排障时可打开 /admin/collections/business-area-extensions。
    //
    // 退出导航只用 `group: false`，**不能**再叠 `hidden: true`——两者差一个字，
    // 后果差很远，因为分属 `@payloadcms/ui` 里两套互不相干的机制：
    //   group: false → groupNavItems 跳过它 → 从侧边栏/仪表盘排除，路由仍可用
    //   hidden: true → getVisibleEntities 把它从 visibleEntities.collections 滤掉，
    //                  而 List/Document 两个 view 都在 `!visibleEntities.collections
    //                  .includes(slug)` 时 notFound() → 列表页和表单页一起 404
    // 与 OPT-053 里 Global 的 admin.hidden 是同一个坑。本文件此前两个字段同时写，
    // 注释还声称「直接 URL 仍可访问用于排障」，2026-09-06 实测证伪后移除 hidden。
    // 守卫：tests/admin-entity-route-visibility.test.ts。
    group: false,
    pagination: { defaultLimit: 25, limits: [10, 25, 50, 100] },
    useAsTitle: 'businessArea',
    defaultColumns: ['businessArea', 'boundary', 'aliases', 'updatedAt'],
    description: '本页仅供排障；日常配置请在「商圈管理」中打开对应商圈',
  },
  access: {
    // 边界/别名是 C 端地理展示的一部分，读侧维持公开（与 locations 同口径）。
    read: () => true,
    // 见文件头 canManageBusinessAreaExtension 的注释：这三条缺一条就等于对所有
    // 登录账号开放对应动作。
    create: canManageBusinessAreaExtension,
    update: canManageBusinessAreaExtension,
    delete: canManageBusinessAreaExtension,
  },
  hooks: {
    beforeChange: [
      // OPT-074：只管 businessArea 的类型与启用。metroStations 的同城校验、
      // businessArea 不可变、版本锁仍归 protectBusinessAreaExtension，职责不重叠。
      createLocationFieldGuard([
        { field: 'businessArea', type: 'business_area', label: '所属商圈' },
      ]),
      protectBusinessAreaExtension,
    ],
  },
  fields: [
    {
      name: 'businessArea',
      label: '所属商圈',
      type: 'relationship',
      relationTo: 'locations',
      required: true,
      unique: true,
      // 创建后不可改（保护 hook 兜底）。
      // OPT-074：status 移出 filterOptions（保存时它是硬校验，会误伤历史值），
      // 改由 createLocationFieldGuard 只校验本次改动的值。
      filterOptions: () => locationTypeFilter(['business_area']),
      // OPT-074：级联选择，逐级收窄到商圈
      admin: {
        description: '仅可选择已启用商圈；创建后不可更改。基础字段只读同步，不在此页编辑。',
        components: {
          Field: {
            path: '/components/admin/LocationCascadeField',
            clientProps: {
              selectableTypes: ['business_area'],
              placeholder: '选择所属商圈',
            },
          },
        },
      },
    },
    {
      name: 'boundary',
      label: '边界多边形',
      type: 'json',
      admin: {
        description: 'GeoJSON Polygon；外环须闭合、坐标合法且不自交。可留空。',
      },
    },
    {
      name: 'extendedCenterLatitude',
      label: '扩展中心纬度',
      type: 'number',
      admin: {
        description: '-90 ~ 90，需与经度成对填写；可留空。',
      },
    },
    {
      name: 'extendedCenterLongitude',
      label: '扩展中心经度',
      type: 'number',
      admin: {
        description: '-180 ~ 180，需与纬度成对填写；可留空。',
      },
    },
    {
      name: 'aliases',
      label: '别名',
      type: 'array',
      admin: {
        description: '单项 1–50 字，去首尾空格，同商圈内自动去重。',
      },
      fields: [
        {
          name: 'alias',
          label: '别名',
          type: 'text',
          required: true,
        },
      ],
    },
    {
      name: 'metroStations',
      label: '关联站点',
      type: 'relationship',
      relationTo: 'locations',
      hasMany: true,
      // 仅启用站点候选；同城校验在保护 hook（需解析商圈城市，属副作用）
      filterOptions: () => activeLocationFilter(['metro_station']),
      admin: {
        description: '仅可关联同城、已启用的既有地铁站；不改变站点基础属性。',
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
}
