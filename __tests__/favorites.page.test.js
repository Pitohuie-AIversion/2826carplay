const fs = require("fs")
const path = require("path")

function loadPageDefinition() {
  jest.resetModules()
  let definition = null
  global.Page = jest.fn((input) => {
    definition = input
  })
  require("../pages/favorites/favorites")
  return definition
}

function createPage(definition) {
  const page = {
    ...definition,
    data: {
      ...definition.data,
      favoriteSummary: {
        ...definition.data.favoriteSummary
      }
    }
  }
  page.setData = jest.fn((patch, done) => {
    page.data = {
      ...page.data,
      ...patch
    }
    if (typeof done === "function") {
      done()
    }
  })
  return page
}

describe("pages/favorites 收藏车辆视图", () => {
  afterEach(() => {
    jest.useRealTimers()
    delete global.Page
    delete global.wx
  })

  test("统一客户状态口径并支持只看可预约收藏", () => {
    const page = createPage(loadPageDefinition())

    page.applyFavoriteList(
      [
        {
          id: "vehicle-idle",
          status: "idle",
          statusText: "在库"
        },
        {
          id: "vehicle-active",
          status: "active",
          statusText: "在用"
        },
        {
          id: "vehicle-maintenance",
          status: "maintenance"
        }
      ],
      {
        page: 0,
        hasMore: false
      }
    )

    expect(page.data.list.map((item) => item.statusText)).toEqual([
      "可预约",
      "使用中",
      "维护中"
    ])
    expect(page.data.favoriteSummary).toEqual({
      total: 3,
      available: 1
    })

    page.handleFilterTap({
      currentTarget: {
        dataset: {
          mode: "available"
        }
      }
    })

    expect(page.data.availableOnly).toBe(true)
    expect(page.data.visibleList.map((item) => item.id)).toEqual(["vehicle-idle"])

    page.handleShowAll()

    expect(page.data.availableOnly).toBe(false)
    expect(page.data.visibleList).toHaveLength(3)
  })

  test("首次加载展示与车辆卡片一致的收藏骨架", () => {
    const pageDir = path.resolve(__dirname, "../pages/favorites")
    const wxmlSource = fs.readFileSync(path.join(pageDir, "favorites.wxml"), "utf8")
    const wxssSource = fs.readFileSync(path.join(pageDir, "favorites.wxss"), "utf8")

    expect(wxmlSource).toContain("favorite-skeleton-card")
    expect(wxmlSource).toContain("favorite-skeleton-status")
    expect(wxmlSource).toContain("favorite-skeleton-price-value")
    expect(wxmlSource).toContain('aria-hidden="true"')
    expect(wxssSource).toContain("@keyframes favorite-skeleton-pulse")
    expect(wxssSource).toContain("@keyframes favorite-skeleton-sweep")
    expect(wxssSource).not.toContain(".loading-card")
  })

  test("收藏页高频操作使用对应原生图标", () => {
    const pageDir = path.resolve(__dirname, "../pages/favorites")
    const wxmlSource = fs.readFileSync(path.join(pageDir, "favorites.wxml"), "utf8")
    const wxssSource = fs.readFileSync(path.join(pageDir, "favorites.wxss"), "utf8")

    expect(wxmlSource).toContain("favorite-retry-native-icon")
    expect(wxmlSource).toContain("remove-favorite-native-icon")
    expect(wxmlSource).toContain("favorite-list-native-icon")
    expect(wxmlSource).toContain("favorite-more-native-icon")
    expect(wxmlSource).toContain("favorite-garage-native-icon")
    expect(wxmlSource).toContain("favorite-complete-native-icon")
    expect(wxmlSource).toContain('aria-pressed="{{!availableOnly}}"')
    expect(wxmlSource).toContain('aria-pressed="{{availableOnly}}"')
    expect(wxmlSource).toContain('aria-label="全部收藏，{{favoriteSummary.total}} 辆"')
    expect(wxmlSource).toContain('aria-label="只看可预约，{{favoriteSummary.available}} 辆"')
    expect(wxmlSource).toContain('aria-role="group"')
    expect(wxmlSource).toContain("filter-count-active")
    expect(wxmlSource).toContain('hover-class="filter-button-pressed"')
    expect(wxmlSource).toContain("{{removingId === item.id ? '正在取消' : '取消收藏'}}")
    expect(wxmlSource).toContain("{{loading ? '正在加载' : '加载更多收藏'}}")
    expect(wxmlSource).toContain("'正在取消收藏车辆 ' + item.name")
    expect(wxmlSource).not.toContain('bindtap="handleRetry">重新加载</button>')
    expect(wxssSource).toContain(".favorite-action-content")
    expect(wxssSource).toContain(".remove-favorite-heart")
    expect(wxssSource).toContain(".filter-button-pressed")
    expect(wxssSource).toContain(".filter-button-content")
    expect(wxssSource).toContain(".filter-count-active")
    expect(wxmlSource).toContain("remove-button-pressed")
    expect(wxssSource).toContain(".remove-button-pressed")
  })

  test("取消收藏先确认并同步更新概览", () => {
    global.wx = {
      showModal: jest.fn(({ success }) => success({ confirm: true })),
      showToast: jest.fn(),
      cloud: {
        callFunction: jest.fn(({ success, complete }) => {
          success({
            result: {
              ok: true
            }
          })
          complete()
        })
      }
    }
    const page = createPage(loadPageDefinition())
    page.applyFavoriteList([
      {
        id: "vehicle-idle",
        status: "available"
      },
      {
        id: "vehicle-active",
        status: "rented"
      }
    ])

    page.handleRemove({
      currentTarget: {
        dataset: {
          id: "vehicle-idle"
        }
      }
    })

    expect(wx.showModal).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "取消收藏",
        confirmText: "确认取消"
      })
    )
    expect(wx.cloud.callFunction).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "favoriteSet",
        data: {
          vehicleId: "vehicle-idle",
          favorited: false
        }
      })
    )
    expect(page.data.list.map((item) => item.id)).toEqual(["vehicle-active"])
    expect(page.data.favoriteSummary).toEqual({
      total: 1,
      available: 0
    })
    expect(page.data.removingId).toBe("")
    page.onUnload()
  })

  test("取消收藏后五秒内可以撤销并恢复原位置", () => {
    jest.useFakeTimers()
    global.wx = {
      showModal: jest.fn(({ success }) => success({ confirm: true })),
      showToast: jest.fn(),
      cloud: {
        callFunction: jest.fn(({ success, complete }) => {
          success({ result: { ok: true } })
          complete()
        })
      }
    }
    const page = createPage(loadPageDefinition())
    page.applyFavoriteList([
      { id: "first", name: "第一辆", status: "available" },
      { id: "second", name: "第二辆", status: "available" }
    ])

    page.handleRemove({ currentTarget: { dataset: { id: "first" } } })
    expect(page.data.undoFavorite.car.id).toBe("first")
    expect(page.data.list.map((item) => item.id)).toEqual(["second"])

    page.handleUndoRemove()

    expect(wx.cloud.callFunction).toHaveBeenLastCalledWith(expect.objectContaining({
      data: { vehicleId: "first", favorited: true }
    }))
    expect(page.data.list.map((item) => item.id)).toEqual(["first", "second"])
    expect(page.data.undoFavorite).toBeNull()
  })
})
