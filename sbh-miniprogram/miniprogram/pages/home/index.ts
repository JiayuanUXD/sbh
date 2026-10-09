import { catalog } from '../../services/catalog.js'
import {
  createInquirySheetController,
  type InquirySheetContext,
  type InquirySheetController,
  type InquirySheetSnapshot,
} from '../../components/inquiry-sheet/controller.js'
import { refreshUserAssets } from '../../services/favorites.js'
import {
  createInquiryService,
  createSubmissionIntentManager,
} from '../../services/inquiry.js'
import { listingNavigation } from '../../services/listing-navigation.js'
import { request } from '../../services/request.js'
import { createSessionService } from '../../services/session.js'
import {
  createModalTabBarBoundary,
  type ModalTabBarBoundary,
} from '../../utils/modal-tab-bar-boundary.js'
import {
  createHomeLoadController,
  type HomeLoadController,
} from './controller.js'
import {
  buildSearchNavigation,
  type HomePageSnapshot,
} from './model.js'

type HomePageData = HomePageSnapshot & Readonly<{
  keyword: string
  heroVideoUrl: string
  heroPosterUrl: string
  videoFailed: boolean
  imageFailed: boolean
  inquiryOpen: boolean
  inquirySheet: InquirySheetSnapshot
  tabBarBoundaryState: 'visible' | 'hidden'
}>

type SearchSubmitEvent = Readonly<{
  detail?: Readonly<{ value?: unknown }>
}>

type NavigationTapEvent = Readonly<{
  currentTarget: Readonly<{
    dataset: Readonly<{ query?: unknown }>
  }>
}>

type ListingOpenEvent = Readonly<{
  detail: Readonly<{ slug?: unknown }>
}>

type BuildingOpenEvent = Readonly<{
  detail: Readonly<{ slug?: unknown }>
}>

type ValueEvent = Readonly<{ detail: Readonly<{ value?: unknown }> }>
type ConsentEvent = Readonly<{ detail: Readonly<{ accepted?: unknown }> }>
type PhoneAuthorizationEvent = Readonly<{ detail: Readonly<{ phoneCode?: unknown }> }>

type HomePageMethods = {
  homeLoadController: HomeLoadController | null
  inquirySheetController: InquirySheetController | null
  modalTabBarBoundary: ModalTabBarBoundary | null
  inquiryOpenPromise: Promise<void> | null
  modalOpenGeneration: number
  pageActive: boolean
  ensureHomeLoadController(): HomeLoadController
  loadHome(refresh?: boolean): Promise<void>
  handleKeywordInput(event: WechatMiniprogram.Input): void
  handleSearchSubmit(event?: SearchSubmitEvent): void
  handleRetry(): void
  handleQuickFilter(event: NavigationTapEvent): void
  openListings(query: string): void
  handleListingOpen(event: ListingOpenEvent): void
  handleBrowseBuildings(): void
  handleBuildingOpenDirect(event: BuildingOpenEvent): void
  handleVideoError(): void
  handleImageError(): void
  ensureInquirySheetController(): InquirySheetController
  ensureModalTabBarBoundary(): ModalTabBarBoundary
  showModalTabBarBoundary(): Promise<boolean>
  restoreModalTabBarBoundary(): Promise<boolean>
  closeInquiryForLifecycle(): void
  handleOpenInquiry(): Promise<void>
  handleInquiryClose(): void
  handleInquiryPrivacy(): void
  handleInquiryMoveInChange(event: ValueEvent): void
  handleInquiryPhoneChange(event: ValueEvent): void
  handleInquirySelectManual(): void
  handleInquirySelectWechat(): void
  handleInquiryConsentChange(event: ConsentEvent): void
  handleInquiryPhoneAuthorization(event: PhoneAuthorizationEvent): void
  handleInquiryPhoneRejected(): void
  handleInquiryManualSubmit(): void
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

function generalInquiryContext(policyVersion: string): InquirySheetContext {
  return {
    target: { targetType: 'general' },
    title: '告诉我们办公需求',
    facts: { area: '全上海', unitPrice: '多种计价', monthlyEstimate: '按需求匹配' },
    policyVersion,
  }
}

const sessionService = createSessionService({ login: requestLoginCode, request })
const inquiryService = createInquiryService({
  request,
  getAnonymousContextToken: sessionService.getToken,
  clearAnonymousContext: sessionService.clear,
})
const submissionIntentManager = createSubmissionIntentManager()

function currentSnapshot(data: HomePageData): HomePageSnapshot {
  return {
    state: data.state,
    content: data.content,
    refreshError: data.refreshError,
  }
}

Page<HomePageData, HomePageMethods>({
  data: {
    state: 'idle',
    content: null,
    refreshError: false,
    keyword: '',
    heroVideoUrl: '/api/media/file/hero-bg.mp4?prefix=media',
    heroPosterUrl: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?q=80&w=1200&auto=format&fit=crop',
    videoFailed: false,
    imageFailed: false,
    inquiryOpen: false,
    inquirySheet: closedInquirySheet(),
    tabBarBoundaryState: 'visible',
  },

  homeLoadController: null,
  inquirySheetController: null,
  modalTabBarBoundary: null,
  inquiryOpenPromise: null,
  modalOpenGeneration: 0,
  pageActive: true,

  onLoad() {
    void this.loadHome(false)
  },

  onShow() {
    this.pageActive = true
    void this.restoreModalTabBarBoundary()
  },

  onHide() {
    this.pageActive = false
    this.modalOpenGeneration += 1
    this.inquiryOpenPromise = null
    this.closeInquiryForLifecycle()
  },

  onUnload() {
    this.pageActive = false
    this.modalOpenGeneration += 1
    this.inquiryOpenPromise = null
    this.homeLoadController?.invalidate()
    this.closeInquiryForLifecycle()
    sessionService.clear()
    this.homeLoadController = null
  },

  onPullDownRefresh() {
    return this.loadHome(true)
  },

  ensureHomeLoadController() {
    if (this.homeLoadController === null) {
      this.homeLoadController = createHomeLoadController({
        getHome: () => catalog.getHome('shanghai'),
        getSnapshot: () => currentSnapshot(this.data),
        setSnapshot: (snapshot) => this.setData(snapshot),
        stopPullDownRefresh: () => wx.stopPullDownRefresh(),
      })
    }
    return this.homeLoadController
  },

  loadHome(refresh = false) {
    return this.ensureHomeLoadController().load(refresh)
  },

  handleKeywordInput(event) {
    this.setData({ keyword: event.detail.value })
  },

  handleSearchSubmit(event) {
    const submittedValue = event?.detail?.value
    const keyword = typeof submittedValue === 'string' ? submittedValue : this.data.keyword
    this.setData({ keyword })
    this.openListings(buildSearchNavigation(keyword))
  },

  handleRetry() {
    void this.loadHome(false)
  },

  handleQuickFilter(event) {
    const query = event.currentTarget.dataset.query
    if (typeof query !== 'string') return
    this.openListings(query)
  },

  openListings(query) {
    void listingNavigation.open(query).catch(() => {
      wx.showToast({
        title: '暂时无法打开找房页',
        icon: 'none',
        duration: 1600,
      })
    })
  },

  handleListingOpen(event) {
    const slug = event.detail.slug
    if (typeof slug !== 'string' || !slug) return

    void listingNavigation.openDetail(slug).catch(() => {
      wx.showToast({
        title: '暂时无法打开房源详情',
        icon: 'none',
        duration: 1600,
      })
    })
  },

  handleBrowseBuildings() {
    void listingNavigation.openBuildings().catch(() => {
      wx.showToast({
        title: '暂时无法打开楼盘页',
        icon: 'none',
        duration: 1600,
      })
    })
  },

  handleBuildingOpenDirect(event) {
    const slug = event.detail.slug
    if (typeof slug !== 'string' || !slug) return
    void listingNavigation.openBuildingDetail(slug).catch(() => {
      wx.showToast({
        title: '暂时无法打开楼盘详情',
        icon: 'none',
        duration: 1600,
      })
    })
  },

  handleVideoError() {
    this.setData({ videoFailed: true })
  },

  handleImageError() {
    this.setData({ imageFailed: true })
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

  ensureModalTabBarBoundary() {
    if (this.modalTabBarBoundary === null) {
      this.modalTabBarBoundary = createModalTabBarBoundary({
        hideTabBar: () => new Promise<void>((resolve, reject) => {
          wx.hideTabBar({ animation: false, success: () => resolve(), fail: reject })
        }),
        showTabBar: () => new Promise<void>((resolve, reject) => {
          wx.showTabBar({ animation: false, success: () => resolve(), fail: reject })
        }),
        onChange: (state) => this.setData({ tabBarBoundaryState: state }),
      })
    }
    return this.modalTabBarBoundary
  },

  showModalTabBarBoundary() {
    return this.ensureModalTabBarBoundary().hide()
  },

  async restoreModalTabBarBoundary() {
    if (this.modalTabBarBoundary === null) return true
    return this.modalTabBarBoundary.restore()
  },

  closeInquiryForLifecycle() {
    this.inquirySheetController?.dispose()
    this.inquirySheetController = null
    submissionIntentManager.invalidate()
    this.setData({ inquiryOpen: false, inquirySheet: closedInquirySheet() })
    void this.restoreModalTabBarBoundary()
  },

  handleOpenInquiry() {
    if (this.data.inquiryOpen) return Promise.resolve()
    if (this.inquiryOpenPromise !== null) return this.inquiryOpenPromise

    const owner = ++this.modalOpenGeneration
    let opening!: Promise<void>
    opening = (async () => {
      const hidden = await this.showModalTabBarBoundary()
      if (owner !== this.modalOpenGeneration || !this.pageActive) return
      if (!hidden) {
        wx.showToast({ title: '暂时无法打开咨询', icon: 'none', duration: 1600 })
        return
      }
      const controller = this.ensureInquirySheetController()
      if (owner !== this.modalOpenGeneration || !this.pageActive) return
      const policyVersion = this.data.content?.inquiryPolicy.version
      if (!policyVersion) {
        void this.restoreModalTabBarBoundary()
        wx.showToast({ title: '咨询服务暂不可用', icon: 'none', duration: 1600 })
        return
      }
      void controller.open(generalInquiryContext(policyVersion))
    })().finally(() => {
      if (this.inquiryOpenPromise === opening) this.inquiryOpenPromise = null
    })
    this.inquiryOpenPromise = opening
    return opening
  },
  handleInquiryClose() {
    this.inquirySheetController?.close()
    if (this.inquirySheetController?.snapshot().state === 'closed') void this.restoreModalTabBarBoundary()
  },
  handleInquiryPrivacy() { void this.ensureInquirySheetController().verifyPrivacy() },
  handleInquiryMoveInChange(event) {
    if (typeof event.detail.value === 'string') this.ensureInquirySheetController().setMoveInTime(event.detail.value)
  },
  handleInquiryPhoneChange(event) {
    if (typeof event.detail.value === 'string') this.ensureInquirySheetController().setPhone(event.detail.value)
  },
  handleInquirySelectManual() { this.ensureInquirySheetController().selectManual() },
  handleInquirySelectWechat() { this.ensureInquirySheetController().selectPhoneAuthorization() },
  handleInquiryConsentChange(event) { this.ensureInquirySheetController().setConsent(event.detail.accepted === true) },
  handleInquiryPhoneAuthorization(event) {
    if (typeof event.detail.phoneCode === 'string') void this.ensureInquirySheetController().submitPhoneCode(event.detail.phoneCode)
  },
  handleInquiryPhoneRejected() { this.ensureInquirySheetController().rejectPhoneAuthorization() },
  handleInquiryManualSubmit() { void this.ensureInquirySheetController().submitManual() },
})
