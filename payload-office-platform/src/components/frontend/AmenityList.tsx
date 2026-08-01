import type { ReactNode } from 'react'
import type { AmenityGroupViewModel } from '@/domain/public-catalog'

/**
 * 配套设施图标化列表
 *
 * 设计依据：评审 P1-B。把纯文字 `<ul>` 升级为含图标 chip 布局，
 * 提升扫读效率，对齐 58 商办详情页配套设施的图标网格。
 *
 * 守护不变量：
 *   - 服务端组件，纯展示
 *   - 图标用 inline SVG，零外部依赖
 *   - 关键词匹配降序优先级；未命中时用默认勾选图标
 *   - 空组不渲染
 */
type AmenityListProps = Readonly<{
  groups: readonly AmenityGroupViewModel[]
}>

type IconEntry = Readonly<{ keywords: readonly string[]; render: ReactNode }>

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

function svg(children: ReactNode) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      {children}
    </svg>
  )
}

const ICONS: readonly IconEntry[] = [
  {
    keywords: ['会议室', '会议', '会客'],
    render: svg(<><rect x="3" y="5" width="18" height="12" rx="1" /><path d="M7 17v2M17 17v2M9 9h6M9 12h4" /></>),
  },
  {
    keywords: ['前台', '接待'],
    render: svg(<><path d="M4 9l1-4h14l1 4M4 9h16v8H4zM7 17v2M17 17v2M8 13h.01M16 13h.01" /></>),
  },
  {
    keywords: ['咖啡', '茶水', '水吧', '吧台'],
    render: svg(<><path d="M5 9h12v5a4 4 0 01-4 4H9a4 4 0 01-4-4zM17 9h2a2 2 0 010 4h-2M7 6c0-1 1-1 1-2M10 6c0-1 1-1 1-2" /></>),
  },
  {
    keywords: ['健身', '运动'],
    render: svg(<><path d="M6 9v6M18 9v6M6 12h12M4 7v4M20 7v4M6 16v2M18 16v2" /></>),
  },
  {
    keywords: ['停车', '车位', '车库'],
    render: svg(<><path d="M5 11l1.5-5h11L19 11M5 11h14v5H5zM7 16v2M17 16v2M8 13.5h.01M16 13.5h.01" /></>),
  },
  {
    keywords: ['电梯'],
    render: svg(<><rect x="5" y="3" width="14" height="18" rx="1" /><path d="M12 3v18M9 7l3-2 3 2M9 13l3 2 3-2" /></>),
  },
  {
    keywords: ['空调', '新风', '恒温'],
    render: svg(<><path d="M12 3v8M8 7a4 4 0 00-4 4M16 7a4 4 0 014 4M9 15a3 3 0 106 0c0-2-3-4-3-4s-3 2-3 4z" /></>),
  },
  {
    keywords: ['网络', '宽带', 'wifi', 'wi-fi', '无线'],
    render: svg(<><path d="M5 12a10 10 0 0114 0M8 15a6 6 0 018 0M11 18a2 2 0 012 0M12 21h.01" /></>),
  },
  {
    keywords: ['打印', '复印'],
    render: svg(<><path d="M7 9V4h10v5M7 9H5a2 2 0 00-2 2v5h4M7 9h10M17 9h2a2 2 0 012 2v5h-4M7 19h10v-3H7zM9 13h6" /></>),
  },
  {
    keywords: ['安保', '安防', '监控', '保安'],
    render: svg(<><path d="M12 3l7 3v5c0 4-3 7-7 9-4-2-7-5-7-9V6zM9 12l2 2 4-4" /></>),
  },
  {
    keywords: ['邮件', '快递', '收发'],
    render: svg(<><rect x="3" y="6" width="18" height="13" rx="1" /><path d="M3 8l9 5 9-5" /></>),
  },
  {
    keywords: ['储物', '储藏', '储物柜', '更衣'],
    render: svg(<><rect x="4" y="4" width="16" height="16" rx="1" /><path d="M12 4v16M8 9h.01M16 9h.01M8 14h.01M16 14h.01" /></>),
  },
  {
    keywords: ['电话', '程控'],
    render: svg(<><path d="M5 4h4l1 4-2 1a8 8 0 004 4l1-2 4 1v4a2 2 0 01-2 2A14 14 0 013 6a2 2 0 012-2" /></>),
  },
  {
    keywords: ['投影', '幕布', '屏幕'],
    render: svg(<><rect x="3" y="5" width="18" height="11" rx="1" /><path d="M8 20h8M12 16v4" /></>),
  },
  {
    keywords: ['24', '全天', '24小时', '全天候'],
    render: svg(<><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></>),
  },
]

const DEFAULT_ICON = svg(<path d="M5 12l5 5 9-10" />)

function matchIcon(label: string): ReactNode {
  const lower = label.toLowerCase()
  for (const entry of ICONS) {
    if (entry.keywords.some((kw) => lower.includes(kw))) return entry.render
  }
  return DEFAULT_ICON
}

export default function AmenityList({ groups }: AmenityListProps) {
  const visible = groups.filter((group) => group.items.length > 0)
  if (visible.length === 0) return null

  return (
    <div className="amenity-list">
      {visible.map((group) => (
        <div key={group.id} className="amenity-list__group">
          <h3 className="amenity-list__group-title">{group.title}</h3>
          <ul className="amenity-list__items">
            {group.items.map((item) => (
              <li key={item} className="amenity-list__item">
                <span className="amenity-list__icon" aria-hidden="true">
                  {matchIcon(item)}
                </span>
                <span className="amenity-list__label">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
