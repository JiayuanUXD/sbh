import type { Metadata } from 'next'
import Link from 'next/link'
import React from 'react'
import { buildPageMetadata } from '@/lib/frontend/metadata'
import { PRIVACY_POLICY_VERSION } from '@/lib/frontend/site-config'

/**
 * 隐私政策（静态法律页）
 *
 * 委托找房 / 投放房源 / 询价的同意文案均链接到本页（/pages/privacy）。
 * 合规文档放在代码库而非后台 CMS：随代码评审变更、可追溯，且不依赖
 * Pages 集合是否已录入该 slug（历史上因 DB 无 privacy 文档而 404）。
 * 路由上本静态页优先于动态 /pages/[slug]。
 */
export const metadata: Metadata = buildPageMetadata({
  title: '隐私政策',
  description: '商办租赁平台如何收集、使用与保护您留下的联系方式。',
  canonicalPath: '/pages/privacy',
  robots: 'index',
})

export default function PrivacyPolicyPage() {
  return (
    <div className="page-detail">
      <nav className="breadcrumb" aria-label="面包屑">
        <Link href="/" className="breadcrumb__link">首页</Link>
        <span className="breadcrumb__sep" aria-hidden="true">/</span>
        <span className="breadcrumb__current">隐私政策</span>
      </nav>

      <h1 className="page-detail__title page-detail__title--bare">隐私政策</h1>
      <p className="page-detail__summary">
        版本 {PRIVACY_POLICY_VERSION} · 适用于商办租赁平台（本站）公开页面
      </p>

      <article className="page-detail__body">
        <p>
          我们深知联系方式是您的重要个人信息。本政策说明您在本站留下信息时，
          我们收集什么、用来做什么、以及如何保护它。提交表单即表示您已阅读并同意本政策。
        </p>

        <h2>一、我们收集的信息</h2>
        <ul>
          <li><strong>手机号码</strong>：您在「委托找房」「投放房源」或询价表单中主动填写的手机号；</li>
          <li><strong>您主动提交的房源信息</strong>：仅在「投放房源」页，包括楼盘名称、地址、面积、佣金悬赏与联系人称呼等您自行填写的内容；</li>
          <li><strong>基础访问日志</strong>：为保障服务安全所必需的 IP 地址、访问时间等记录，以及用于防止批量刷交的限流计数。</li>
          <li><strong>匿名访问统计</strong>：页面浏览、停留时长、浏览深度，以及按钮点击、筛选条件、表单各步骤是否完成等交互记录。这些数据由我们<strong>自行部署</strong>的开源统计工具（Umami）收集并存储在本平台自有服务器上，<strong>不使用 Cookie，不发送给任何第三方</strong>，也不含您填写的任何文字内容。</li>
        </ul>
        <p>我们不通过表单收集您的姓名、证件号码、位置轨迹等其他个人信息；页面中的地图由第三方地图服务展示，我们不向其提交您的个人信息。</p>
        <p>
          关于匿名访问统计：我们只记录页面类型、结果数量、排序方式这类<strong>枚举与数字</strong>，
          不记录您输入的搜索词、留言或联系方式。统计标识由访问特征加盐哈希生成并定期轮换，
          <strong>无法用于跨天或跨设备识别您本人</strong>。
        </p>

        <h2>二、信息的使用目的</h2>
        <ul>
          <li>安排专属顾问就您的选址或房源投放需求与您电话联系；</li>
          <li>在后台为线索标注来源页面，以便顾问了解您的意图、提供更准确的方案；</li>
          <li>保障服务安全，防止恶意批量提交；</li>
          <li>以匿名汇总的方式了解哪些页面与功能被使用得多、哪一步流失得多，用于改进站点体验。</li>
        </ul>

        <h2>三、信息的共享与披露</h2>
        <ul>
          <li>您的联系方式仅对处理您需求所必需的平台顾问人员可见；</li>
          <li>我们不出售您的个人信息，不向广告商或无关第三方提供；</li>
          <li>除法律法规要求或为保护重大合法权益所必需外，我们不会对外披露。</li>
        </ul>

        <h2>四、存储与保留</h2>
        <p>
          您的信息存储于中华人民共和国境内的服务器，采取访问权限控制与后台脱敏展示等保护措施。
          我们仅在实现上述目的所需的期限内保留您的信息；您要求删除的，按下方方式联系我们处理。
        </p>

        <h2>五、您的权利</h2>
        <p>
          您可通过回访您的顾问，或再次使用本站询价入口说明诉求，查询、更正或删除您留下的个人信息；
          您也可以撤回授权，撤回后我们不再就原提交事项与您联系。
        </p>

        <h2>六、未成年人保护</h2>
        <p>本站服务面向企业办公选址场景，不面向未成年人提供。若我们发现在未获监护人同意下收集了未成年人信息，将尽快删除。</p>

        <h2>七、政策更新</h2>
        <p>
          本政策可能随服务调整而更新，更新后的版本会在本页发布并更新版本号；
          表单提交时记录的同意为提交当时生效的版本（当前 {PRIVACY_POLICY_VERSION}）。
        </p>
      </article>
    </div>
  )
}
