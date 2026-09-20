const { cancelPagePermissionCheck, requirePagePermission } = require("../../shared/pageAuth")
const { buildMonthView, normalizeMonthKey, shiftMonth } = require("../../shared/bookingCalendar")
const { clearUnsaved, markUnsaved } = require("../../shared/unsavedChanges")
const {
  activatePageNativeActions,
  beginPageNativeAction,
  cancelPageNativeActions,
  isPageNativeActionActive
} = require("../../shared/pageNativeAction")

const CURRENT_MONTH_KEY = normalizeMonthKey("")
function getCalendarSnapshotKey(monthKey) {
  return `booking_calendar_${monthKey || "current"}`
}
const BOOKING_CALENDAR_LOAD_TIMEOUT_MS = 15 * 1000
const CALENDAR_SAVE_TIMEOUT_MS = 15 * 1000
const BLOCK_KIND_OPTIONS = [
  { value: "maintenance", label: "维修保养" },
  { value: "hold", label: "人工保留" },
  { value: "unavailable", label: "其他不可用" }
]
const BLOCK_KIND_LABELS = {
  booking: "已确认预约",
  maintenance: "维修保养",
  hold: "人工保留",
  unavailable: "其他不可用"
}

const STATUS_LABELS = {
  pending: "待联系",
  contacted: "已联系",
  quoted: "已报价",
  adjustment_requested: "待调整",
  confirmed: "已确认",
  completed: "已完成"
}

function formatBooking(item) {
  const status = String(item.status || "pending")
  return {
    ...item,
    statusLabel: STATUS_LABELS[status] || "待处理",
    statusClass: `status-${status}`
  }
}

function isInDate(item, date) {
  return Boolean(date && String(item.startDate || "") <= date && String(item.endDate || item.startDate || "") >= date)
}

function formatBlock(item) {
  const kind = String(item.kind || "unavailable")
  return { ...item, kindLabel: BLOCK_KIND_LABELS[kind] || "不可用", canEdit: true }
}

Page({
  data: {
    pageAuthorized: false,
    loading: true,
    loadError: "",
    monthKey: "",
    currentMonthKey: CURRENT_MONTH_KEY,
    isCurrentMonth: true,
    monthTitle: "",
    selectedDate: "",
    weekdayLabels: ["日", "一", "二", "三", "四", "五", "六"],
    calendarCells: [],
    selectedBookings: [],
    allBookings: [],
    allBlocks: [],
    allPriceRules: [],
    selectedBlocks: [],
    selectedPriceRules: [],
    vehicles: [],
    vehicleOptions: [],
    blockKindOptions: BLOCK_KIND_OPTIONS,
    blockKindLabels: BLOCK_KIND_OPTIONS.map((item) => item.label),
    blockKindIndex: 0,
    blockVehicleIndex: 0,
    priceVehicleIndex: 0,
    editingBlockId: "",
    editingRuleId: "",
    isSavingCalendar: false,
    blockForm: { vehicleId: "", kind: "maintenance", startDate: "", endDate: "", reason: "" },
    priceForm: { vehicleId: "", label: "", startDate: "", endDate: "", dailyPrice: "", reason: "" },
    summary: {
      bookingCount: 0,
      pendingCount: 0,
      vehicleCount: 0,
      conflictDayCount: 0
    },
    selectedConflictCount: 0,
    truncated: false
  },

  onLoad() {
    activatePageNativeActions(this)
    const monthKey = this.data.currentMonthKey
    this.setData({ monthKey, isCurrentMonth: true })
    this.restoreCalendarSnapshot(monthKey)
    requirePagePermission(this, {
      required: "canManageBookings",
      noPermissionMessage: "无权查看预约日历",
      onAuthorized: () => this.fetchBookings()
    })
  },

  restoreCalendarSnapshot(monthKey) {
    if (typeof wx === "undefined" || typeof wx.getStorageSync !== "function") {
      return false
    }
    try {
      const cached = wx.getStorageSync(getCalendarSnapshotKey(monthKey))
      if (!cached || typeof cached !== "object") {
        return false
      }
      const allBookings = Array.isArray(cached.list) ? cached.list : []
      const allBlocks = Array.isArray(cached.blocks) ? cached.blocks : []
      const allPriceRules = Array.isArray(cached.priceRules) ? cached.priceRules : []
      const vehicles = Array.isArray(cached.vehicles) ? cached.vehicles : []
      const vehicleOptions = vehicles.map((item) => `${item.name} · 日租${item.priceDay ? `￥${item.priceDay}` : "待定"}`)
      this.setData({
        allBookings,
        allBlocks,
        allPriceRules,
        vehicles,
        vehicleOptions,
        truncated: Boolean(cached.truncated),
        loading: false
      })
      this.applyCalendar()
      this._hasCalendarSnapshot = true
      return true
    } catch (error) {
      return false
    }
  },

  onPullDownRefresh() {
    if (!this.data.pageAuthorized) {
      wx.stopPullDownRefresh()
      return
    }
    this.fetchBookings(() => wx.stopPullDownRefresh())
  },

  onUnload() {
    cancelPagePermissionCheck(this)
    cancelPageNativeActions(this)
    clearUnsaved(this)
    this._bookingCalendarRequestId =
      Number(this._bookingCalendarRequestId || 0) + 1
    this.finishBookingCalendarRequestEffects()
    if (this._calendarSaveTimer) {
      clearTimeout(this._calendarSaveTimer)
      this._calendarSaveTimer = null
    }
  },

  handlePreviousMonth() {
    this.changeMonth(-1)
  },

  handleNextMonth() {
    this.changeMonth(1)
  },

  handleCurrentMonth() {
    if (this.data.monthKey === this.data.currentMonthKey) {
      return
    }
    const monthKey = this.data.currentMonthKey
    this.setData({
      monthKey,
      selectedDate: "",
      isCurrentMonth: true
    })
    this.restoreCalendarSnapshot(monthKey)
    this.fetchBookings()
  },

  changeMonth(offset) {
    const monthKey = shiftMonth(this.data.monthKey, offset)
    this.setData({
      monthKey,
      selectedDate: "",
      isCurrentMonth: monthKey === this.data.currentMonthKey
    })
    this.restoreCalendarSnapshot(monthKey)
    this.fetchBookings()
  },

  handleDateTap(event) {
    const date = String(event.currentTarget.dataset.date || "")
    if (!date) {
      return
    }
    const blockForm = this.data.blockForm || {}
    const priceForm = this.data.priceForm || {}
    this.setData({
      selectedDate: date,
      blockForm: { ...blockForm, startDate: blockForm.startDate || date, endDate: blockForm.endDate || date },
      priceForm: { ...priceForm, startDate: priceForm.startDate || date, endDate: priceForm.endDate || date }
    })
    this.applyCalendar()
  },

  handleBookingTap(event) {
    const id = String(event.currentTarget.dataset.id || "")
    if (!id) {
      return
    }
    const action = beginPageNativeAction(this)
    wx.navigateTo({
      url: `/pages/booking-manage-detail/booking-manage-detail?id=${id}`,
      fail: () => {
        if (!isPageNativeActionActive(this, action)) {
          return
        }
        wx.showToast({
          title: "预约详情打开失败",
          icon: "none"
        })
      }
    })
  },

  handleSyncBookingOccupancy(event) {
    const id = String(event.currentTarget.dataset.id || "")
    if (id) this.saveCalendarChange("syncBookingOccupancy", { id })
  },

  handleRetry() {
    this.fetchBookings()
  },

  applyCalendar() {
    const view = buildMonthView(
      this.data.monthKey,
      this.data.allBookings,
      this.data.selectedDate
    )
    const blocks = Array.isArray(this.data.allBlocks) ? this.data.allBlocks : []
    const priceRules = Array.isArray(this.data.allPriceRules) ? this.data.allPriceRules : []
    const cells = view.cells.map((cell) => {
      if (cell.empty) return cell
      const blockCount = blocks.filter((item) => isInDate(item, cell.date)).length
      return { ...cell, blockCount, hasBlocked: blockCount > 0, ariaLabel: `${cell.ariaLabel}${blockCount ? `，${blockCount} 条不可用占用` : ""}` }
    })
    this.setData({
      monthKey: view.monthKey,
      isCurrentMonth: view.monthKey === this.data.currentMonthKey,
      monthTitle: view.monthTitle,
      selectedDate: view.selectedDate,
      calendarCells: cells,
      selectedBookings: view.selectedBookings.map((item) => formatBooking({
        ...item,
        occupancyMissing: item.status === "confirmed" && !blocks.some((block) => block.kind === "booking" && block.bookingId === item.id)
      })),
      selectedBlocks: blocks.filter((item) => isInDate(item, view.selectedDate)).map(formatBlock),
      selectedPriceRules: priceRules.filter((item) => isInDate(item, view.selectedDate)),
      selectedConflictCount: view.selectedConflictCount,
      summary: view.summary
    })
  },

  fetchBookings(done) {
    this.finishBookingCalendarRequestEffects()
    const requestId = Number(this._bookingCalendarRequestId || 0) + 1
    this._bookingCalendarRequestId = requestId
    this._bookingCalendarRequestDone =
      typeof done === "function" ? done : null

    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      this.setData({
        loading: false,
        loadError: "云能力未初始化"
      })
      this.finishBookingCalendarRequestEffects()
      return
    }

    const monthKey = String(this.data.monthKey || "")
    const showSkeleton = !this._hasCalendarSnapshot
    this._hasCalendarSnapshot = false
    this.setData({
      loading: showSkeleton,
      loadError: ""
    })
    let settled = false
    const finishRequest = () => {
      if (settled || this._bookingCalendarRequestId !== requestId) {
        return false
      }
      settled = true
      this.finishBookingCalendarRequestEffects()
      return true
    }
    const handleFailure = (message) => {
      if (!finishRequest()) {
        return
      }
      this.setData({
        loading: false,
        loadError: message || "预约日历加载失败"
      })
    }

    this._bookingCalendarRequestTimer = setTimeout(() => {
      handleFailure("日历加载超时，请重试")
    }, BOOKING_CALENDAR_LOAD_TIMEOUT_MS)

    const requestOptions = {
      name: "bookingCalendarList",
      data: {
        month: monthKey
      },
      success: (res) => {
        if (!finishRequest()) {
          return
        }
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          this.setData({
            loading: false,
            loadError: (result && result.message) || "预约日历加载失败"
          })
          return
        }
        if (typeof wx !== "undefined" && typeof wx.setStorageSync === "function") {
          try {
            wx.setStorageSync(getCalendarSnapshotKey(monthKey), {
              list: result.list || [],
              blocks: result.blocks || [],
              priceRules: result.priceRules || [],
              vehicles: result.vehicles || [],
              truncated: Boolean(result.truncated)
            })
          } catch (e) {}
        }
        this.setData({
          loading: false,
          loadError: "",
          allBookings: Array.isArray(result.list) ? result.list : [],
          allBlocks: Array.isArray(result.blocks) ? result.blocks : [],
          allPriceRules: Array.isArray(result.priceRules) ? result.priceRules : [],
          vehicles: Array.isArray(result.vehicles) ? result.vehicles : [],
          vehicleOptions: Array.isArray(result.vehicles) ? result.vehicles.map((item) => `${item.name} · 日租${item.priceDay ? `￥${item.priceDay}` : "待定"}`) : [],
          blockForm: {
            ...this.data.blockForm,
            vehicleId: this.data.blockForm.vehicleId || String(result.vehicles && result.vehicles[0] && result.vehicles[0].id || "")
          },
          priceForm: {
            ...this.data.priceForm,
            vehicleId: this.data.priceForm.vehicleId || String(result.vehicles && result.vehicles[0] && result.vehicles[0].id || "")
          },
          truncated: Boolean(result.truncated)
        })
        this.applyCalendar()
      },
      fail: (error) => {
        handleFailure(error && (error.errMsg || error.message))
      },
      complete: () => {}
    }

    try {
      wx.cloud.callFunction(requestOptions)
    } catch (error) {
      handleFailure(error && (error.errMsg || error.message))
    }
  },

  finishBookingCalendarRequestEffects() {
    if (this._bookingCalendarRequestTimer) {
      clearTimeout(this._bookingCalendarRequestTimer)
      this._bookingCalendarRequestTimer = null
    }
    if (typeof this._bookingCalendarRequestDone === "function") {
      const done = this._bookingCalendarRequestDone
      this._bookingCalendarRequestDone = null
      done()
    }
  },

  handleBlockVehicleChange(event) {
    const index = Number(event.detail && event.detail.value)
    const vehicle = this.data.vehicles[index]
    if (vehicle) this.setData({ blockVehicleIndex: index, blockForm: { ...this.data.blockForm, vehicleId: vehicle.id } })
  },

  handlePriceVehicleChange(event) {
    const index = Number(event.detail && event.detail.value)
    const vehicle = this.data.vehicles[index]
    if (vehicle) this.setData({ priceVehicleIndex: index, priceForm: { ...this.data.priceForm, vehicleId: vehicle.id } })
  },

  handleBlockKindChange(event) {
    const index = Number(event.detail && event.detail.value)
    const option = BLOCK_KIND_OPTIONS[index]
    if (option) this.setData({ blockKindIndex: index, blockForm: { ...this.data.blockForm, kind: option.value } })
  },

  handleCalendarFormInput(event) {
    const form = String(event.currentTarget.dataset.form || "")
    const field = String(event.currentTarget.dataset.field || "")
    if (!["blockForm", "priceForm"].includes(form) || !field) return
    const value = event.detail && event.detail.value !== undefined ? String(event.detail.value) : ""
    this.setData({ [form]: { ...this.data[form], [field]: value } })
    markUnsaved(this)
  },

  handleEditBlock(event) {
    const id = String(event.currentTarget.dataset.id || "")
    const item = this.data.allBlocks.find((block) => block.id === id)
    if (!item) return
    const vehicleIndex = Math.max(0, this.data.vehicles.findIndex((vehicle) => vehicle.id === item.vehicleId))
    const kindIndex = Math.max(0, BLOCK_KIND_OPTIONS.findIndex((option) => option.value === item.kind))
    this.setData({
      editingBlockId: id,
      blockVehicleIndex: vehicleIndex,
      blockKindIndex: kindIndex,
      blockForm: { vehicleId: item.vehicleId, kind: item.kind, startDate: item.startDate, endDate: item.endDate, reason: "" }
    })
  },

  handleEditPriceRule(event) {
    const id = String(event.currentTarget.dataset.id || "")
    const item = this.data.allPriceRules.find((rule) => rule.id === id)
    if (!item) return
    const vehicleIndex = Math.max(0, this.data.vehicles.findIndex((vehicle) => vehicle.id === item.vehicleId))
    this.setData({
      editingRuleId: id,
      priceVehicleIndex: vehicleIndex,
      priceForm: { vehicleId: item.vehicleId, label: item.label, startDate: item.startDate, endDate: item.endDate, dailyPrice: String(item.dailyPrice), reason: "" }
    })
  },

  handleResetBlockForm() {
    clearUnsaved(this)
    const vehicle = this.data.vehicles[this.data.blockVehicleIndex]
    this.setData({ editingBlockId: "", blockKindIndex: 0, blockForm: { vehicleId: vehicle ? vehicle.id : "", kind: "maintenance", startDate: this.data.selectedDate, endDate: this.data.selectedDate, reason: "" } })
  },

  handleResetPriceForm() {
    clearUnsaved(this)
    const vehicle = this.data.vehicles[this.data.priceVehicleIndex]
    this.setData({ editingRuleId: "", priceForm: { vehicleId: vehicle ? vehicle.id : "", label: "", startDate: this.data.selectedDate, endDate: this.data.selectedDate, dailyPrice: "", reason: "" } })
  },

  handleSaveBlock() {
    this.saveCalendarChange(this.data.editingBlockId ? "updateBlock" : "createBlock", { ...this.data.blockForm, id: this.data.editingBlockId })
  },

  handleSavePriceRule() {
    this.saveCalendarChange(this.data.editingRuleId ? "updatePriceRule" : "createPriceRule", { ...this.data.priceForm, id: this.data.editingRuleId, dailyPrice: Number(this.data.priceForm.dailyPrice) })
  },

  handleReleaseBlock(event) {
    this.confirmRelease("releaseBlock", String(event.currentTarget.dataset.id || ""), "释放档期占用")
  },

  handleReleasePriceRule(event) {
    this.confirmRelease("releasePriceRule", String(event.currentTarget.dataset.id || ""), "停用价格规则")
  },

  confirmRelease(action, id, title) {
    if (!id || this.data.isSavingCalendar) return
    const nativeAction = beginPageNativeAction(this)
    wx.showModal({
      title,
      content: "请填写本次操作原因",
      editable: true,
      placeholderText: "必填，最多 200 字",
      confirmText: action === "releaseBlock" ? "释放" : "停用",
      confirmColor: "#d46868",
      success: (res) => {
        if (!isPageNativeActionActive(this, nativeAction)) return
        if (!res.confirm) return
        const reason = String(res.content || "").trim()
        if (!reason) {
          wx.showToast({ title: "请填写操作原因", icon: "none" })
          return
        }
        this.saveCalendarChange(action, { id, reason })
      }
    })
  },

  saveCalendarChange(action, payload) {
    if (this.data.isSavingCalendar || !wx.cloud || typeof wx.cloud.callFunction !== "function") return
    this.setData({ isSavingCalendar: true })
    let settled = false
    const finish = () => {
      if (settled) return false
      settled = true
      if (this._calendarSaveTimer) clearTimeout(this._calendarSaveTimer)
      this._calendarSaveTimer = null
      this.setData({ isSavingCalendar: false })
      return true
    }
    this._calendarSaveTimer = setTimeout(() => {
      if (finish()) wx.showToast({ title: "保存超时，请重试", icon: "none" })
    }, CALENDAR_SAVE_TIMEOUT_MS)
    wx.cloud.callFunction({
      name: "vehicleCalendarManage",
      data: { action, ...payload },
      success: (res) => {
        if (!finish()) return
        const result = res && res.result
        if (!result || !result.ok) {
          wx.showToast({ title: result && result.message || "保存失败", icon: "none" })
          return
        }
        wx.showToast({ title: "车辆日历已更新", icon: "success" })
        this.handleResetBlockForm()
        this.handleResetPriceForm()
        this.fetchBookings()
      },
      fail: () => {
        if (finish()) wx.showToast({ title: "保存失败，请重试", icon: "none" })
      }
    })
  }
})
