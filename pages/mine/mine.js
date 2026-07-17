const MENU_ITEMS = [
  {
    key: "vehicleManage",
    title: "车辆管理",
    desc: "查看已录入车辆并按状态筛选"
  },
  {
    key: "bookingManage",
    title: "预约管理",
    desc: "查看全部预约并更新状态"
  },
  {
    key: "roleManage",
    title: "权限管理",
    desc: "按 OpenID 分配车辆与预约管理权限"
  },
  {
    key: "configManage",
    title: "运营配置",
    desc: "配置品牌、电话、首页文案与预约说明"
  },
  {
    key: "auditLogManage",
    title: "审计日志",
    desc: "查看权限分配与配置变更记录"
  },
  {
    key: "bootstrapAdmin",
    title: "初始化管理员",
    desc: "仅限首次配置时使用，自动把当前账号设为首个管理员"
  },
  {
    key: "getOpenid",
    title: "查询 OpenID",
    desc: "获取当前微信用户的 OpenID 并复制"
  },
  {
    key: "vehicleCreate",
    title: "新增车辆",
    desc: "录入新的车辆信息"
  },
  {
    key: "bookings",
    title: "我的预约",
    desc: "查看已提交的预约咨询"
  },
  {
    key: "favorites",
    title: "我的收藏",
    desc: "收藏喜欢的车型，方便再次查看"
  },
  {
    key: "faq",
    title: "常见问题",
    desc: "了解预约流程、档期与取还车说明"
  },
  {
    key: "rules",
    title: "平台规则",
    desc: "价格、档期、押金和规则以客服最终确认为准"
  }
]

function buildVisibleMenuItems(options) {
  const input = options && typeof options === "object" ? options : {}
  const envVersion = input.envVersion || "release"
  const canManageVehicles = Boolean(input.canManageVehicles)
  const canManageBookings = Boolean(input.canManageBookings)
  const canManageRoles = Boolean(input.canManageRoles)
  const canManageConfig = Boolean(input.canManageConfig)
  const canViewAuditLogs = Boolean(input.canViewAuditLogs)

  return MENU_ITEMS.filter((item) => {
    if (item.key === "bootstrapAdmin" && envVersion === "release") {
      return false
    }

    if ((item.key === "vehicleManage" || item.key === "vehicleCreate") && !canManageVehicles) {
      return false
    }

    if (item.key === "bookingManage" && !canManageBookings) {
      return false
    }

    if (item.key === "roleManage" && !canManageRoles) {
      return false
    }

    if (item.key === "configManage" && !canManageConfig) {
      return false
    }

    if (item.key === "auditLogManage" && !canViewAuditLogs) {
      return false
    }

    return true
  })
}

Page({
  data: {
    brandName: "极境车库",
    servicePhone: "15715710090",
    userName: "车库来访者",
    userDesc: "静态展示页，更多个人功能将在后续版本完善",
    envVersion: "release",
    menuItems: buildVisibleMenuItems({
      envVersion: "release",
      canManageRoles: false,
      canManageConfig: false,
      canViewAuditLogs: false,
      canManageVehicles: false,
      canManageBookings: false
    })
  },

  onLoad() {
    let envVersion = "release"
    try {
      const info = wx.getAccountInfoSync ? wx.getAccountInfoSync() : null
      envVersion =
        info && info.miniProgram && info.miniProgram.envVersion
          ? info.miniProgram.envVersion
          : envVersion
    } catch (error) {}

    this.setData({
      envVersion,
      menuItems: buildVisibleMenuItems({
        envVersion,
        canManageRoles: false,
        canManageConfig: false,
        canViewAuditLogs: false,
        canManageVehicles: false,
        canManageBookings: false
      })
    })

    this.loadMyPermissions()
    this.loadOperationConfig()
  },

  loadOperationConfig() {
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      return
    }

    wx.cloud.callFunction({
      name: "operationConfigGet",
      success: (res) => {
        const result = res && res.result ? res.result : null
        if (!result || !result.ok || !result.config) {
          return
        }

        this.setData({
          brandName: result.config.brandName || this.data.brandName,
          servicePhone: result.config.servicePhone || this.data.servicePhone,
          userDesc: result.config.mineUserDesc || this.data.userDesc
        })
      },
      fail: () => {}
    })
  },

  loadMyPermissions() {
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      return
    }

    wx.cloud.callFunction({
      name: "getMyPermissions",
      success: (res) => {
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          return
        }

        this.setData({
          menuItems: buildVisibleMenuItems({
            envVersion: this.data.envVersion,
            canManageRoles: Boolean(result.canManageRoles),
            canManageConfig: Boolean(result.canManageConfig),
            canViewAuditLogs: Boolean(result.canViewAuditLogs),
            canManageVehicles: Boolean(result.canManageVehicles),
            canManageBookings: Boolean(result.canManageBookings)
          })
        })
      },
      fail: () => {}
    })
  },

  handleMenuTap(event) {
    const { key, title } = event.currentTarget.dataset

    if (key === "vehicleManage") {
      wx.navigateTo({
        url: "/pages/vehicle-manage/vehicle-manage",
        fail: () => {
          wx.showToast({
            title: "页面跳转失败",
            icon: "none"
          })
        }
      })
      return
    }

    if (key === "roleManage") {
      wx.navigateTo({
        url: "/pages/role-manage/role-manage",
        fail: () => {
          wx.showToast({
            title: "页面跳转失败",
            icon: "none"
          })
        }
      })
      return
    }

    if (key === "configManage") {
      wx.navigateTo({
        url: "/pages/config-manage/config-manage",
        fail: () => {
          wx.showToast({
            title: "页面跳转失败",
            icon: "none"
          })
        }
      })
      return
    }

    if (key === "auditLogManage") {
      wx.navigateTo({
        url: "/pages/audit-log-manage/audit-log-manage",
        fail: () => {
          wx.showToast({
            title: "页面跳转失败",
            icon: "none"
          })
        }
      })
      return
    }

    if (key === "bootstrapAdmin") {
      if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
        wx.showToast({
          title: "云能力未初始化",
          icon: "none"
        })
        return
      }

      wx.showModal({
        title: "初始化管理员",
        content: "仅当 roles 集合还没有任何记录时可用。确认将当前账号初始化为首个管理员？",
        success: (modalRes) => {
          if (!modalRes.confirm) {
            return
          }

          wx.showLoading({
            title: "初始化中"
          })

          wx.cloud.callFunction({
            name: "bootstrapAdmin",
            success: (res) => {
              wx.hideLoading()

              const result = res && res.result ? res.result : null
              const title = result && result.message ? result.message : "初始化完成"

              if (result && result.ok) {
                wx.showModal({
                  title: "管理员初始化结果",
                  content: `${title}\n\nOpenID：${(result && result.openid) || ""}`,
                  showCancel: false
                })
                return
              }

              if (result && result.code === "BOOTSTRAP_TOKEN_REQUIRED") {
                wx.showModal({
                  title: "初始化失败",
                  content: "管理员初始化已加锁，请在云函数控制台配置 BOOTSTRAP_TOKEN 后再初始化。",
                  showCancel: false
                })
                return
              }

              wx.showModal({
                title: "初始化失败",
                content: title,
                showCancel: false
              })
            },
            fail: (error) => {
              wx.hideLoading()
              wx.showToast({
                title: (error && (error.errMsg || error.message)) || "初始化失败",
                icon: "none"
              })
            }
          })
        }
      })
      return
    }

    if (key === "getOpenid") {
      if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
        wx.showToast({
          title: "云能力未初始化",
          icon: "none"
        })
        return
      }

      wx.showLoading({
        title: "查询中"
      })

      wx.cloud.callFunction({
        name: "getOpenid",
        success: (res) => {
          wx.hideLoading()

          const result = res && res.result ? res.result : null
          const openid = result && result.ok ? result.openid : ""

          if (!openid) {
            wx.showToast({
              title: "未获取到 OpenID",
              icon: "none"
            })
            return
          }

          wx.setClipboardData({
            data: openid,
            success: () => {
              wx.showModal({
                title: "OpenID 已复制",
                content: openid,
                showCancel: false
              })
            },
            fail: () => {
              wx.showModal({
                title: "当前 OpenID",
                content: openid,
                showCancel: false
              })
            }
          })
        },
        fail: (error) => {
          wx.hideLoading()
          wx.showToast({
            title: (error && (error.errMsg || error.message)) || "查询失败",
            icon: "none"
          })
        }
      })
      return
    }

    if (key === "vehicleCreate") {
      wx.navigateTo({
        url: "/pages/vehicle-create/vehicle-create",
        fail: () => {
          wx.showToast({
            title: "页面跳转失败",
            icon: "none"
          })
        }
      })
      return
    }

    if (key === "bookingManage") {
      wx.navigateTo({
        url: "/pages/booking-manage/booking-manage",
        fail: () => {
          wx.showToast({
            title: "页面跳转失败",
            icon: "none"
          })
        }
      })
      return
    }

    if (key === "bookings") {
      wx.navigateTo({
        url: "/pages/bookings/bookings",
        fail: () => {
          wx.showToast({
            title: "页面跳转失败",
            icon: "none"
          })
        }
      })
      return
    }

    if (key === "faq") {
      wx.navigateTo({
        url: "/pages/content-page/content-page?type=faq",
        fail: () => {
          wx.showToast({
            title: "页面跳转失败",
            icon: "none"
          })
        }
      })
      return
    }

    if (key === "rules") {
      wx.navigateTo({
        url: "/pages/content-page/content-page?type=rules",
        fail: () => {
          wx.showToast({
            title: "页面跳转失败",
            icon: "none"
          })
        }
      })
      return
    }

    wx.showToast({
      title: `${title} 即将开放`,
      icon: "none"
    })
  },

  handlePhoneCall() {
    wx.makePhoneCall({
      phoneNumber: this.data.servicePhone,
      fail: () => {
        wx.showToast({
          title: `请联系客服：${this.data.servicePhone}`,
          icon: "none"
        })
      }
    })
  },

  handleBackHome() {
    const pages = getCurrentPages()

    if (pages.length > 1) {
      wx.navigateBack({
        delta: 1,
        fail: () => {
          wx.redirectTo({
            url: "/pages/garage/garage"
          })
        }
      })
      return
    }

    wx.redirectTo({
      url: "/pages/garage/garage",
      fail: () => {
        wx.reLaunch({
          url: "/pages/garage/garage"
        })
      }
    })
  }
})
