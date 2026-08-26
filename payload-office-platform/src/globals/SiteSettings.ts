import type { AccessArgs, GlobalConfig } from 'payload'

import { getPermissionContext, type RequestContext } from '@/domain/auth/access'
import { hasOperationPermission } from '@/domain/auth/permission-context'
import { invalidateSiteSettingsPublicCache } from '@/lib/frontend/public-cache-revalidation'
import { NAV_TARGET_OPTIONS } from '@/lib/frontend/nav-targets'

/**
 * OPT-053：站点运营配置（Global）
 *
 * 守护不变量：
 *   - **`access.update` 必须显式声明**。Payload 3.86 的
 *     `globals/config/sanitize.js:36-37` 会把缺失的 update 补成 `defaultAccess`
 *     （判据仅 `Boolean(req.user)`）——任何登录账号都能 PATCH 改掉全站品牌与
 *     合规声明。`admin.hidden` 只影响 UI，REST/GraphQL 端点照常开放。
 *     同族缺陷见 OPT-051（collection 缺 delete）与 OPT-055（AdvisorServiceHours）。
 *   - 每个字段都要有 `defaultValue`，取值即各消费点当前的硬编码字面量。
 *     前台仍保留组件内常量作为第三层兜底（迁移执行前该表不存在）。
 *   - 只收「运营会改」的内容。UI 微文案（「图片暂未加载」「清除全部条件」、
 *     各 placeholder）**刻意不进这里**——它们是产品文案不是运营内容，
 *     开放配置只会制造「运营填空 → 按钮没字」的翻车面。
 *   - 前台读取一律走 `getCachedSiteSettings()`，不要在组件里各自 findGlobal。
 */

async function canManageSiteSettings(args: AccessArgs): Promise<boolean> {
  const ctx = await getPermissionContext(args.req as RequestContext)
  if (!ctx) return false
  return hasOperationPermission(ctx, 'site_settings:manage')
}

export const SiteSettings: GlobalConfig = {
  slug: 'site-settings',
  label: '站点设置',
  access: {
    // 前台公开消费（logo / 页脚 / 合规声明出现在每一个页面上）
    read: () => true,
    // 见文件头注释：缺这一条等于对所有登录用户开放写入
    update: canManageSiteSettings,
  },
  admin: {
    group: '系统管理',
    hidden: true,
    description:
      '全站品牌、合规声明与首页区块文案。保存后最长 60 秒全站生效（多实例缓存失效见 OPT-042）。',
  },
  hooks: {
    // 不挂这个，改完要等满 60 秒 TTL 才生效——单实例下本来可以是即时的
    afterChange: [
      () => {
        invalidateSiteSettingsPublicCache()
      },
    ],
  },
  fields: [
    {
      type: 'tabs',
      tabs: [
        {
          label: '品牌',
          description: '站点标识与首屏第一句话。全平台一套，不按城市定制。',
          fields: [
            {
              name: 'siteName',
              label: '站点名称',
              type: 'text',
              defaultValue: '商办租赁',
              admin: { description: '页头与页脚的文字标识、页脚版权行共用。' },
            },
            {
              name: 'logo',
              label: '站点 Logo',
              type: 'relationship',
              relationTo: 'media',
              filterOptions: () => ({ mimeType: { contains: 'image' } }),
              admin: { description: '留空则回落为「站点名称」的文字标识（当前线上形态）。' },
            },
            {
              name: 'heroHeading',
              label: '首屏主标题',
              type: 'text',
              defaultValue: '汇聚高端商务空间，赋能企业卓越成长',
              admin: {
                description:
                  '首页搜索框上方的 H1。**全站共用一句、不按城市定制**（2026-08-21 产品裁定）——城市差异由 title/description/OG 承担。要改某个未开城页的文案，去「城市站点配置」。',
              },
            },
            {
              name: 'slogan',
              label: '首屏副标题',
              type: 'textarea',
              defaultValue:
                '覆盖核心商务区、总部型整层、精装办公与高规格写字楼资源，帮企业更快完成选址决策',
              admin: { description: '首页搜索框上方、主标题下方的一行说明。' },
            },
          ],
        },
        {
          label: '合规声明',
          description: '法务口径文案。改这里不需要发版。',
          fields: [
            {
              name: 'priceDisclaimer',
              label: '价格免责声明',
              type: 'text',
              defaultValue: '页面价格为公开挂牌价，实际价格以顾问报价为准',
              admin: { description: '楼盘详情页首屏摘要面板下方。' },
            },
            {
              name: 'imageDisclaimer',
              label: '示意图声明',
              type: 'text',
              defaultValue: '示意图，以现场实际情况为准',
              admin: { description: '详情页图集里标记为示意图的媒体下方。' },
            },
          ],
        },
        {
          label: '页脚',
          fields: [
            {
              name: 'footerBrandBlurb',
              label: '页脚品牌说明',
              type: 'textarea',
              defaultValue:
                '聚合{城市}甲级写字楼、独栋办公、共享办公与整层办公机会，免费帮成长型企业匹配更体面的办公室。',
              admin: {
                description:
                  '`{城市}` 会替换成当前访问的城市名。**不要手写城市名**——写死会让其它六城的页脚说错城市（这正是本次修掉的 bug）。',
              },
            },
            {
              name: 'copyrightHolder',
              label: '版权主体',
              type: 'text',
              defaultValue: '商办租赁平台',
              admin: { description: '渲染为「© {年份} {版权主体}」。' },
            },
            {
              name: 'footerTaglineSuffix',
              label: '页脚副标题后缀',
              type: 'text',
              defaultValue: '商务办公租赁',
              admin: { description: '渲染为「{当前城市} · {后缀}」，城市名自动跟随路由。' },
            },
          ],
        },
        {
          label: '首页区块',
          fields: [
            {
              name: 'valueProps',
              label: '「为什么选择我们」三条',
              type: 'array',
              minRows: 1,
              maxRows: 6,
              defaultValue: [
                {
                  name: '真房源实地核验',
                  body: '每套房源由本地顾问到场量房拍照，面积与层高逐条核过，下架即时同步。',
                },
                {
                  name: '免费选址顾问',
                  body: '按预算、通勤、注册要求给出可比清单，不收企业端服务费。',
                },
                {
                  name: '全程租约护航',
                  body: '合同条款、免租期、押付方式与交付标准全程跟进到入驻。',
                },
              ],
              admin: { description: '序号（01/02/03）按顺序自动生成，不用手填。' },
              fields: [
                { name: 'name', label: '标题', type: 'text', required: true },
                { name: 'body', label: '说明', type: 'textarea', required: true },
              ],
            },
            {
              name: 'typeCards',
              label: '「按类型浏览」五卡',
              type: 'array',
              admin: {
                description:
                  '只能改文案、显隐与顺序。跳转目标由「槽位」决定且不可编辑——它绑定房源类型枚举，改了就是死链或空结果。',
              },
              defaultValue: [
                { slot: 'traditional-office', label: '传统办公', sublabel: '独立空间 · 灵活面积', visible: true },
                { slot: 'coworking', label: '联合办公', sublabel: '工位起 · 共享配套', visible: true },
                { slot: 'full-floor', label: '整层办公', sublabel: '整层起租 · 定制形象', visible: true },
                { slot: 'serviced-office', label: '独栋办公', sublabel: '企业独栋 · 专属形象', visible: true },
                { slot: 'creative-park', label: '创意园区', sublabel: '园区生态 · 低密度', visible: true },
              ],
              fields: [
                {
                  name: 'slot',
                  label: '槽位',
                  type: 'select',
                  required: true,
                  options: [
                    { value: 'traditional-office', label: '传统办公位' },
                    { value: 'coworking', label: '联合办公位' },
                    { value: 'full-floor', label: '整层办公位' },
                    { value: 'serviced-office', label: '独栋办公位' },
                    { value: 'creative-park', label: '创意园区位' },
                  ],
                  admin: {
                    readOnly: true,
                    description:
                      '决定这张卡跳去哪里。**必须真的存进每一行**：只按数组下标绑定的话，运营一调序，「联合办公」这张卡就链到传统办公——标题副标题都是对的，只有链接错，页面上完全看不出来。',
                  },
                },
                { name: 'label', label: '标题', type: 'text', required: true },
                { name: 'sublabel', label: '副标题', type: 'text' },
                { name: 'visible', label: '显示', type: 'checkbox', defaultValue: true },
              ],
            },
          ],
        },
        {
          label: '导航',
          description:
            '主导航与页脚分组。**跳转目标只能选、不能填**——它指向真实路由，自由填写就是死链工厂（404 不抛异常也不进告警，带参路由填错枚举更隐蔽，返回的是空结果页而不是 404）。新增可选目标需要发版。',
          fields: [
            {
              name: 'mainNav',
              label: '主导航',
              type: 'array',
              maxRows: 7,
              admin: {
                description: '页头横向导航。超过 7 项在窄屏会挤，故设上限。logo 即回首页，不需要「首页」项。',
              },
              defaultValue: [
                { target: 'listings', label: '找办公室', visible: true },
                { target: 'buildings', label: '找楼盘', visible: true },
                { target: 'listings-type-coworking', label: '共享办公', visible: true },
                { target: 'entrust', label: '委托找房', visible: true },
                { target: 'publish', label: '投放房源', visible: true },
                { target: 'news', label: '资讯', visible: true },
              ],
              fields: [
                {
                  name: 'target',
                  label: '跳转目标',
                  type: 'select',
                  required: true,
                  options: NAV_TARGET_OPTIONS,
                  admin: { description: '从已上线的页面里选。选项由代码维护，与实际路由有双向守卫。' },
                },
                { name: 'label', label: '显示文字', type: 'text', required: true },
                { name: 'visible', label: '显示', type: 'checkbox', defaultValue: true },
              ],
            },
            {
              name: 'footerColumns',
              label: '页脚分组',
              type: 'array',
              maxRows: 5,
              defaultValue: [
                {
                  title: '浏览',
                  links: [
                    { target: 'listings', label: '在租房源', visible: true },
                    { target: 'buildings', label: '找写字楼', visible: true },
                    { target: 'news', label: '资讯中心', visible: true },
                  ],
                },
                {
                  title: '按类型',
                  links: [
                    { target: 'listings-type-traditional-office', label: '传统办公', visible: true },
                    { target: 'listings-type-coworking', label: '联合办公', visible: true },
                    { target: 'listings-type-full-floor', label: '整层办公', visible: true },
                  ],
                },
                {
                  title: '服务',
                  links: [
                    { target: 'entrust', label: '委托找房', visible: true },
                    { target: 'publish', label: '投放房源', visible: true },
                  ],
                },
              ],
              fields: [
                { name: 'title', label: '分组标题', type: 'text', required: true },
                {
                  name: 'links',
                  label: '分组内链接',
                  type: 'array',
                  fields: [
                    {
                      name: 'target',
                      label: '跳转目标',
                      type: 'select',
                      required: true,
                      options: NAV_TARGET_OPTIONS,
                    },
                    { name: 'label', label: '显示文字', type: 'text', required: true },
                    { name: 'visible', label: '显示', type: 'checkbox', defaultValue: true },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
}
