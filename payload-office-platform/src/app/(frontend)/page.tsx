import { getPayload } from 'payload'
import React from 'react'

import config from '@/payload.config'
import './styles.css'

// 请求时动态渲染：首页展示实时房源，且避免构建期连库
export const dynamic = 'force-dynamic'

type ListingCard = {
  id: string
  title: string
  rent?: number
  rentUnit?: string
  area?: number
  seats?: number
  listingType?: string
  highlights?: { text?: string }[]
}

const fallbackListings: ListingCard[] = [
  {
    id: 'demo-1',
    title: '静安南京西路 · 精装服务式办公室',
    rent: 2800,
    rentUnit: 'rmb-seat-month',
    area: 360,
    seats: 42,
    listingType: 'serviced-office',
    highlights: [{ text: '近地铁' }, { text: '可即刻入驻' }, { text: '带家具' }],
  },
  {
    id: 'demo-2',
    title: '陆家嘴核心区 · 江景甲级办公',
    rent: 9.8,
    rentUnit: 'rmb-sqm-day',
    area: 780,
    seats: 95,
    listingType: 'traditional-office',
    highlights: [{ text: '高区视野' }, { text: '整层可谈' }, { text: '企业形象佳' }],
  },
  {
    id: 'demo-3',
    title: '新天地商圈 · 精品独立办公空间',
    rent: 12.5,
    rentUnit: 'rmb-sqm-day',
    area: 520,
    seats: 60,
    listingType: 'full-floor',
    highlights: [{ text: '独立前台' }, { text: '会客区' }, { text: '精装交付' }],
  },
]

const listingTypeLabel: Record<string, string> = {
  'traditional-office': '传统办公室',
  'serviced-office': '服务式办公室',
  coworking: '共享办公',
  'full-floor': '整层办公',
}

const rentUnitLabel: Record<string, string> = {
  'rmb-sqm-day': '元/㎡/天',
  'rmb-month': '元/月',
  'rmb-seat-month': '元/工位/月',
}

export default async function HomePage() {
  let listings = fallbackListings

  try {
    const payloadConfig = await config
    const payload = await getPayload({ config: payloadConfig })

    const result = await payload.find({
      collection: 'listings',
      depth: 1,
      limit: 3,
      sort: '-updatedAt',
      where: {
        status: {
          equals: 'available',
        },
      },
    })

    if (result.docs.length > 0) {
      listings = result.docs as unknown as ListingCard[]
    }
  } catch {
    listings = fallbackListings
  }

  return (
    <main>
      <section className="hero">
        <div className="hero__shade" />
        <nav className="nav">
          <a className="brand" href="/">
            <span>Executive Office Leasing</span>
            <strong>中高端商务办公租赁平台</strong>
          </a>
          <div className="nav__links">
            <a href="#listings">精选房源</a>
            <a href="#districts">热门商圈</a>
            <a href="#service">顾问服务</a>
            <a className="nav__button" href="/admin">
              进入后台
            </a>
          </div>
        </nav>

        <div className="hero__content">
          <p className="eyebrow">Shanghai Premium Office Leasing</p>
          <h1>为成长型企业匹配更体面的上海办公室</h1>
          <p className="hero__summary">
            参考高端商务办公与企业会所式空间体验，聚合甲级写字楼、服务式办公室、共享办公与整层办公机会，帮助团队高效完成选址、看房与入驻决策。
          </p>
          <div className="search-panel" aria-label="办公租赁搜索">
            <label>
              区域 / 商圈
              <span>静安 · 陆家嘴 · 新天地</span>
            </label>
            <label>
              面积需求
              <span>100-1000㎡ / 10-100 工位</span>
            </label>
            <label>
              预算范围
              <span>按日租金或工位月租</span>
            </label>
            <a href="#contact">获取选址建议</a>
          </div>
        </div>
      </section>

      <section className="section intro" id="service">
        <div>
          <p className="eyebrow">Advisory First</p>
          <h2>从房源展示到顾问跟进的完整业务后台</h2>
        </div>
        <p>
          Payload CMS 已配置房源、楼盘、商圈、配套、页面内容和咨询线索模型。前台负责高端展示与转化体验，后台负责内容维护、房源发布和线索沉淀。
        </p>
      </section>

      <section className="feature-grid">
        <article>
          <span>01</span>
          <h3>高端办公空间展示</h3>
          <p>以空间图片、楼盘信息、租金面积、企业形象和交通配套建立信任。</p>
        </article>
        <article>
          <span>02</span>
          <h3>商圈与地图找房基础</h3>
          <p>区域、商圈、地铁、经纬度字段已预留，后续可接高德地图和搜索引擎。</p>
        </article>
        <article>
          <span>03</span>
          <h3>咨询线索管理</h3>
          <p>后台可记录姓名、电话、公司、预算、面积、入驻时间和跟进状态。</p>
        </article>
      </section>

      <section className="section listings" id="listings">
        <div className="section__head">
          <div>
            <p className="eyebrow">Featured Listings</p>
            <h2>精选可租办公空间</h2>
          </div>
          <a href="/admin/collections/listings">管理房源</a>
        </div>
        <div className="cards">
          {listings.map((listing) => (
            <article className="listing-card" key={listing.id}>
              <p className="listing-card__type">
                {listingTypeLabel[listing.listingType || ''] || '办公空间'}
              </p>
              <h3>{listing.title}</h3>
              <div className="listing-card__meta">
                <span>{listing.area ? `${listing.area}㎡` : '面积面议'}</span>
                <span>{listing.seats ? `${listing.seats} 工位` : '工位灵活'}</span>
              </div>
              <p className="listing-card__price">
                {listing.rent ? `¥${listing.rent}` : '价格面议'}
                <small>{listing.rent ? rentUnitLabel[listing.rentUnit || ''] || '' : ''}</small>
              </p>
              <div className="tags">
                {(listing.highlights || []).slice(0, 3).map((item, index) => (
                  <span key={`${listing.id}-${index}`}>{item.text}</span>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="districts" id="districts">
        <div>
          <p className="eyebrow">Business Districts</p>
          <h2>覆盖上海核心商务区</h2>
        </div>
        <div className="district-list">
          <span>南京西路</span>
          <span>陆家嘴</span>
          <span>新天地</span>
          <span>徐家汇</span>
          <span>前滩</span>
          <span>虹桥商务区</span>
        </div>
      </section>

      <section className="cta" id="contact">
        <p className="eyebrow">Office Advisory</p>
        <h2>让顾问根据预算、面积和入驻周期整理可选方案</h2>
        <p>当前版本已包含 Payload 后台与咨询线索模型，可继续接入表单提交、短信通知、企业微信提醒和 CRM 分配规则。</p>
        <a href="/admin/collections/leads">查看线索后台</a>
      </section>
    </main>
  )
}
