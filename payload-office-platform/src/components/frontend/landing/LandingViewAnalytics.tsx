'use client'

import { useEffect, useState } from 'react'
import { track } from '@/lib/frontend/analytics'
import {
  createLandingOnceTracker,
  type LandingPageType,
} from '@/lib/frontend/analytics/landing'

/** Reports a landing-page exposure once per mounted component instance. */
export default function LandingViewAnalytics({
  pageType,
}: {
  pageType: LandingPageType
}): null {
  const [reportView] = useState(() =>
    createLandingOnceTracker('landing_view', pageType, track),
  )

  useEffect(() => {
    reportView()
  }, [reportView])

  return null
}
