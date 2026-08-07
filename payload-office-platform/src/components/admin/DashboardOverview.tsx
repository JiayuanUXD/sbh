'use client'

import {
  Button,
  Card,
  Grid,
  Progress,
  Space,
  Statistic,
  Tag,
  Typography,
} from '@arco-design/web-react'
import {
  IconApps,
  IconHome,
  IconPlus,
  IconStorage,
  IconUserGroup,
} from '@arco-design/web-react/icon'
import type { DashboardStats } from '@/domain/analytics/dashboard-stats'

type DashboardOverviewProps = DashboardStats

const { Row, Col } = Grid
const { Title, Text } = Typography

const metricCards = [
  { key: 'listings', label: '全部房源', icon: <IconHome />, href: '/admin/collections/listings' },
  {
    key: 'availableListings',
    label: '当前可租',
    icon: <IconApps />,
    // 近似 drilldown：卡片数走 M4.7 统一有效供给口径（含媒体/关系/商户逐条精筛),
    // 但后台原生列表无法逐行跑异步精筛,故链接仅按发布态近似过滤,点进数量可能多于卡片数。
    href: '/admin/collections/listings?where[publicationStatus][equals]=published',
  },
  {
    key: 'buildings',
    label: '楼宇档案',
    icon: <IconStorage />,
    href: '/admin/collections/buildings',
  },
  { key: 'leads', label: '咨询线索', icon: <IconUserGroup />, href: '/admin/collections/leads' },
] as const

export default function DashboardOverview(props: DashboardOverviewProps) {
  const availabilityRate =
    props.listings > 0 ? Math.round((props.availableListings / props.listings) * 100) : 0

  return (
    <div className="arco-admin-dashboard">
      <section className="arco-admin-dashboard__intro">
        <Space size={10} direction="vertical">
          <Tag color="arcoblue" bordered>
            运营工作台
          </Tag>
          <Title heading={2}>运营工作台</Title>
          <Text type="secondary">集中查看房源供给与客户线索，快速进入日常维护流程。</Text>
        </Space>

        <div className="arco-admin-dashboard__actions">
          <Button type="primary" icon={<IconPlus />} href="/admin/collections/listings/create">
            新增房源
          </Button>
          <Button href="/admin/collections/leads">查看线索</Button>
        </div>
      </section>

      <Row gutter={[16, 16]}>
        {metricCards.map((metric) => (
          <Col key={metric.key} xs={12} md={6}>
            <Card className="arco-admin-dashboard__metric" hoverable>
              <a href={metric.href} className="arco-admin-dashboard__metric-link">
                <span className="arco-admin-dashboard__metric-icon">{metric.icon}</span>
                <Statistic title={metric.label} value={props[metric.key]} groupSeparator />
              </a>
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[16, 16]} className="arco-admin-dashboard__detail-row">
        <Col xs={24} lg={16}>
          <Card
            title="供给与内容健康度"
            extra={
              <Button type="text" href="/admin/collections/listings">
                管理房源
              </Button>
            }
            className="arco-admin-dashboard__panel"
          >
            <div className="arco-admin-dashboard__availability">
              <div>
                <Text type="secondary">可租房源占比</Text>
                <Title heading={3}>{availabilityRate}%</Title>
              </div>
              <Progress
                percent={availabilityRate / 100}
                color="#165DFF"
                trailColor="var(--color-fill-3)"
                showText={false}
              />
              <Text type="secondary">
                {props.availableListings} 套可租，共 {props.listings} 套房源
              </Text>
              <Space wrap>
                <Tag color="arcoblue">首页推荐 {props.featuredListings}</Tag>
                <Tag color={props.listingsWithoutCover > 0 ? 'orange' : 'green'}>
                  缺少封面 {props.listingsWithoutCover}
                </Tag>
              </Space>
              {props.listingsWithoutCover > 0 && (
                <Button
                  long
                  href="/admin/collections/listings?where[coverImage][exists]=false"
                >
                  补充房源图片
                </Button>
              )}
            </div>
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Card title="待跟进" className="arco-admin-dashboard__panel">
            <div className="arco-admin-dashboard__lead-status">
              <Statistic value={props.newLeads} suffix=" 条" />
              <Text type="secondary">状态为“新线索”的客户咨询</Text>
              <Tag color="arcoblue">跟进中 {props.activeLeads} 条</Tag>
              <Button long href="/admin/collections/leads?where[status][equals]=new">
                立即处理
              </Button>
            </div>
          </Card>
        </Col>
      </Row>
    </div>
  )
}
