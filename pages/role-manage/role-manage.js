const { requirePagePermission } = require("../../shared/pageAuth")
const { formatToastTitle } = require("../../shared/uiFeedback")

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
    this.fetchRoleList({ append: false }, () => {
      wx.stopPullDownRefresh()
    })
  },

  fetchRoleList(input, done) {
    if (typeof input === "function") {
      done = input
      input = null
    }

    const append = Boolean(input && input.append)
    const nextPage = append ? this.data.page + 1 : 0

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

    this.setData({ loading: true })

    wx.cloud.callFunction({
      name: "roleList",
      data: {
        page: nextPage,
        pageSize: this.data.pageSize
      },
      success: (res) => {
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
          if (typeof done === "function") {
            done()
          }
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
        if (typeof done === "function") {
          done()
        }
      },
      fail: (error) => {
        wx.showToast({
          title: "加载失败",
          icon: "none"
        })
        this.setData({
          initialLoading: false,
          loading: false,
          list: append ? this.data.list : [],
          page: append ? this.data.page : 0,
          hasMore: append ? this.data.hasMore : false
        })
        if (typeof done === "function") {
          done()
        }
      }
    })
  },

  handleLoadMore() {
    if (this.data.loading || !this.data.hasMore) {
      return
    }

    this.fetchRoleList({ append: true })
  },

  handleOpenidInput(event) {
    if (this.data.editingOpenid) {
      return
    }

    this.setData({
      formOpenid: String((event.detail && event.detail.value) || "").trim()
    })
  },

  handleTogglePermission(event) {
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
  },

  handleEditRole(event) {
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
  },

  handleResetForm() {
    this.setData({
      editingOpenid: "",
      formOpenid: "",
      selectedPermissions: [],
      permissionOptions: buildPermissionOptions([])
    })
  },

  handleSubmit() {
    if (this.data.saving) {
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

    this.setData({ saving: true })
    wx.showLoading({
      title: "保存中…",
      mask: true
    })

    wx.cloud.callFunction({
      name: "roleUpsert",
      data: {
        openid,
        permissions: this.data.selectedPermissions
      },
      success: (res) => {
        wx.hideLoading()
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
        wx.hideLoading()
        wx.showToast({
          title: "保存失败",
          icon: "none"
        })
        this.setData({ saving: false })
      }
    })
  }
})
