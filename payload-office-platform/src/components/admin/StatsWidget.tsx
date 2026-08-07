import type { WidgetServerProps } from 'payload'

import StatsWidgetClient from './StatsWidgetClient'

/**
 * Dashboard statistics deliberately load after the admin shell renders.
 * Permission-bound database work remains in GET /api/dashboard-stats.
 */
export default function StatsWidget(_props: WidgetServerProps) {
  return <StatsWidgetClient />
}
