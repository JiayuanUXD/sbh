'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { FavoriteType } from '@/domain/member/favorites'
import { useMember } from './MemberProvider'

export default function FavoriteRemoveButton({ type, id }: Readonly<{ type: FavoriteType; id: number }>) {
  const { removeFavorite } = useMember()
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  return (
    <>
      <button type="button" className="btn btn--ghost btn--sm" onClick={async () => { const err = await removeFavorite({ type, id }); if (err) setError(err); else router.refresh() }}>移除</button>
      {error ? <span className="modal__error" role="alert">{error}</span> : null}
    </>
  )
}
