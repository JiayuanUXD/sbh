function isMonthlyCostRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function displayValue(value: unknown): string {
  return typeof value === 'string' && value ? value : '—'
}

function assumptions(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

Component({
  properties: {
    cost: {
      type: Object,
      value: null,
      observer(value: unknown) {
        const cost = isMonthlyCostRecord(value) ? value : {}
        this.setData({
          displayCost: {
            rent: displayValue(cost.rent),
            propertyFee: displayValue(cost.propertyFee),
            total: displayValue(cost.total),
            inclusionLabel: typeof cost.inclusionLabel === 'string' ? cost.inclusionLabel : '',
            assumptions: assumptions(cost.assumptions),
          },
        })
      },
    },
  },
  data: {
    displayCost: {
      rent: '—',
      propertyFee: '—',
      total: '—',
      inclusionLabel: '',
      assumptions: [] as string[],
    },
  },
})
