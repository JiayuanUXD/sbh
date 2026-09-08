import type { AccessArgs, CollectionConfig } from 'payload'

import { getPermissionContext, type RequestContext } from '@/domain/auth/access'
import { hasMenuPermission } from '@/domain/auth/permission-context'
import { CUSTOMER_MENU_CODES } from '@/domain/crm/customer-menu-codes'

/**
 * 读写准入（2026-09-08 收口）
 *
 * 本集合此前**整个 `access` 块都没写**，四个动作全落 Payload 3.86 的
 * `defaultAccess`（`collections/config/sanitize.js`，判据仅 `Boolean(req.user)`）
 * ——任何登录账号都能读到全部客户档案（含 `phoneNormalized`，那是**完整**手机号，
 * 不是脱敏快照），也都能改、能删。承载它的是 Payload 原生集合视图
 * `/admin/collections/customers`，原生路由不认自定义导航的 menuCodes，
 * 所以准入只能落在这里。同族缺陷：Locations（#160）、BusinessAreaExtensions（#159）。
 *
 * 口径 = 客户档案叶子的菜单码（`customers` | `my-customers`），与承载它的模块对齐。
 * 命中的内置角色：ADM（`*`）、MGR、CSR、BRK；OPS 两个码都没有——OPS 的职责是
 * 供给侧运营，导航里本来就没有「客户档案」入口，收紧不夺走任何在用能力。
 * 不并操作码：`permission-codes.ts` 里没有任何 `customer:*` 操作码，
 * 现造一个还要配迁移授权才有人持有，等于凭空多一层空判据。
 *
 * **已知缺口，别误读成已解决**：BRK 的 dataScope 是 `self`，但 customers 表上
 * 没有 owner / city 列（归属只存在于反向的 `leads.customer`），逐条数据范围收窄
 * 表达不成 Payload 的 `Where`。所以命中菜单码的角色读到的是**全量**客户。
 * 这比收口前（任何登录账号都能读）严格更好，但不等于满足了 permissions.md 的
 * BRK「仅本人负责」口径。要真正收窄需要在 customers 上补归属列或做反向 join，
 * 属于另一件事。
 */
async function canAccessCustomer(args: AccessArgs): Promise<boolean> {
  const ctx = await getPermissionContext(args.req as RequestContext)
  if (!ctx) return false
  return CUSTOMER_MENU_CODES.some((code) => hasMenuPermission(ctx, code))
}

/**
 * 客户档案（tasks.md M5.1 / design §3.6 customers / R6）
 *
 * 手机号用于查重但**不作为业务主键**（design §3.6）：phoneNormalized 存规范化后的号码
 * 供 30 天窗口查重（domain/crm/dedup.ts），phoneMaskedSnapshot 存脱敏快照供列表展示。
 * 一个客户可关联多条线索（leads.customer 反向），合并/新建需求由领域服务在查重时决策。
 */
export const Customers: CollectionConfig = {
  slug: 'customers',
  labels: {
    singular: '客户',
    plural: '客户档案',
  },
  admin: {
    group: false,
    pagination: { defaultLimit: 25, limits: [10, 25, 50, 100] },
    useAsTitle: 'name',
    defaultColumns: ['name', 'phoneMaskedSnapshot', 'company', 'status', 'createdAt'],
    description: '客户档案：手机号用于查重但不作为业务主键，一个客户可关联多条线索。',
  },
  access: {
    // 读侧**不能**公开：phoneNormalized 是完整手机号，且本表在 C 端零引用。
    read: canAccessCustomer,
    create: canAccessCustomer,
    update: canAccessCustomer,
    /**
     * 一律禁止物理删除。
     *
     * 与 Locations（#160 给 ADM 留了 `location:manage`）刻意不同，理由是这里
     * 没有「非删不可」的压力、却有一条静默的数据损坏路径：
     *   1. `leads.customer_id` 的外键是 `ON DELETE SET NULL`（迁移
     *      20260726_110000 第 134 行），删一个客户会把**所有**指向它的线索的
     *      客户链接静默清空——不报错、无审计、没有 `protectLocationDelete`
     *      那样的引用保护 hook 兜底；
     *   2. 本仓库 `payload.delete` 恒为硬删，删完不可恢复；
     *   3. Locations 留删除口是因为 `immutableCode` 全局唯一且创建后不可改，
     *      录错只能删掉重建。customers 没有任何唯一 / 不可变字段，
     *      写错改就是了，不存在同样的补救需求；
     *   4. 全仓库没有任何代码删 customers（`rg "collection: 'customers'"` 只命中
     *      seed 与只读审计脚本），所以这不夺走任何在用能力。
     *
     * 将来真要做「客户注销 / PII 删除」，应当配引用保护 hook + 审计走专门入口，
     * 而不是把这条放开成后台的一个按钮。
     */
    delete: () => false,
  },
  fields: [
    {
      type: 'row',
      fields: [
        { name: 'name', label: '姓名', type: 'text', required: true },
        { name: 'company', label: '公司', type: 'text' },
      ],
    },
    {
      type: 'row',
      fields: [
        {
          name: 'phoneNormalized',
          label: '规范化手机号',
          type: 'text',
          required: true,
          index: true,
          admin: {
            description: '规范化后的手机号，用于 30 天窗口查重（不作为业务主键）。',
          },
        },
        {
          name: 'phoneMaskedSnapshot',
          label: '脱敏手机号',
          type: 'text',
          admin: {
            readOnly: true,
            description: '脱敏快照（如 138****1111），供列表展示，不含完整号码。',
          },
        },
        {
          name: 'status',
          label: '客户状态',
          type: 'select',
          defaultValue: 'active',
          options: [
            { label: '活跃', value: 'active' },
            { label: '已成交', value: 'converted' },
            { label: '流失', value: 'lost' },
          ],
        },
      ],
    },
  ],
}
