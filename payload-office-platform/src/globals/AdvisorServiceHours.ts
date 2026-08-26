import type { GlobalConfig } from 'payload'

/**
 * P2 Task 3：平台顾问服务时间（Global）
 *
 * 守护不变量：
 *   - 时区固定 Asia/Shanghai（只读展示，不可改）
 *   - 表达平台级工作日/时段/节假日，不含任何个人顾问排班或联系方式
 *   - 前台只读取派生状态（open/closed + 下次开门），不暴露原始配置给公开 DTO 之外用途
 *   - 公开消息用于前台文案，节假日例外优先于常规周时段
 */

const DAY_LABELS: ReadonlyArray<{ label: string; value: string }> = [
  { label: '周日', value: '0' },
  { label: '周一', value: '1' },
  { label: '周二', value: '2' },
  { label: '周三', value: '3' },
  { label: '周四', value: '4' },
  { label: '周五', value: '5' },
  { label: '周六', value: '6' },
]

export const AdvisorServiceHours: GlobalConfig = {
  slug: 'advisor-service-hours',
  label: '平台顾问服务时间',
  access: {
    // 读取由前台派生状态使用（overrideAccess），公开访问走页面层；后台读写限管理员
    read: () => true,
  },
  admin: {
    // 同 SiteSettings：`hidden: true` 会连路由一起排除，导致自定义导航里那条
    // 「顾问服务时间」（navigation-config.ts）点进去是 404。这个缺陷一直都在，
    // 只是那个入口大概没人点过，直到 OPT-053 照抄本文件才暴露出来。
    group: false,
    description:
      '平台级服务时间（Asia/Shanghai）。用于前台展示"当前服务中/非服务时段"，不含个人顾问排班或联系方式。',
  },
  fields: [
    {
      name: 'timezone',
      type: 'text',
      defaultValue: 'Asia/Shanghai',
      admin: { readOnly: true, description: '时区固定 Asia/Shanghai' },
    },
    {
      name: 'weeklyHours',
      type: 'array',
      label: '每周服务时段',
      admin: { description: '每行一个时段；同一天可多行。start 含、end 不含（HH:MM）。' },
      // 默认周一至周五 09:00-18:00，让平台状态开箱即用（未保存 global 时返回此默认）
      defaultValue: [
        { day: '1', start: '09:00', end: '18:00' },
        { day: '2', start: '09:00', end: '18:00' },
        { day: '3', start: '09:00', end: '18:00' },
        { day: '4', start: '09:00', end: '18:00' },
        { day: '5', start: '09:00', end: '18:00' },
      ],
      fields: [
        {
          name: 'day',
          type: 'select',
          required: true,
          options: [...DAY_LABELS],
        },
        { name: 'start', type: 'text', required: true, admin: { placeholder: '09:00' } },
        { name: 'end', type: 'text', required: true, admin: { placeholder: '18:00' } },
      ],
    },
    {
      name: 'holidays',
      type: 'array',
      label: '节假日例外',
      admin: { description: '例外日期（YYYY-MM-DD）。不填时段=全天休息；填写则覆盖当天常规时段。' },
      fields: [
        { name: 'date', type: 'text', required: true, admin: { placeholder: '2026-10-01' } },
        {
          name: 'ranges',
          type: 'array',
          label: '当日时段（留空=全天休息）',
          fields: [
            { name: 'start', type: 'text', required: true },
            { name: 'end', type: 'text', required: true },
          ],
        },
      ],
    },
    {
      name: 'openMessage',
      type: 'text',
      defaultValue: '当前服务中，欢迎咨询',
      required: true,
    },
    {
      name: 'closedMessage',
      type: 'text',
      defaultValue: '当前非服务时段',
      required: true,
    },
  ],
}
