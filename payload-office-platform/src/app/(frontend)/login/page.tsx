import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import LoginForm from '@/components/frontend/member/LoginForm'
import { getCurrentMember } from '@/domain/member/current-member'
import { safeReturnTo } from '@/domain/member/return-to'
import { buildPageMetadata } from '@/lib/frontend/metadata'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  return buildPageMetadata({ title: '登录', canonicalPath: '/login', robots: 'noindex' })
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const { returnTo } = await searchParams
  const target = safeReturnTo(returnTo, '/account')
  if (await getCurrentMember()) redirect(target)
  return (
    <div className="mb-page">
      <LoginForm returnTo={target} />
    </div>
  )
}
