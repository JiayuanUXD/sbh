function createRows(value) {
  const count = Number.isFinite(value) ? Math.max(1, Math.min(10, Math.floor(value))) : 3
  return Array.from({ length: count }, (_, index) => index)
}

Component({
  properties: {
    rows: {
      type: Number,
      value: 3,
      observer(value) {
        this.setData({ rowItems: createRows(value) })
      },
    },
    withMedia: {
      type: Boolean,
      value: false,
    },
  },
  data: {
    rowItems: [0, 1, 2],
  },
})
