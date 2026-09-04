import {
  buildingGradeLabel,
  type MiniBuildingCard,
} from '../../services/catalog-contracts.js'

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
        parts.push(buildingGradeLabel(building.grade))
      }
      if (building.completedYear) parts.push(`${building.completedYear}年`)
      if (building.totalFloors) parts.push(`${building.totalFloors}层`)

      const locParts: string[] = []
      if (building.district) locParts.push(building.district)
      if (building.nearestMetro) {
        const distance = building.nearestMetro.distanceMeters
        locParts.push(`${building.nearestMetro.station} ${distance !== null ? `${distance}m` : ''}`.trim())
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
