const { cancelPagePermissionCheck, requirePagePermission } = require("../../shared/pageAuth")
const { formatToastTitle } = require("../../shared/uiFeedback")
const { clearUnsaved, markUnsaved } = require("../../shared/unsavedChanges")
const PERMISSION_OPTIONS = [
  {
    value: "vehicle_manage",
    label: "车辆管理",
    desc: "维护车辆档案与状态",
    icon: "car"
  },
  {
    value: "booking_manage",
    label: "预约管理",
    desc: "处理预约与协调进度",
    icon: "calendar"
  }
]
const OPENID_PATTERN = /^[A-Za-z0-9_-]{6,128}$/
const ROLE_LIST_TIMEOUT_MS = 15 * 1000
const ROLE_SAVE_TIMEOUT_MS = 20 * 1000
function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return []
  }
  const list = []
  value.forEach((item) => {
    const text = String(item || "").trim()
    if (text && !list.includes(text)) {
      list.push(text)
    }
  })
  return list
}
function buildPermissionOptions(selectedPermissions) {
  const selected = normalizeStringArray(selectedPermissions)
  return PERMISSION_OPTIONS.map((item) => ({
    ...item,
    active: selected.includes(item.value)
  }))
}
function buildPermissionText(permissions, isAdmin) {
  if (isAdmin) {
    return "管理员（全部权限）"
  }
  const list = normalizeStringArray(permissions)
  if (!list.length) {
    return "普通成员"
  }
  return list
    .map((item) => {
      const target = PERMISSION_OPTIONS.find((option) => option.value === item)
      return target ? target.label : item
    })
    .join(" / ")
}
Page({
  data: {
    initialLoading: true,
    loading: false,
    saving: false,
    pageAuthorized: false,
    list: [],
    page: 0,
    pageSize: 20,
    hasMore: false,
    permissionOptions: buildPermissionOptions([]),
    formOpenid: "",
    selectedPermissions: [],
    editingOpenid: "",
    emptyTitle: "暂无权限记录",
    emptyDesc: "当前只有管理员或尚未分配运营权限"
  },
  onLoad() {
    requirePagePermission(this, {
      required: "canManageRoles",
      noPermissionMessage: "无权访问权限管理",
      onAuthorized: () => {
        this.fetchRoleList()
      }
    })
  },
  onPullDownRefresh() {
    if (!this.data.pageAuthorized || this.isRoleInteractionBusy()) {
      wx.stopPullDownRefresh()
      return
    }
    this.fetchRoleList({ append: false }, () => {
      wx.stopPullDownRefresh()
    })
  },
  onUnload() {
    cancelPagePermissionCheck(this)
    this._roleListRequestId = Number(this._roleListRequestId || 0) + 1
    this._roleSaveRequestId = Number(this._roleSaveRequestId || 0) + 1
    this.finishRoleListRequestEffects()
    this.finishRoleSaveRequestEffects()
  },
  isRoleInteractionBusy() {
    return Boolean(
      this.data.initialLoading ||
      this.data.loading ||
      this.data.saving
    )
  },
  fetchRoleList(input, done) {
    if (typeof input === "function") {
      done = input
      input = null
    }
    if (this.data.saving) {
      if (typeof done === "function") {
        done()
      }
      return
    }
    const append = Boolean(input && input.append)
    const nextPage = append ? this.data.page + 1 : 0
    const requestId = Number(this._roleListRequestId || 0) + 1
    this._roleListRequestId = requestId
    this.finishRoleListRequestEffects()
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      wx.showToast({
        title: "云能力未初始化",
        icon: "none"
      })
      this.setData({
        initialLoading: false,
        loading: false
      })
      if (typeof done === "function") {
        done()
      }
      return
    }
    this._roleListRequestDone = typeof done === "function" ? done : null
    this.setData({ loading: true })
    let settled = false
    const finishRequest = () => {
      if (settled || this._roleListRequestId !== requestId) {
        return false
      }
      settled = true
      this.finishRoleListRequestEffects()
      return true
    }
    const handleFailure = (message) => {
      if (!finishRequest()) {
        return
      }
      wx.showToast({
        title: message,
        icon: "none"
      })
      this.setData({
        initialLoading: false,
        loading: false,
        list: append ? this.data.list : [],
        page: append ? this.data.page : 0,
        hasMore: append ? this.data.hasMore : false
      })
    }
    this._roleListRequestTimer = setTimeout(() => {
      handleFailure("加载超时，请检查网络后重试")
    }, ROLE_LIST_TIMEOUT_MS)
    const requestOptions = {
      name: "roleList",
      data: {
        page: nextPage,
        pageSize: this.data.pageSize
      },
      success: (res) => {
        if (!finishRequest()) {
          return
        }
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          wx.showToast({
          title: formatToastTitle(result && result.message, "加载失败"),
            icon: "none"
          })
          this.setData({
            initialLoading: false,
            loading: false,
            list: append ? this.data.list : [],
            page: append ? this.data.page : 0,
            hasMore: append ? this.data.hasMore : false
          })
          return
        }
        const list = Array.isArray(result.list)
          ? result.list.map((item) => ({
              ...item,
              permissionText: buildPermissionText(item.permissions, item.isAdmin)
            }))
          : []
        this.setData({
          initialLoading: false,
          loading: false,
          page: Number.isInteger(result.page) ? result.page : nextPage,
          hasMore: Boolean(result.hasMore),
          list: append ? this.data.list.concat(list) : list
        })
      },
      fail: (error) => {
        handleFailure(
          formatToastTitle(error && (error.errMsg || error.message), "加载失败")
        )
      },
      complete: () => {}
    }
    try {
      wx.cloud.callFunction(requestOptions)
    } catch (error) {
      handleFailure(
        formatToastTitle(error && (error.errMsg || error.message), "加载失败")
      )
    }
  },
  handleLoadMore() {
    if (this.data.loading || this.data.saving || !this.data.hasMore) {
      return
    }
    this.fetchRoleList({ append: true })
  },
  handleOpenidInput(event) {
    if (this.isRoleInteractionBusy() || this.data.editingOpenid) {
      return
    }
    this.setData({
      formOpenid: String((event.detail && event.detail.value) || "").trim()
    })
    markUnsaved(this, "权限修改尚未保存，确定离开吗？")
  },
  handleTogglePermission(event) {
    if (this.isRoleInteractionBusy()) {
      return
    }
    const value = String(event.currentTarget.dataset.value || "").trim()
    if (!value) {
      return
    }
    const selected = normalizeStringArray(this.data.selectedPermissions)
    const nextSelected = selected.includes(value) ? selected.filter((item) => item !== value) : selected.concat(value)
    this.setData({
      selectedPermissions: nextSelected,
      permissionOptions: buildPermissionOptions(nextSelected)
    })
    markUnsaved(this, "权限修改尚未保存，确定离开吗？")
  },
  handleEditRole(event) {
    if (this.isRoleInteractionBusy()) {
      return
    }
    const openid = String(event.currentTarget.dataset.openid || "").trim()
    const permissions = normalizeStringArray(event.currentTarget.dataset.permissions)
    if (!openid) {
      return
    }
    if (!OPENID_PATTERN.test(openid)) {
      wx.showToast({
        title: "账号格式有误",
        icon: "none"
      })
      return
    }
    this.setData({
      editingOpenid: openid,
      formOpenid: openid,
      selectedPermissions: permissions,
      permissionOptions: buildPermissionOptions(permissions)
    })
    clearUnsaved(this)
  },
  handleResetForm() {
    if (this.isRoleInteractionBusy()) {
      return
    }
    this.setData({
      editingOpenid: "",
      formOpenid: "",
      selectedPermissions: [],
      permissionOptions: buildPermissionOptions([])
    })
    clearUnsaved(this)
  },
  handleSubmit() {
    if (this.isRoleInteractionBusy()) {
      return
    }
    const openid = String(this.data.formOpenid || "").trim()
    if (!openid) {
      wx.showToast({
        title: "请先填写账号",
        icon: "none"
      })
      return
    }
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      wx.showToast({
        title: "云能力未初始化",
        icon: "none"
      })
      return
    }
    const permissions = normalizeStringArray(this.data.selectedPermissions)
    const requestId = Number(this._roleSaveRequestId || 0) + 1
    this._roleSaveRequestId = requestId
    this.finishRoleSaveRequestEffects()
    this.setData({ saving: true })
    wx.showLoading({
      title: "保存中…",
      mask: true
    })
    this._roleSaveLoadingVisible = true
    let settled = false
    const finishRequest = () => {
      if (settled || this._roleSaveRequestId !== requestId) {
        return false
      }
      settled = true
      this.finishRoleSaveRequestEffects()
      return true
    }
    const handleFailure = (message) => {
      if (!finishRequest()) {
        return
      }
      wx.showToast({
        title: message,
        icon: "none"
      })
      this.setData({ saving: false })
    }
    this._roleSaveRequestTimer = setTimeout(() => {
      handleFailure("保存超时，请检查网络后重试")
    }, ROLE_SAVE_TIMEOUT_MS)
    const requestOptions = {
      name: "roleUpsert",
      data: {
        openid,
        permissions
      },
      success: (res) => {
        if (!finishRequest()) {
          return
        }
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          wx.showToast({
          title: formatToastTitle(result && result.message, "保存失败"),
            icon: "none"
          })
          this.setData({ saving: false })
          return
        }
        wx.showToast({
        title: formatToastTitle(result.message, "保存成功"),
          icon: "success"
        })
        this.setData({ saving: false })
        this.handleResetForm()
        this.fetchRoleList()
      },
      fail: (error) => {
        handleFailure(
          formatToastTitle(error && (error.errMsg || error.message), "保存失败")
        )
      },
      complete: () => {}
    }
    try {
      wx.cloud.callFunction(requestOptions)
    } catch (error) {
      handleFailure(
        formatToastTitle(error && (error.errMsg || error.message), "保存失败")
      )
    }
  },
  finishRoleListRequestEffects() {
    if (this._roleListRequestTimer) {
      clearTimeout(this._roleListRequestTimer)
      this._roleListRequestTimer = null
    }
    const done = this._roleListRequestDone
    this._roleListRequestDone = null
    if (typeof done === "function") {
      done()
    }
  },
  finishRoleSaveRequestEffects() {
    if (this._roleSaveRequestTimer) {
      clearTimeout(this._roleSaveRequestTimer)
      this._roleSaveRequestTimer = null
    }
    if (this._roleSaveLoadingVisible) {
      this._roleSaveLoadingVisible = false
      wx.hideLoading()
    }
  }
})
