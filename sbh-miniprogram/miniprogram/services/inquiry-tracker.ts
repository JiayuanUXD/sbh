export interface InquiryRecord {
  submissionRequestId: string
  targetType: 'listing' | 'building' | 'general'
  targetSlug?: string
  targetTitle: string
  imageUrl?: string
  submittedAt: number
  status: 'pending' | 'contacted' | 'viewing'
  statusLabel: string
}

const STORAGE_KEY_INQUIRIES = 'sbh_inquiry_records_v1'
const MAX_INQUIRIES = 50

let memInquiries: InquiryRecord[] = []

function hasWxStorage(): boolean {
  return typeof wx !== 'undefined' && typeof wx.getStorageSync === 'function' && typeof wx.setStorageSync === 'function'
}

function loadRecords(): InquiryRecord[] {
  if (hasWxStorage()) {
    try {
      const data = wx.getStorageSync(STORAGE_KEY_INQUIRIES)
      if (Array.isArray(data)) return data
    } catch {
      // ignore
    }
  }
  return memInquiries
}

function saveRecords(items: InquiryRecord[]): void {
  const capped = items.slice(0, MAX_INQUIRIES)
  memInquiries = capped
  if (hasWxStorage()) {
    try {
      wx.setStorageSync(STORAGE_KEY_INQUIRIES, capped)
    } catch {
      // ignore
    }
  }
}

export function recordInquiry(input: {
  submissionRequestId: string
  targetType: 'listing' | 'building' | 'general'
  targetSlug?: string
  targetTitle: string
  imageUrl?: string
  status?: 'pending' | 'contacted' | 'viewing'
  statusLabel?: string
}): void {
  if (!input || !input.submissionRequestId) return
  const list = loadRecords()
  const existsIndex = list.findIndex((item) => item.submissionRequestId === input.submissionRequestId)

  const record: InquiryRecord = {
    submissionRequestId: input.submissionRequestId,
    targetType: input.targetType,
    targetSlug: input.targetSlug,
    targetTitle: input.targetTitle || '商办意向咨询',
    imageUrl: input.imageUrl,
    submittedAt: Date.now(),
    status: input.status || 'pending',
    statusLabel: input.statusLabel || '待带看',
  }

  if (existsIndex >= 0) {
    list[existsIndex] = record
  } else {
    list.unshift(record)
  }

  saveRecords(list)
}

export function getRecentInquiries(limit = 10): InquiryRecord[] {
  const list = loadRecords()
  return list.slice(0, limit)
}

export function getPendingInquiryCount(): number {
  const list = loadRecords()
  return list.filter((item) => item.status === 'pending').length
}

export function clearInquiryRecordsForTesting(): void {
  memInquiries = []
  if (hasWxStorage()) {
    try {
      wx.removeStorageSync(STORAGE_KEY_INQUIRIES)
    } catch {
      // ignore
    }
  }
}
