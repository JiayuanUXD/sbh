import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import AccountSettings from '@/components/frontend/member/AccountSettings'
import { getCurrentMemberDto } from '@/domain/member/current-member'
import { buildPageMetadata } from '@/lib/frontend/metadata'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  return buildPageMetadata({ title: '账号设置', canonicalPath: '/account', robots: 'noindex' })
}

export default async function AccountPage() {
  const member = await getCurrentMemberDto()
  if (!member) redirect('/login?returnTo=%2Faccount')
  return (
    <div className="mb-page">
      <AccountSettings member={member} />
    </div>
  )
}
