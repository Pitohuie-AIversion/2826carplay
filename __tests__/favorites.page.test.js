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

  test("收藏筛选偏好支持本地持久化与启动恢复", () => {
    const storage = {}
    global.wx = {
      getStorageSync: jest.fn((key) => storage[key] || false),
      setStorageSync: jest.fn((key, value) => {
        storage[key] = value
      })
    }

    const page = createPage(loadPageDefinition())
    page.applyFavoriteList([
      { id: "v1", status: "idle", statusText: "可预约" },
      { id: "v2", status: "rented", statusText: "使用中" }
    ])

    // 1. 切换为只看可预约时写入存储
    page.handleFilterTap({
      currentTarget: {
        dataset: {
          mode: "available"
        }
      }
    })
    expect(global.wx.setStorageSync).toHaveBeenCalledWith("favorite_available_only_preference", true)
    expect(storage.favorite_available_only_preference).toBe(true)
    expect(page.data.availableOnly).toBe(true)

    // 2. 模拟重新加载页面，恢复偏好为只看可预约
    const freshPage = createPage(loadPageDefinition())
    freshPage.restoreFilterPreference()
    expect(freshPage.data.availableOnly).toBe(true)

    // 3. 点击查看全部，重置存储为 false
    freshPage.handleShowAll()
    expect(global.wx.setStorageSync).toHaveBeenCalledWith("favorite_available_only_preference", false)
    expect(storage.favorite_available_only_preference).toBe(false)
    expect(freshPage.data.availableOnly).toBe(false)
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

  test("收藏列表无响应时退出骨架屏并结束下拉刷新", () => {
    jest.useFakeTimers()
    let lateSuccess
    const done = jest.fn()
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ success }) => {
          lateSuccess = success
        })
      }
    }
    const page = createPage(loadPageDefinition())

    page.fetchList({ done })
    expect(page.data.loading).toBe(true)

    jest.advanceTimersByTime(15 * 1000)
    expect(page.data.initialLoading).toBe(false)
    expect(page.data.loading).toBe(false)
    expect(page.data.loadError).toBe("收藏列表加载超时，请检查网络后重试")
    expect(done).toHaveBeenCalledTimes(1)

    lateSuccess({ result: { ok: true, list: [{ id: "late-car" }], hasMore: false } })
    expect(page.data.list).toEqual([])
  })

  test("收藏列表刷新后忽略旧分页请求的迟到结果", () => {
    const requests = []
    global.wx = {
      cloud: {
        callFunction: jest.fn((options) => {
          requests.push(options)
        })
      }
    }
    const page = createPage(loadPageDefinition())
    page.data.list = [{ id: "existing-car", status: "available" }]
    page.data.visibleList = page.data.list.slice()
    page.data.page = 0
    page.data.hasMore = true

    page.fetchList({ append: true })
    page.fetchList()
    requests[1].success({
      result: { ok: true, page: 0, hasMore: false, list: [{ id: "fresh-car", status: "idle" }] }
    })
    requests[0].success({
      result: { ok: true, page: 1, hasMore: false, list: [{ id: "stale-car", status: "idle" }] }
    })

    expect(page.data.list.map((item) => item.id)).toEqual(["fresh-car"])
    expect(page.data.loading).toBe(false)
  })

  test("收藏列表调用同步异常时安全进入重试状态", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(() => {
          throw new Error("cloud sdk crashed")
        })
      }
    }
    const page = createPage(loadPageDefinition())

    expect(() => page.fetchList()).not.toThrow()
    expect(page.data.initialLoading).toBe(false)
    expect(page.data.loading).toBe(false)
    expect(page.data.loadError).toBe("cloud sdk crashed")
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

  test("取消收藏无响应时恢复按钮并忽略迟到成功", () => {
    jest.useFakeTimers()
    let lateSuccess
    global.wx = {
      showToast: jest.fn(),
      cloud: {
        callFunction: jest.fn(({ success }) => {
          lateSuccess = success
        })
      }
    }
    const page = createPage(loadPageDefinition())
    page.applyFavoriteList([{ id: "favorite-timeout", name: "超时车辆", status: "available" }])

    page.removeFavorite("favorite-timeout")
    expect(page.data.removingId).toBe("favorite-timeout")

    jest.advanceTimersByTime(12 * 1000)
    expect(page.data.removingId).toBe("")
    expect(page.data.list.map((item) => item.id)).toEqual(["favorite-timeout"])
    expect(wx.showToast).toHaveBeenCalledWith({ title: "取消收藏超时，请重试", icon: "none" })

    lateSuccess({ result: { ok: true } })
    expect(page.data.list.map((item) => item.id)).toEqual(["favorite-timeout"])
    expect(page.data.undoFavorite).toBeNull()
  })

  test("撤销收藏无响应时保留撤销入口并忽略迟到成功", () => {
    jest.useFakeTimers()
    let lateSuccess
    global.wx = {
      showToast: jest.fn(),
      cloud: {
        callFunction: jest.fn(({ success }) => {
          lateSuccess = success
        })
      }
    }
    const page = createPage(loadPageDefinition())
    page.data.undoFavorite = {
      car: { id: "undo-timeout", name: "待恢复车辆", status: "available" },
      index: 0
    }

    page.handleUndoRemove()
    expect(page.data.undoingFavorite).toBe(true)

    jest.advanceTimersByTime(12 * 1000)
    expect(page.data.undoingFavorite).toBe(false)
    expect(page.data.undoFavorite.car.id).toBe("undo-timeout")
    expect(wx.showToast).toHaveBeenCalledWith({ title: "撤销超时，请重试", icon: "none" })

    lateSuccess({ result: { ok: true } })
    expect(page.data.list).toEqual([])
    expect(page.data.undoFavorite.car.id).toBe("undo-timeout")
  })

  test("收藏变更期间拒绝下拉刷新避免旧列表覆盖", () => {
    global.wx = {
      stopPullDownRefresh: jest.fn(),
      cloud: {
        callFunction: jest.fn()
      }
    }
    const page = createPage(loadPageDefinition())
    page.data.removingId = "vehicle-mutating"

    page.onPullDownRefresh()

    expect(wx.stopPullDownRefresh).toHaveBeenCalledTimes(1)
    expect(wx.cloud.callFunction).not.toHaveBeenCalled()
  })

  test("取消收藏同步异常时安全恢复可重试状态", () => {
    global.wx = {
      showToast: jest.fn(),
      cloud: {
        callFunction: jest.fn(() => {
          throw new Error("cloud sdk crashed")
        })
      }
    }
    const page = createPage(loadPageDefinition())
    page.applyFavoriteList([{ id: "favorite-error", status: "available" }])

    expect(() => page.removeFavorite("favorite-error")).not.toThrow()
    expect(page.data.removingId).toBe("")
    expect(page.data.list.map((item) => item.id)).toEqual(["favorite-error"])
    expect(wx.showToast).toHaveBeenCalledWith({ title: "取消收藏失败", icon: "none" })
  })

  test("onReachBottom 自动触发 handleLoadMore 分页加载", () => {
    const page = createPage(loadPageDefinition())
    page.handleLoadMore = jest.fn()
    page.onReachBottom()
    expect(page.handleLoadMore).toHaveBeenCalledTimes(1)

    const json = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../pages/favorites/favorites.json"), "utf8"))
    expect(json.onReachBottomDistance).toBe(200)
  })

  test("冷启动时优先从 storage 恢复 favorites_last_snapshot 实现 0ms 秒开", () => {
    const mockFavorites = [{ id: "fav-porsche", name: "Porsche 911", status: "available" }]
    global.wx = {
      getStorageSync: jest.fn((key) => {
        if (key === "favorites_last_snapshot") return mockFavorites
        return null
      }),
      cloud: { callFunction: jest.fn() }
    }
    const page = createPage(loadPageDefinition())
    page.applyFavoriteList = jest.fn()
    page.onLoad()
    expect(page.applyFavoriteList).toHaveBeenCalledWith(mockFavorites, expect.objectContaining({ page: 0, hasMore: true }))
    expect(page.data.initialLoading).toBe(false)
  })
})
