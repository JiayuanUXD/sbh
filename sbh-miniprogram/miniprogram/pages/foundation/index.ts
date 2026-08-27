Page({
  data: {
    environmentStatus: '游客 AppID · 本地开发',
    retryCount: 0,
    retryStatus: '尚未触发重试',
  },
  handleRetry() {
    const retryCount = this.data.retryCount + 1
    this.setData({
      retryCount,
      retryStatus: `已触发第 ${retryCount} 次重试`,
    })
  },
})
