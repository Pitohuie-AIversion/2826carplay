const fs = require("fs")
const path = require("path")

function loadPageDefinition() {
  jest.resetModules()
  let definition = null
  global.Page = jest.fn((input) => {
    definition = input
  })
  require("../pages/mine/mine")
  return definition
}

function createPage(definition) {
  const page = {
    ...definition,
    data: {
      ...definition.data,
      menuItems: definition.data.menuItems.map((item) => ({ ...item }))
    }
  }
  page.setData = jest.fn((patch, done) => {
    Object.assign(page.data, patch)
    if (typeof done === "function") {
      done()
    }
  })
  return page
}

describe("pages/mine 运营待办角标", () => {
  afterEach(() => {
    delete global.Page
    delete global.wx
  })

  test("预约管理使用待联系数，工作台使用待协调数", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ name, success, complete }) => {
          if (name === "getMyPermissions") {
            success({
              result: {
                ok: true,
                canManageBookings: true,
                canManageRoles: false
              }
            })
            return
          }
          success({
            result: {
              ok: true,
              counts: {
                bookingPending: 3,
                bookingCoordinationPending: 7
              }
            }
          })
          if (typeof complete === "function") {
            complete()
          }
        })
      }
    }
    const page = createPage(loadPageDefinition())

    page.loadMyPermissions()

    expect(
      page.data.menuItems.find((item) => item.key === "bookingManage").badgeText
    ).toBe("3")
    expect(
      page.data.menuItems.find((item) => item.key === "bookingWorkbench").badgeText
    ).toBe("7")
    expect(page.data.operationPulse.visible).toBe(true)
    expect(page.data.operationPulse.total).toBe(7)
    expect(page.data.operationPulse.attentionAreas).toBe(1)
    expect(page.data.operationPulse.items).toEqual([
      expect.objectContaining({
        key: "booking",
        iconClass: "operation-pulse-icon-booking",
        displayValue: "7",
        unavailable: false
      })
    ])
    expect(page.data.operationPulse.updatedText).toMatch(/^\d{2}:\d{2}$/)
    expect(page.data.summaryLoading).toBe(false)
  })

  test("运营待办总览保留可用数据并标记部分同步", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ success, complete }) => {
          success({
            result: {
              ok: true,
              counts: {
                bookingPending: 1,
                bookingCoordinationPending: 2,
                privacyPending: 1,
                privacyProcessing: 1,
                storageCleanupPending: 3
              },
              unavailable: ["storageCleanupPending"],
              partial: true
            }
          })
          if (typeof complete === "function") {
            complete()
          }
        })
      }
    }
    const page = createPage(loadPageDefinition())
    page.data.myPermissions = {
      canManageBookings: true,
      canManageRoles: true
    }

    page.loadOperationSummary()

    expect(page.data.operationPulse.total).toBe(4)
    expect(page.data.operationPulse.attentionAreas).toBe(2)
    expect(page.data.operationPulse.partial).toBe(true)
    expect(page.data.operationPulse.items.find((item) => item.key === "storage")).toMatchObject({
      iconClass: "operation-pulse-icon-storage",
      displayValue: "—",
      unavailable: true
    })
    expect(page.data.summaryLoading).toBe(false)
  })

  test("运营脉搏使用待办业务图标和原生同步状态", () => {
    const pageDir = path.resolve(__dirname, "../pages/mine")
    const wxml = fs.readFileSync(path.join(pageDir, "mine.wxml"), "utf8")
    const wxss = fs.readFileSync(path.join(pageDir, "mine.wxss"), "utf8")

    expect(wxml).toContain('class="operation-pulse-native-icon {{item.iconClass}}"')
    expect(wxml).toContain("operation-pulse-state-icon-loading")
    expect(wxml).toContain("operation-pulse-state-icon-warning")
    expect(wxml).toContain("operation-pulse-state-icon-ready")
    expect(wxml).toContain("operation-pulse-priority")
    expect(wxml).toContain('aria-label="查看运营概览，{{operationPulse.total}} 项待处理"')
    expect(wxml.indexOf('class="operation-pulse operation-pulse-priority')).toBeLessThan(
      wxml.indexOf('class="member-services ui-card"')
    )
    expect(wxss).toContain(".operation-pulse-icon-booking")
    expect(wxss).toContain(".operation-pulse-icon-privacy")
    expect(wxss).toContain(".operation-pulse-icon-storage")
    expect(wxss).toContain(".operation-pulse-priority::before")
  })

  test("存储清理结果区分等待核验和保留中的图片", () => {
    const resultModal = jest.fn()
    global.wx = {
      showLoading: jest.fn(),
      hideLoading: jest.fn(),
      showToast: jest.fn(),
      showModal: jest.fn((options) => {
        if (options.title === "清理存储队列") {
          options.success({ confirm: true })
          return
        }
        resultModal(options)
      }),
      cloud: {
        callFunction: jest.fn(({ success }) => {
          success({
            result: {
              ok: true,
              processed: 3,
              deleted: 1,
              failed: 0,
              deferred: 1,
              preserved: 2,
              invalid: 0,
              hasMore: true
            }
          })
        })
      }
    }
    const page = createPage(loadPageDefinition())

    page.handleMenuTap({
      currentTarget: { dataset: { key: "storageCleanup", title: "存储清理" } }
    })

    expect(wx.cloud.callFunction).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "pendingFileDeletionProcess",
        data: { limit: 5 }
      })
    )
    expect(resultModal).toHaveBeenCalledWith({
      title: "清理结果",
      content: "本次检查 3 条，已清理 1 条，失败 0 条，等待安全核验 1 条，保留在用图片 2 张。队列仍有记录，可稍后再次执行。",
      confirmText: "知道了",
      confirmColor: "#528fff",
      showCancel: false
    })
  })
})
