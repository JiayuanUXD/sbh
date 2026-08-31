import type { CollectionAfterChangeHook, CollectionConfig } from 'payload'
import { activeLocationFilter } from '@/domain/geography/location-hierarchy'
import {
  MERCHANT_STATUS_LABELS,
  MERCHANT_STATUSES,
  MERCHANT_TYPE_LABELS,
  MERCHANT_TYPES,
  QUALIFICATION_STATUS_LABELS,
  QUALIFICATION_STATUSES,
} from '@/domain/supply/merchant'
import { protectMerchant } from '@/domain/supply/merchant-protect'
import { protectMerchantStop } from '@/domain/supply/merchant-stop-guard'
import { markListingsPendingReviewOnMerchantStop } from '@/domain/supply/merchant-stop-listings'
import { assertTransactionIntact } from '@/domain/shared/transaction-safety'

/** 从固定枚举生成 select options，保持类型与标签单一真源 */
const TYPE_OPTIONS = MERCHANT_TYPES.map((value) => ({
  label: MERCHANT_TYPE_LABELS[value],
  value,
}))
const STATUS_OPTIONS = MERCHANT_STATUSES.map((value) => ({
  label: MERCHANT_STATUS_LABELS[value],
  value,
}))
const QUALIFICATION_OPTIONS = QUALIFICATION_STATUSES.map((value) => ({
  label: QUALIFICATION_STATUS_LABELS[value],
  value,
}))

/**
 * M4.8 商户停用冻结：商户 active → disabled 后批量标记关联 Listing 为待复核。
 *
 * 业务不变量（design §3.5 / R2 §56 / R4 / R8）：
 *   - 商户停用是合规动作，不应被 Listing 更新失败阻断
 *   - 失败详情写入 req.context.__merchantStopBatchReport，M8.2 审计接入时统一记录
 *   - 透传 req 保持事务一致性（任一 Listing 更新失败整体回滚）
 */
const handleMerchantStopBatchListings: CollectionAfterChangeHook = async ({
  doc,
  previousDoc,
  operation,
  req,
}) => {
  // 仅 update + active → disabled 时触发
  if (operation !== 'update') return doc
  const was = (previousDoc as { status?: string } | null)?.status
  const now = (doc as { status?: string } | null)?.status
  if (was !== 'active' || now !== 'disabled') return doc

  const merchantId = (doc as { id?: number | string } | null)?.id
  if (merchantId === undefined || merchantId === null) return doc

  const transactionId = req.transactionID
  try {
    const report = await markListingsPendingReviewOnMerchantStop(req.payload, merchantId, req)
    // 失败不阻断停用：把 report 挂到 req.context 供 M8.2 审计接入读取
    ;(req.context as Record<string, unknown>).__merchantStopBatchReport = report
  } catch (err) {
    // 服务整体失败（非单条 Listing 失败）：记录但不抛。
    // 唯一的例外是事务已被拆掉——那时商户自己那条 status=disabled 也不会落库，
    // 再吞就成了「停用成功、商户还是 active」（见 domain/shared/transaction-safety.ts）。
    assertTransactionIntact(req, transactionId, 'merchant-stop-batch')
    ;(req.context as Record<string, unknown>).__merchantStopBatchError =
      err instanceof Error ? err.message : String(err)
  }
  return doc
}

export const Merchants: CollectionConfig = {
  slug: 'merchants',
  labels: {
    singular: '商户',
    plural: '商户管理',
  },
  admin: {
    group: false,
    pagination: { defaultLimit: 25, limits: [10, 25, 50, 100] },
    useAsTitle: 'name',
    defaultColumns: ['name', 'type', 'status', 'qualificationStatus', 'qualificationExpiresAt'],
  },
  access: {
    read: () => true,
  },
  hooks: {
    // 先跑业务校验（类型/电话/服务城市/资质/版本），再跑停用影响保护
    beforeChange: [protectMerchant, protectMerchantStop],
    // M4.8 商户停用冻结：停用成功后批量标记关联 Listing 为待复核
    //   - 仅 active → disabled 时触发（其他状态变更不涉及）
    //   - 失败不阻断商户停用本身（保护止损：商户停用是高优先级合规动作）
    //   - 失败详情通过 req.context 传递，M8.2 接入审计时统一记录
    afterChange: [handleMerchantStopBatchListings],
  },
  fields: [
    {
      type: 'row',
      fields: [
        {
          name: 'name',
          label: '商户名称',
          type: 'text',
          required: true,
        },
        {
          name: 'type',
          label: '商户类型',
          type: 'select',
          required: true,
          options: TYPE_OPTIONS,
          admin: {
            description: '业主 / 中介 / 灵活办公品牌 / 渠道，创建后可改但属固定枚举',
          },
        },
      ],
    },
    {
      type: 'row',
      fields: [
        {
          name: 'contactName',
          label: '联系人',
          type: 'text',
        },
        {
          name: 'contactPhone',
          label: '联系电话',
          type: 'text',
          admin: {
            description: '中国大陆手机号，保存时自动规范化（去空格/横线/+86）',
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
      // 仅启用的城市节点进候选；停用城市不进新增，历史已存值仍展示
      filterOptions: () => activeLocationFilter(['city']),
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
          options: STATUS_OPTIONS,
          admin: {
            description: '停用前若仍有有效供给关系将被拦截，需先完成影响确认与转派',
          },
        },
        {
          name: 'qualificationStatus',
          label: '资质状态',
          type: 'select',
          required: true,
          defaultValue: 'pending',
          options: QUALIFICATION_OPTIONS,
        },
      ],
    },
    {
      /**
       * 平台自营商户标识（OPT-045 D2）。
       *
       * 批量导入在楼盘没有生效供给商户时，要回落到「平台自营」的那个商户，
       * 否则 §8（`listings.merchant` 非空）会把整批房源挡在前台之外。
       *
       * **为什么是显式字段而不是按名称约定**：`domain/supply/default-merchant.ts`
       * 原本按名称找「官网」，其注释自己就承认「商户表没有稳定业务码（只有 name / type）」。
       * 一个名字尚可将就；D3 之后七城各有一个平台自营商户，靠名字约定同步必然漂
       *（改个名、多个空格、换个环境就失效，且失效方式是静默的——回落变成 null，
       * 房源导进来但前台隐身）。
       *
       * **不是「唯一」标识**：七城各一个，都为 true。真正的解析条件是
       * 「`isPlatformDefault` + `status=active` + 资质有效 + `serviceCities` 含该楼盘城市」，
       * 城市那条由 §10 负责收口，见 `default-merchant.ts`。
       */
      name: 'isPlatformDefault',
      label: '平台自营商户',
      type: 'checkbox',
      defaultValue: false,
      index: true,
      admin: {
        description:
          '批量导入时，楼盘没有生效供给商户则回落到本城市的平台自营商户。同一城市只应有一个，且需在「服务城市」里勾上对应城市，否则该城市的导入会判错误行。',
      },
    },
    {
      name: 'qualificationExpiresAt',
      label: '资质到期时间',
      type: 'date',
      admin: {
        description: '资质状态为「已通过」时必填；到期后其供给的房源将不再对外展示',
        date: { pickerAppearance: 'dayAndTime' },
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
