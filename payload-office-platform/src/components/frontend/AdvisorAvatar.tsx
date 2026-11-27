'use client'

import React, { useState } from 'react'

export default function AdvisorAvatar({
  src,
}: Readonly<{
  src: string | null
}>) {
  const [erroredSrc, setErroredSrc] = useState<string | null>(null)

  if (src && erroredSrc !== src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- 44px 平台顾问头像直接渲染安全媒体 URL
      <img
        src={src}
        alt=""
        width={44}
        height={44}
        className="advisor-card__avatar-img"
        onError={() => setErroredSrc(src)}
      />
    )
  }

  return <span className="advisor-card__avatar-text">顾问</span>
}
