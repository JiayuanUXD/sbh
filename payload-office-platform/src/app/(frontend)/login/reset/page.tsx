import type { Metadata } from 'next'
import ResetClient from '@/components/frontend/member/ResetClient'
import { buildPageMetadata } from '@/lib/frontend/metadata'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  return buildPageMetadata({ title: '找回密码', canonicalPath: '/login/reset', robots: 'noindex' })
}

export default function ResetPage() {
  return (
    <div className="mb-page">
      <div className="mb-card">
        <h1 className="mb-title">找回 / 设置密码</h1>
        <p className="mb-item__meta">仅限已注册手机号；未注册请先用验证码登录。</p>
        <ResetClient />
      </div>
    </div>
  )
}
