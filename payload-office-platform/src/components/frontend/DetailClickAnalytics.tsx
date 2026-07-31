'use client'

import { useEffect } from 'react'
import { track } from '@/lib/frontend/analytics'

function positiveInteger(value: string | undefined): number | null {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

/**
 * A single, page-scoped delegated listener for server-rendered detail links.
 * Dataset values are limited to public numeric IDs and fixed enums by callers.
 */
export default function DetailClickAnalytics(): null {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return
      const element = event.target.closest<HTMLElement>('[data-detail-analytics-event]')
      if (!element) return

      const parentId = positiveInteger(element.dataset.analyticsParentId)
      const listingId = positiveInteger(element.dataset.analyticsListingId)
      const buildingId = positiveInteger(element.dataset.analyticsBuildingId)
      const rank = positiveInteger(element.dataset.analyticsRank)
      const section = element.dataset.analyticsSection
      const eventName = element.dataset.detailAnalyticsEvent

      if (eventName === 'listing_building_click' && listingId && buildingId && section) {
        track(eventName, { listing_id: listingId, building_id: buildingId, section })
      }
      if (eventName === 'recommendation_click' && parentId && listingId && rank && section) {
        const recommendationType = element.dataset.analyticsRecommendationType
        if (recommendationType) {
          track(eventName, {
            listing_id: parentId,
            target_listing_id: listingId,
            recommendation_type: recommendationType,
            rank,
            section,
          })
        }
      }
      if (eventName === 'building_listing_click' && parentId && listingId && rank && section) {
        const supplyGroup = element.dataset.analyticsSupplyGroup
        if (supplyGroup) {
          track(eventName, {
            building_id: parentId,
            listing_id: listingId,
            supply_group: supplyGroup,
            rank,
            section,
          })
        }
      }
      if (eventName === 'related_building_click' && parentId && buildingId && rank && section) {
        const recommendationType = element.dataset.analyticsRecommendationType
        if (recommendationType) {
          track(eventName, {
            building_id: parentId,
            target_building_id: buildingId,
            recommendation_type: recommendationType,
            rank,
            section,
          })
        }
      }
    }

    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])

  return null
}
