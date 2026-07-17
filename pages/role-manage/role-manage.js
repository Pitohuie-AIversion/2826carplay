const PERMISSION_OPTIONS = [
  { value: "vehicle_manage", label: "车辆管理" },
  { value: "booking_manage", label: "预约管理" }
]

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
    loading: false,
    saving: false,
    list: [],
    permissionOptions: buildPermissionOptions([]),
    formOpenid: "",
    selectedPermissions: [],
    editingOpenid: "",
    emptyTitle: "暂无权限记录",
    emptyDesc: "当前只有管理员或尚未分配运营权限"
  },

  onLoad() {
    this.fetchRoleList()
  },

  onPullDownRefresh() {
    this.fetchRoleList(() => {
      wx.stopPullDownRefresh()
    })
  },

  fetchRoleList(done) {
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      wx.showToast({
        title: "云能力未初始化",
        icon: "none"
      })
      if (typeof done === "function") {
        done()
      }
      return
    }

    this.setData({ loading: true })

    wx.cloud.callFunction({
      name: "roleList",
      success: (res) => {
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          wx.showToast({
            title: (result && result.message) || "加载失败",
            icon: "none"
          })
          this.setData({
            loading: false,
            list: []
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
          loading: false,
          list
        })
        if (typeof done === "function") {
          done()
        }
      },
      fail: (error) => {
        wx.showToast({
          title: (error && (error.errMsg || error.message)) || "加载失败",
          icon: "none"
        })
        this.setData({
          loading: false,
          list: []
        })
        if (typeof done === "function") {
          done()
        }
      }
    })
  },

  handleOpenidInput(event) {
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
        title: "请先填写 OpenID",
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
      title: "保存中"
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
            title: (result && result.message) || "保存失败",
            icon: "none"
          })
          this.setData({ saving: false })
          return
        }

        wx.showToast({
          title: result.message || "保存成功",
          icon: "success"
        })
        this.setData({ saving: false })
        this.handleResetForm()
        this.fetchRoleList()
      },
      fail: (error) => {
        wx.hideLoading()
        wx.showToast({
          title: (error && (error.errMsg || error.message)) || "保存失败",
          icon: "none"
        })
        this.setData({ saving: false })
      }
    })
  }
})
