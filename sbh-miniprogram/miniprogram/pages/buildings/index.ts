import {
  createInquirySheetController,
  type InquirySheetContext,
  type InquirySheetController,
  type InquirySheetSnapshot,
} from '../../components/inquiry-sheet/controller.js'
import { getBuildings } from '../../services/catalog.js'
import type { MiniBuildingCard } from '../../services/catalog-contracts.js'
import { refreshUserAssets } from '../../services/favorites.js'
import {
  CURRENT_INQUIRY_POLICY_VERSION,
  createInquiryService,
  createSubmissionIntentManager,
} from '../../services/inquiry.js'
import { request } from '../../services/request.js'
import { createSessionService } from '../../services/session.js'

const BUILDING_GRADE_FILTERS = [
  { label: '全部', value: '' },
  { label: '甲级', value: 'grade-a' },
  { label: '超甲级', value: 'super-grade-a' },
  { label: '创意园区', value: 'creative-park' },
  { label: '服务式办公', value: 'serviced-office' },
] as const

const SORTS: Record<string, string> = {
  '': '在租最多',
  'stock-desc': '在租最多',
  'completion-desc': '最新竣工',
  'grade': '等级最高',
}

function closedInquirySheet(): InquirySheetSnapshot {
  return {
    state: 'closed', context: null, submissionRequestId: null, moveInTime: '', phone: '',
    consentAccepted: false, privacyStatus: 'unchecked', phoneMode: 'wechat', errorReason: null,
    errorMessage: '', requiresNewPhoneAuthorization: false, successMessage: '', successFollowUp: '',
    busy: false, submitDisabled: true, phoneSubmitDisabled: true, manualSubmitDisabled: true,
  }
}

function requestLoginCode(): Promise<Readonly<{ code: string }>> {
  return new Promise((resolve, reject) => wx.login({
    success: ({ code }) => resolve({ code }),
    fail: reject,
  }))
}

function openPrivacyContract(): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      wx.openPrivacyContract({ success: () => resolve(), fail: reject })
    } catch {
      reject(new Error('privacy contract unavailable'))
    }
  })
}

function generalInquiryContext(): InquirySheetContext {
  return {
    target: { targetType: 'general' },
    title: '请顾问匹配合适楼盘',
    facts: { area: '全上海', unitPrice: '多种计价', monthlyEstimate: '按需求匹配' },
    policyVersion: CURRENT_INQUIRY_POLICY_VERSION,
  }
}

const sessionService = createSessionService({ login: requestLoginCode, request })
const inquiryService = createInquiryService({
  request,
  getAnonymousContextToken: sessionService.getToken,
  clearAnonymousContext: sessionService.clear,
})
const submissionIntentManager = createSubmissionIntentManager()

Page({
  data: {
    state: 'loading' as 'loading' | 'ready' | 'error',
    items: [] as MiniBuildingCard[],
    inactiveItems: [] as MiniBuildingCard[],
    totalDocs: 0,
    totalActiveCount: 0,
    totalInactiveCount: 0,
    districtFilter: '',
    gradeFilter: '',
    gradeFilterLabel: '等级',
    sortFilter: '',
    sortLabel: '在租最多',
    inquiryOpen: false,
    inquirySheet: closedInquirySheet(),
  },

  inquirySheetController: null as InquirySheetController | null,

  onLoad() {
    this.loadBuildings()
  },

  onPullDownRefresh() {
    this.loadBuildings().finally(() => {
      wx.stopPullDownRefresh()
    })
  },

  onUnload() {
    this.inquirySheetController?.dispose()
    this.inquirySheetController = null
    sessionService.clear()
    submissionIntentManager.invalidate()
  },

  async loadBuildings() {
    this.setData({ state: 'loading' })
    try {
      const queryParts: string[] = []
      if (this.data.districtFilter) queryParts.push(`district=${encodeURIComponent(this.data.districtFilter)}`)
      if (this.data.gradeFilter) queryParts.push(`grade=${encodeURIComponent(this.data.gradeFilter)}`)
      if (this.data.sortFilter) queryParts.push(`sort=${encodeURIComponent(this.data.sortFilter)}`)

      const res = await getBuildings(queryParts.join('&'))
      this.setData({
        state: 'ready',
        items: [...res.items],
        inactiveItems: [...res.inactiveItems],
        totalDocs: res.pagination.totalDocs,
        totalActiveCount: res.totalActiveCount,
        totalInactiveCount: res.totalInactiveCount,
      })
    } catch {
      this.setData({ state: 'error' })
    }
  },

  handleDistrictFilter() {
    const districts = ['全部', '黄浦区', '静安区', '浦东新区', '长宁区', '徐汇区']
    wx.showActionSheet({
      itemList: districts,
      success: (res) => {
        const selected = res.tapIndex === 0 ? '' : districts[res.tapIndex] ?? ''
        this.setData({ districtFilter: selected })
        this.loadBuildings()
      },
    })
  },

  handleGradeFilter() {
    wx.showActionSheet({
      itemList: BUILDING_GRADE_FILTERS.map((grade) => grade.label),
      success: (res) => {
        const selected = BUILDING_GRADE_FILTERS[res.tapIndex] ?? BUILDING_GRADE_FILTERS[0]
        this.setData({
          gradeFilter: selected.value,
          gradeFilterLabel: selected.value ? selected.label : '等级',
        })
        this.loadBuildings()
      },
    })
  },

  handleSortFilter() {
    const sortKeys = ['', 'completion-desc', 'grade']
    const sortLabels = ['在租最多', '最新竣工', '等级最高']
    wx.showActionSheet({
      itemList: sortLabels,
      success: (res) => {
        const key = sortKeys[res.tapIndex] ?? ''
        this.setData({
          sortFilter: key,
          sortLabel: SORTS[key] || '在租最多',
        })
        this.loadBuildings()
      },
    })
  },

  handleResetFilters() {
    this.setData({
      districtFilter: '',
      gradeFilter: '',
      gradeFilterLabel: '等级',
      sortFilter: '',
      sortLabel: '在租最多',
    })
    this.loadBuildings()
  },

  handleBuildingOpen(event: WechatMiniprogram.CustomEvent<{ slug: string }>) {
    const slug = event.detail.slug
    if (!slug) return
    wx.navigateTo({
      url: `/pages/building-detail/index?slug=${encodeURIComponent(slug)}`,
    })
  },

  ensureInquirySheetController() {
    if (this.inquirySheetController === null) {
      this.inquirySheetController = createInquirySheetController({
        openIntent: submissionIntentManager.open,
        invalidateIntent: submissionIntentManager.invalidate,
        ensureAnonymousContext: sessionService.ensureAnonymousContext,
        openPrivacyContract,
        submit: inquiryService.submit,
        onChange: (snapshot) => {
          this.setData({ inquirySheet: snapshot, inquiryOpen: snapshot.state !== 'closed' })
          if (snapshot.state === 'success') void refreshUserAssets().catch(() => undefined)
        },
      })
    }
    return this.inquirySheetController
  },

  handleOpenInquiry() { void this.ensureInquirySheetController().open(generalInquiryContext()) },
  handleInquiryClose() { this.inquirySheetController?.close() },
  handleInquiryPrivacy() { void this.ensureInquirySheetController().verifyPrivacy() },
  handleInquiryMoveInChange(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    if (typeof event.detail.value === 'string') this.ensureInquirySheetController().setMoveInTime(event.detail.value)
  },
  handleInquiryPhoneChange(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
    if (typeof event.detail.value === 'string') this.ensureInquirySheetController().setPhone(event.detail.value)
  },
  handleInquirySelectManual() { this.ensureInquirySheetController().selectManual() },
  handleInquirySelectWechat() { this.ensureInquirySheetController().selectPhoneAuthorization() },
  handleInquiryConsentChange(event: WechatMiniprogram.CustomEvent<{ accepted: boolean }>) {
    this.ensureInquirySheetController().setConsent(event.detail.accepted === true)
  },
  handleInquiryPhoneAuthorization(event: WechatMiniprogram.CustomEvent<{ phoneCode: string }>) {
    if (typeof event.detail.phoneCode === 'string') void this.ensureInquirySheetController().submitPhoneCode(event.detail.phoneCode)
  },
  handleInquiryPhoneRejected() { this.ensureInquirySheetController().rejectPhoneAuthorization() },
  handleInquiryManualSubmit() { void this.ensureInquirySheetController().submitManual() },

})
