import React from 'react'
import Link from 'next/link'
import './styles.css'

export const metadata = {
  title: {
    default: '商办租赁 · 上海中高端办公租赁平台',
    template: '%s · 商办租赁',
  },
  description: '上海甲级写字楼、服务式办公室、共享办公与整层办公租赁平台。',
}

const NAV = [
  { href: '/', label: '首页' },
  { href: '/listings', label: '在租房源' },
  { href: '/listings?type=serviced-office', label: '服务式办公' },
  { href: '/listings?type=coworking', label: '共享办公' },
]

export default async function RootLayout(props: { children: React.ReactNode }) {
  const { children } = props
  return (
    <html lang="zh-CN">
      <body>
        <header className="site-header">
          <div className="site-header__inner">
            <Link href="/" className="site-logo">商办租赁</Link>
            <nav className="site-nav">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="site-nav__link">{n.label}</Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="site-main">{children}</main>
        <footer className="site-footer">
          <div className="site-footer__inner">
            <span>© {new Date().getFullYear()} 商办租赁平台</span>
            <span>上海 · 商务办公租赁</span>
          </div>
        </footer>
      </body>
    </html>
  )
}
