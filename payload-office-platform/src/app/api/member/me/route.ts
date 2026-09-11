import { getCurrentMemberDto } from '@/domain/member/current-member'
import { handleMemberRoute, ok } from '@/domain/member/http'

export async function GET(): Promise<Response> {
  return handleMemberRoute(async () => ok({ member: await getCurrentMemberDto() }))
}
