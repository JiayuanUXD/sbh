import type { AdminViewServerProps } from 'payload'

import GeographyAdminTemplate from '@/components/admin/geography/GeographyAdminTemplate'
import { requireAnalyticsAccess } from './require-analytics-access'
import AnalyticsDashboardClient from './AnalyticsDashboardClient'

/**
 * 数据看板 - 服务端入口（OPT-065，路由 `/admin/analytics`）
 *
 * 复用 `GeographyAdminTemplate`：它只是 `DefaultTemplate` 的透传封装、不含地理领域
 * 逻辑，`BulkImportView` 已有同样的复用先例，不另建一份同构文件。
 *
 * 准入在 `requireAnalyticsAccess` 里判——Payload 3.86 的自定义视图是公共路由，
 * 不判就等于任意登录账号敲 URL 即可进入（见该文件头注释）。
 *
 * 注意**不要**用 `admin.hidden` 之类的方式藏这个页面：OPT-053 的教训是
 * `hidden: true` 会连路由一起排除，菜单点进去变成「没有找到任何东西」。
 * 本页靠导航配置的菜单码控制可见性，路由本身始终注册。
 */
export default async function AnalyticsDashboardView(props: AdminViewServerProps) {
  const denied = await requireAnalyticsAccess(props)
  if (denied) return denied

  return (
    <GeographyAdminTemplate {...props}>
      {/*
        24px 留白是本仓库自定义视图的通行做法：DefaultTemplate 的
        `.template-default__wrap` 自身 padding 为 0，内容不包一层就会紧贴左侧导航
        （实测内容起点 275 = 导航右边界，而地理 / 批量导入等页都是 299）。
        地理与批量导入把它写在各自的 Client 里；这里放在 View 一层包住，
        加载 / 错误 / 正常三种状态一次覆盖，不必在 Client 的每个 return 分支各写一遍。
        （权限不足的分支由 requireAnalyticsAccess 提前返回，自带同样的 24px。）
      */}
      <div style={{ padding: 24 }}>
        <AnalyticsDashboardClient />
      </div>
    </GeographyAdminTemplate>
  )
}
