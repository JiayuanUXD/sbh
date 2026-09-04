import type { MiniBuildingCard } from '../../services/catalog-contracts.js'

const GRADE_LABELS: Record<string, string> = {
  'super-grade-a': '超甲级',
  'grade-a': '甲级',
  'grade-b': '乙级',
  'grade-c': '丙级',
  'serviced-office': '商务中心',
  'A': '甲级',
  'B': '乙级',
  'C': '丙级',
}

Component({
  properties: {
    building: {
      type: Object,
      value: null,
      observer(newVal: unknown) {
        if (!newVal || typeof newVal !== 'object') return
        this.computeFields(newVal as MiniBuildingCard)
      },
    },
  },

  data: {
    imageFailed: false,
    factsText: '',
    locationText: '',
  },

  methods: {
    computeFields(building: MiniBuildingCard) {
      const parts: string[] = []
      if (building.grade) {
        const label = GRADE_LABELS[building.grade] || (building.grade.endsWith('级') ? building.grade : `${building.grade}级`)
        parts.push(label)
      }
      if (building.completedYear) parts.push(`${building.completedYear}年`)
      if (building.totalFloors) parts.push(`${building.totalFloors}层`)

      const locParts: string[] = []
      if (building.district) locParts.push(building.district)
      if (building.nearestMetro) {
        locParts.push(`${building.nearestMetro.station} ${building.nearestMetro.distanceMeters > 0 ? building.nearestMetro.distanceMeters + 'm' : ''}`.trim())
      } else if (building.address) {
        locParts.push(building.address)
      }

      this.setData({
        factsText: parts.join(' · '),
        locationText: locParts.join(' · '),
        imageFailed: false,
      })
    },

    handleImageError() {
      this.setData({ imageFailed: true })
    },

    handleOpen(event: WechatMiniprogram.BaseEvent) {
      const slug = event?.currentTarget?.dataset?.slug
      if (typeof slug !== 'string' || !slug) return
      this.triggerEvent('open', { slug })
    },

    handleInquiry() {
      const building = (this.data as { building?: MiniBuildingCard | null }).building
      if (!building?.slug) return
      this.triggerEvent('inquiry', { slug: building.slug, name: building.name })
    },
  },
})
