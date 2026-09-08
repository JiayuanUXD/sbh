import type { CollectionConfig } from 'payload'
import { createLocationFieldGuard } from '@/domain/geography/location-field-guard'
import { locationTypeFilter } from '@/domain/geography/location-hierarchy'
import { EMPLOYMENT_STATUS_LABELS, EMPLOYMENT_STATUSES } from '@/domain/auth/org'
import { protectBroker } from '@/domain/auth/broker-protect'
import { protectBrokerStop } from '@/domain/auth/broker-stop-guard'
import { createCollectionAccess } from '@/domain/auth/access'

const STATUS_OPTIONS = EMPLOYMENT_STATUSES.map((value) => ({
  label: EMPLOYMENT_STATUS_LABELS[value],
  value,
}))

/**
 * 写侧准入（2026-09-08 收口）
 *
 * 此前只写了 `read`，其余三个动作落到 Payload 3.86 的 `defaultAccess`
 * （判据仅 `Boolean(req.user)`）——任何登录账号都能新建、改写、物理删除经纪人档案。
 *
 * create/update 用操作码 `broker:manage` 而不是菜单码：这个码精确表达了该动作，
 * 且真正干这活的 MGR（销售主管，职责含「经纪人绩效」）**已经持有**它。菜单码
 * `brokers` 的持有者也正好是 ADM 与 MGR，两种口径结果相同——这种时候优先用操作码
 * （判据更精确，将来调整授权只需改角色而不必动导航）。
 */
export const Brokers: CollectionConfig = {
  slug: 'brokers',
  labels: {
    singular: '经纪人',
    plural: '经纪人管理',
  },
  admin: {
    group: false,
    pagination: { defaultLimit: 25, limits: [10, 25, 50, 100] },
    useAsTitle: 'displayName',
    defaultColumns: ['displayName', 'user', 'team', 'employmentStatus'],
  },
  access: {
    // 读侧维持公开：C 端房源详情要展示负责经纪人。
    read: () => true,
    create: createCollectionAccess({ create: 'broker:manage' }).create,
    update: createCollectionAccess({ update: 'broker:manage' }).update,
    /**
     * 一律禁止物理删除。
     *
     * 三条事实叠在一起才是理由，缺一条我都不会关死：
     *   1. 本仓库 `payload.delete` 恒为硬删，删完不可恢复；
     *   2. **本表没有任何 `beforeDelete` 守卫**（不像 Locations 有
     *      `protectLocationDelete`），删除完全不做引用检查；
     *   3. 全仓库没有任何代码删本表，所以关死不夺走任何在用能力。
     *
     * 产品口径也不是删：`lead_ownership_history` 的
     * `from_owner_id` / `to_owner_id` 外键都是 `ON DELETE SET NULL`，而那张表自己
     * 写着「append-only：归属历史不可修改、不可物理删除」——删一个经纪人会把线索
     * 转派轨迹的两端静默清空，等于从后门废掉那条保证。`leads.owner_id`、
     * `follow_ups.broker_id`、`listings.contact_broker_id` 同样是 SET NULL。
     * 经纪人离职的设计答案是 `employmentStatus` 停用（`protectBrokerStop` 会数引用）。
     */
    delete: () => false,
  },
  hooks: {
    // 先跑业务校验（user 唯一/城市/商圈/团队/版本），再跑停用守卫（未完成线索）
    beforeChange: [
      // OPT-074：服务商圈只校验类型与启用。「必须落在 serviceCities 之内」是
      // 多值对多值的关系，parentField 表达不了；组件层用 scopeCitiesField 裁剪候选。
      createLocationFieldGuard([
        { field: 'serviceCities', type: 'city', many: true, label: '服务城市' },
        { field: 'serviceBusinessAreas', type: 'business_area', many: true, label: '服务商圈' },
      ]),
      protectBroker,
      protectBrokerStop,
    ],
  },
  fields: [
    {
      type: 'row',
      fields: [
        {
          name: 'displayName',
          label: '姓名',
          type: 'text',
          required: true,
          admin: {
            description: '经纪人展示名，可与账号姓名不同（对外昵称）',
          },
        },
        {
          name: 'user',
          label: '关联账号',
          type: 'relationship',
          relationTo: 'users',
          required: true,
          admin: {
            description: '一名用户至多绑定一个经纪人档案',
          },
        },
      ],
    },
    {
      type: 'row',
      fields: [
        {
          name: 'team',
          label: '所属团队',
          type: 'relationship',
          relationTo: 'teams',
        },
        {
          name: 'employmentStatus',
          label: '在职状态',
          type: 'select',
          required: true,
          defaultValue: 'active',
          options: STATUS_OPTIONS,
          admin: {
            description: '停用前若仍有未完成线索将被拦截，需先完成转派',
          },
        },
      ],
    },
    {
      name: 'serviceCities',
      label: '服务城市',
      type: 'relationship',
      relationTo: 'locations',
      hasMany: true,
      filterOptions: () => locationTypeFilter(['city']),
    },
    {
      name: 'serviceBusinessAreas',
      label: '服务商圈',
      type: 'relationship',
      relationTo: 'locations',
      hasMany: true,
      filterOptions: () => locationTypeFilter(['business_area']),
      // OPT-074：级联多选，候选按该经纪人的服务城市裁剪。
      // 只选叶子，故 changeOnSelect 关闭（组件按 selectableTypes 自行推导）。
      admin: {
        components: {
          Field: {
            path: '/components/admin/LocationCascadeField',
            clientProps: {
              selectableTypes: ['business_area'],
              many: true,
              scopeCitiesField: 'serviceCities',
              placeholder: '选择服务商圈',
            },
          },
        },
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
