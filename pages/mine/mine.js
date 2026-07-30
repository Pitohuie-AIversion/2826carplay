const MENU_ITEMS = [
  { key: "bookings", title: "我的预约", desc: "查看已提交的预约咨询", section: "会员服务", sectionKicker: "MEMBER", glyph: "订" },
  { key: "favorites", title: "我的收藏", desc: "收藏喜欢的车型，方便再次查看", section: "会员服务", sectionKicker: "MEMBER", glyph: "藏" },
  { key: "faq", title: "常见问题", desc: "了解预约流程、档期与取还车说明", section: "会员服务", sectionKicker: "MEMBER", glyph: "问" },
  { key: "rules", title: "平台规则", desc: "价格、档期、押金和规则以客服最终确认为准", section: "会员服务", sectionKicker: "MEMBER", glyph: "规" },
  { key: "privacy", title: "隐私政策", desc: "了解个人信息的收集、使用与删除方式", section: "会员服务", sectionKicker: "MEMBER", glyph: "隐" },
  { key: "privacyRequest", title: "个人信息申请", desc: "提交查询、更正或删除申请并查看处理进度", section: "会员服务", sectionKicker: "MEMBER", glyph: "申" },
  { key: "operationsOverview", title: "运营概览", desc: "集中查看预约、车辆状态与待办提醒", section: "运营管理", sectionKicker: "OPERATIONS", glyph: "览" },
  { key: "analyticsManage", title: "数据分析", desc: "查看车辆热度、预约漏斗与行为趋势", section: "运营管理", sectionKicker: "OPERATIONS", glyph: "析" },
  { key: "bookingWorkbench", title: "待协调工作台", desc: "集中处理优先、候补与超时预约", section: "运营管理", sectionKicker: "OPERATIONS", glyph: "协" },
  { key: "bookingCalendar", title: "预约日历", desc: "按月查看每日预约与车辆档期安排", section: "运营管理", sectionKicker: "OPERATIONS", glyph: "历" },
  { key: "vehicleManage", title: "车辆管理", desc: "查看已录入车辆并按状态筛选", section: "运营管理", sectionKicker: "OPERATIONS", glyph: "车" },
  { key: "vehicleCreate", title: "新增车辆", desc: "录入新的车辆信息", section: "运营管理", sectionKicker: "OPERATIONS", glyph: "新" },
  { key: "bookingManage", title: "预约管理", desc: "查看全部预约并更新状态", section: "运营管理", sectionKicker: "OPERATIONS", glyph: "约" },
  { key: "roleManage", title: "权限管理", desc: "按 OpenID 分配车辆与预约管理权限", section: "系统管理", sectionKicker: "SYSTEM", glyph: "权" },
  { key: "configManage", title: "运营配置", desc: "配置品牌、电话、首页文案与预约说明", section: "系统管理", sectionKicker: "SYSTEM", glyph: "配" },
  { key: "auditLogManage", title: "审计日志", desc: "查看权限分配与配置变更记录", section: "系统管理", sectionKicker: "SYSTEM", glyph: "审" },
  { key: "errorLogManage", title: "错误日志", desc: "查看云函数异常记录，便于线上排障", section: "系统管理", sectionKicker: "SYSTEM", glyph: "错" },
  { key: "systemHealth", title: "上线检查", desc: "只读检查云环境数据与关键配置", section: "系统管理", sectionKicker: "SYSTEM", glyph: "检" },
  { key: "privacyRequestManage", title: "隐私申请处理", desc: "处理用户个人信息查询、更正与删除申请", section: "系统管理", sectionKicker: "SYSTEM", glyph: "私" },
  { key: "storageCleanup", title: "存储清理", desc: "重试清理删除失败的车辆图片", section: "系统管理", sectionKicker: "SYSTEM", glyph: "清" },
  { key: "getOpenid", title: "查询 OpenID", desc: "获取当前微信用户的 OpenID 并复制", section: "账户工具", sectionKicker: "UTILITIES", glyph: "ID" },
  { key: "bootstrapAdmin", title: "初始化管理员", desc: "仅限首次配置时使用，自动把当前账号设为首个管理员", section: "账户工具", sectionKicker: "UTILITIES", glyph: "启" }
]

function buildVisibleMenuItems(options) {
  const input = options && typeof options === "object" ? options : {}
  const envVersion = input.envVersion || "release"
  const canManageVehicles = Boolean(input.canManageVehicles)
  const canManageBookings = Boolean(input.canManageBookings)
  const canManageRoles = Boolean(input.canManageRoles)
  const canManageConfig = Boolean(input.canManageConfig)
  const canViewAuditLogs = Boolean(input.canViewAuditLogs)
  const canViewErrorLogs = Boolean(input.canViewErrorLogs)

  const visibleItems = MENU_ITEMS.filter((item) => {
    if (item.key === "bootstrapAdmin" && (envVersion === "release" || canManageRoles)) {
      return false
    }

    if ((item.key === "vehicleManage" || item.key === "vehicleCreate") && !canManageVehicles) {
      return false
    }

    if (item.key === "operationsOverview" && !canManageVehicles && !canManageBookings && !canManageRoles) {
      return false
    }

    if (item.key === "analyticsManage" && !canManageVehicles && !canManageBookings && !canManageRoles) {
      return false
    }

    if (
      (item.key === "bookingManage" || item.key === "bookingWorkbench") &&
      !canManageBookings
    ) {
      return false
    }

    if (item.key === "bookingCalendar" && !canManageBookings) {
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

    if (item.key === "errorLogManage" && !canViewErrorLogs) {
      return false
    }

    if (
      (item.key === "storageCleanup" ||
        item.key === "privacyRequestManage" ||
        item.key === "systemHealth") &&
      !canManageRoles
    ) {
      return false
    }

    return true
  })

  return visibleItems.map((item, index) => ({
    ...item,
    showSectionHeader: index === 0 || visibleItems[index - 1].section !== item.section
  }))
}

function formatBadgeCount(value) {
  const count = Number(value)
  if (!Number.isFinite(count) || count <= 0) {
    return ""
  }
  return count > 99 ? "99+" : String(Math.floor(count))
}

function applyOperationSummary(menuItems, summary) {
  const list = Array.isArray(menuItems) ? menuItems : []
  const counts = summary && typeof summary === "object" ? summary : {}
  const badgeCounts = {
    bookingManage: Number(counts.bookingPending) || 0,
    bookingWorkbench: Number(counts.bookingPending) || 0,
    privacyRequestManage:
      (Number(counts.privacyPending) || 0) + (Number(counts.privacyProcessing) || 0),
    storageCleanup: Number(counts.storageCleanupPending) || 0
  }

  return list.map((item) => ({
    ...item,
    badgeText: formatBadgeCount(badgeCounts[item.key])
  }))
}

function buildMemberRole(result) {
  const source = result && typeof result === "object" ? result : {}
  if (source.isAdmin) {
    return {
      roleKicker: "GARAGE ADMIN",
      roleLabel: "车库管理员",
      roleClass: "profile-role-admin"
    }
  }

  const hasOperationsAccess = Boolean(source.canManageVehicles || source.canManageBookings)
  if (hasOperationsAccess) {
    return {
      roleKicker: "OPERATIONS MEMBER",
      roleLabel: "运营成员",
      roleClass: "profile-role-operations"
    }
  }

  return {
    roleKicker: "PRIVATE MEMBER",
    roleLabel: "私人会员",
    roleClass: "profile-role-member"
  }
}

Page({
  data: {
    brandName: "极境车库",
    servicePhone: "15715710090",
    userName: "车库来访者",
    userDesc: "查看预约、个人信息申请与车库服务",
    envVersion: "release",
    permissionsLoading: true,
    permissionsReady: false,
    summaryLoading: false,
    myPermissions: {},
    roleKicker: "VERIFYING",
    roleLabel: "正在确认身份",
    roleClass: "profile-role-loading",
    menuItems: buildVisibleMenuItems({
      envVersion: "release",
      canManageRoles: false,
      canManageConfig: false,
      canViewAuditLogs: false,
      canViewErrorLogs: false,
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
        canViewErrorLogs: false,
        canManageVehicles: false,
        canManageBookings: false
      })
    })

    this.loadMyPermissions()
    this.loadOperationConfig()
  },

  onShow() {
    if (this.data.permissionsReady && !this.data.summaryLoading) {
      this.loadOperationSummary()
    }
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
      this.setData({
        permissionsLoading: false,
        ...buildMemberRole(null)
      })
      return
    }

    wx.cloud.callFunction({
      name: "getMyPermissions",
      success: (res) => {
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          this.setData({
            permissionsLoading: false,
            permissionsReady: true,
            myPermissions: {},
            ...buildMemberRole(null)
          })
          return
        }

        this.setData({
          permissionsLoading: false,
          permissionsReady: true,
          myPermissions: {
            canManageBookings: Boolean(result.canManageBookings),
            canManageRoles: Boolean(result.canManageRoles)
          },
          ...buildMemberRole(result),
          menuItems: buildVisibleMenuItems({
            envVersion: this.data.envVersion,
            canManageRoles: Boolean(result.canManageRoles),
            canManageConfig: Boolean(result.canManageConfig),
            canViewAuditLogs: Boolean(result.canViewAuditLogs),
            canViewErrorLogs: Boolean(result.canViewErrorLogs),
            canManageVehicles: Boolean(result.canManageVehicles),
            canManageBookings: Boolean(result.canManageBookings)
          })
        }, () => {
          this.loadOperationSummary(result)
        })
      },
      fail: () => {
        this.setData({
          permissionsLoading: false,
          permissionsReady: true,
          myPermissions: {},
          ...buildMemberRole(null)
        })
      }
    })
  },

  loadOperationSummary(permissionResult) {
    const permissions =
      permissionResult && typeof permissionResult === "object"
        ? permissionResult
        : this.data.myPermissions || {}
    const canLoad = Boolean(permissions.canManageBookings || permissions.canManageRoles)
    if (
      !canLoad ||
      this.data.summaryLoading ||
      !wx.cloud ||
      typeof wx.cloud.callFunction !== "function"
    ) {
      return
    }

    this.setData({ summaryLoading: true })
    wx.cloud.callFunction({
      name: "operationSummaryGet",
      success: (res) => {
        const result = res && res.result ? res.result : null
        if (!result || !result.ok || !result.counts) {
          return
        }
        this.setData({
          menuItems: applyOperationSummary(this.data.menuItems, result.counts)
        })
      },
      fail: () => {},
      complete: () => {
        this.setData({ summaryLoading: false })
      }
    })
  },

  handleMenuTap(event) {
    const { key, title } = event.currentTarget.dataset

    if (key === "favorites") {
      wx.navigateTo({
        url: "/pages/favorites/favorites",
        fail: () => {
          wx.showToast({
            title: "页面跳转失败",
            icon: "none"
          })
        }
      })
      return
    }

    if (key === "operationsOverview") {
      wx.navigateTo({
        url: "/pages/operations-overview/operations-overview",
        fail: () => {
          wx.showToast({
            title: "页面跳转失败",
            icon: "none"
          })
        }
      })
      return
    }

    if (key === "analyticsManage") {
      wx.navigateTo({
        url: "/pages/analytics-manage/analytics-manage",
        fail: () => {
          wx.showToast({
            title: "页面跳转失败",
            icon: "none"
          })
        }
      })
      return
    }

    if (key === "bookingCalendar") {
      wx.navigateTo({
        url: "/pages/booking-calendar/booking-calendar",
        fail: () => {
          wx.showToast({
            title: "页面跳转失败",
            icon: "none"
          })
        }
      })
      return
    }

    if (key === "bookingWorkbench") {
      wx.navigateTo({
        url: "/pages/booking-workbench/booking-workbench",
        fail: () => {
          wx.showToast({
            title: "页面跳转失败",
            icon: "none"
          })
        }
      })
      return
    }

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

    if (key === "errorLogManage") {
      wx.navigateTo({
        url: "/pages/error-log-manage/error-log-manage",
        fail: () => {
          wx.showToast({
            title: "页面跳转失败",
            icon: "none"
          })
        }
      })
      return
    }

    if (key === "systemHealth") {
      wx.navigateTo({
        url: "/pages/system-health/system-health",
        fail: () => {
          wx.showToast({
            title: "页面跳转失败",
            icon: "none"
          })
        }
      })
      return
    }

    if (key === "storageCleanup") {
      if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
        wx.showToast({
          title: "云能力未初始化",
          icon: "none"
        })
        return
      }

      wx.showModal({
        title: "清理存储队列",
        content: "将重试删除此前清理失败的车辆图片，每次最多处理 5 条。确认继续？",
        success: (modalRes) => {
          if (!modalRes.confirm) {
            return
          }

          wx.showLoading({ title: "清理中" })
          wx.cloud.callFunction({
            name: "pendingFileDeletionProcess",
            data: { limit: 5 },
            success: (res) => {
              wx.hideLoading()
              const result = res && res.result ? res.result : null
              if (!result || !result.ok) {
                wx.showToast({
                  title: (result && result.message) || "清理失败",
                  icon: "none"
                })
                return
              }

              wx.showModal({
                title: "清理完成",
                content: `处理 ${result.processed || 0} 条，成功 ${result.deleted || 0} 条，失败 ${result.failed || 0} 条。${result.hasMore ? "队列可能仍有记录，可再次执行。" : ""}`,
                showCancel: false
              })
            },
            fail: (error) => {
              wx.hideLoading()
              wx.showToast({
                title: (error && (error.errMsg || error.message)) || "清理失败",
                icon: "none"
              })
            }
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
        title: "输入初始化口令",
        content: "仅当 roles 集合没有任何记录时可用，口令只随本次请求发送。",
        editable: true,
        placeholderText: "BOOTSTRAP_TOKEN",
        success: (modalRes) => {
          if (!modalRes.confirm) {
            return
          }

          const token = String(modalRes.content || "").trim()
          if (!token) {
            wx.showToast({
              title: "请输入初始化口令",
              icon: "none"
            })
            return
          }

          wx.showLoading({
            title: "初始化中"
          })

          wx.cloud.callFunction({
            name: "bootstrapAdmin",
            data: {
              token
            },
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
                  content: "初始化口令不正确，请检查后重试。",
                  showCancel: false
                })
                return
              }

              if (result && result.code === "BOOTSTRAP_DISABLED") {
                wx.showModal({
                  title: "初始化未启用",
                  content: "请先在云函数控制台配置 BOOTSTRAP_TOKEN，再使用体验版或开发版初始化。",
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

    if (key === "privacy") {
      wx.navigateTo({
        url: "/pages/content-page/content-page?type=privacy",
        fail: () => {
          wx.showToast({
            title: "页面跳转失败",
            icon: "none"
          })
        }
      })
      return
    }

    if (key === "privacyRequest") {
      wx.navigateTo({
        url: "/pages/privacy-request/privacy-request",
        fail: () => {
          wx.showToast({
            title: "页面跳转失败",
            icon: "none"
          })
        }
      })
      return
    }

    if (key === "privacyRequestManage") {
      wx.navigateTo({
        url: "/pages/privacy-request-manage/privacy-request-manage",
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
