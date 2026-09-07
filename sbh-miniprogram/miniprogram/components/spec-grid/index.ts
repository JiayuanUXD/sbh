function isSpecRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

type SpecItem = Readonly<{
  id: string
  label: string
  value: string
  estimated: boolean
}>

function normalizeItem(value: unknown, index: number): SpecItem {
  const item = isSpecRecord(value) ? value : {}
  return {
    id: typeof item.id === 'string' && item.id ? item.id : `spec-${index}`,
    label: typeof item.label === 'string' ? item.label : '',
    value: typeof item.value === 'string' && item.value ? item.value : '—',
    estimated: item.estimated === true,
  }
}

function normalizeItems(value: unknown): SpecItem[] {
  const items = Array.isArray(value) ? value.slice(0, 4) : []
  while (items.length < 4) items.push(null)
  return items.map(normalizeItem)
}

Component({
  properties: {
    items: {
      type: Array,
      value: [],
      observer(value: unknown) {
        this.setData({ displayItems: normalizeItems(value) })
      },
    },
  },
  data: {
    displayItems: normalizeItems([]),
  },
})
