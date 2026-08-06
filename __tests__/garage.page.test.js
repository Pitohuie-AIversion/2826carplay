const fs = require("fs")
const path = require("path")

jest.mock("../shared/analytics", () => ({
  trackEvent: jest.fn()
}))

function loadPageDefinition() {
  jest.resetModules()
  let definition = null
  global.Page = jest.fn((input) => {
    definition = input
  })
  require("../pages/garage/garage")
  return definition
}

function createPage(definition) {
  const page = {
    ...definition,
    data: {
      ...definition.data
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

describe("pages/garage 首页车辆筛选", () => {
  afterEach(() => {
    jest.useRealTimers()
    delete global.Page
    delete global.wx
  })

  test("首页将遗留的后台说明升级为一行品牌文案", () => {
    const page = createPage(loadPageDefinition())
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ success }) => {
          success({
            result: {
              ok: true,
              config: {
                garagePageSubtitle: "后台车辆资料已接入首页展示，上传封面后会同步展示到车库首页"
              }
            }
          })
        })
      }
    }

    page.loadOperationConfig()

    expect(page.data.pageSubtitle).toBe("甄选座驾，为每一次出发预留专属席位")
  })

  test("availability filter and vehicle list use independent conditional chains", () => {
    const wxml = fs.readFileSync(
      path.resolve(__dirname, "../pages/garage/garage.wxml"),
      "utf8"
    )

    expect(wxml).toContain('class="empty-state" wx:if="{{loadError}}"')
    expect(wxml).toContain('class="car-list" wx:elif="{{filteredCars.length}}"')
    expect(wxml).not.toContain('class="empty-state" wx:elif="{{loadError}}"')
    expect(wxml).toContain('aria-pressed="{{currentCategory === item.id}}"')
    expect(wxml).toContain('scroll-into-view="garage-category-{{currentCategory}}"')
    expect(wxml).toContain('id="garage-category-{{item.id}}"')
    expect(wxml).toContain('class="horizontal-scroll-cue"')
    expect(wxml).toContain('aria-pressed="{{!availableOnly}}"')
    expect(wxml).toContain('aria-pressed="{{availableOnly}}"')
    expect(wxml).toContain('hover-class="availability-option-pressed"')
    expect(wxml).toContain("availability-filter-compact")
    expect(wxml).toContain("availability-filter-native-icon")
    expect(wxml).not.toContain("浏览车辆状态")
    expect(wxml).toContain('aria-label="查看全部 {{categorySummary.total}} 辆车辆"')
    expect(wxml).toContain('aria-label="只看可预约的 {{categorySummary.available}} 辆车辆"')
  })

  test("搜索与顾问入口使用原生图标而非字符占位", () => {
    const wxml = fs.readFileSync(
      path.resolve(__dirname, "../pages/garage/garage.wxml"),
      "utf8"
    )

    expect(wxml).toContain('class="search-symbol"')
    expect(wxml).toContain('class="service-phone-icon"')
    expect(wxml).toContain('aria-label="拨打专属顾问电话"')
    expect(wxml).not.toContain("⌕")
    expect(wxml).not.toContain("⌁")
  })

  test("加载与空结果状态使用原生反馈和操作图标", () => {
    const pageDir = path.resolve(__dirname, "../pages/garage")
    const wxml = fs.readFileSync(path.join(pageDir, "garage.wxml"), "utf8")
    const wxss = fs.readFileSync(path.join(pageDir, "garage.wxss"), "utf8")

    expect(wxml).toContain("garage-error-native-icon")
    expect(wxml).toContain("garage-search-empty-native-icon")
    expect(wxml).toContain("garage-filter-empty-native-icon")
    expect(wxml).toContain("garage-empty-native-icon")
    expect(wxml).toContain("garage-retry-native-icon")
    expect(wxml).toContain("garage-more-native-icon")
    expect(wxml).toContain("garage-clear-native-icon")
    expect(wxml).toContain("garage-status-native-icon")
    expect(wxml).toContain("garage-complete-native-icon")
    expect(wxml).toContain("disabled=\"{{loadingCars || searchDebouncing}}\"")
    expect(wxml).toContain("{{searchDebouncing ? '正在搜索…' : loadingCars ? '正在加载' : '加载更多车辆'}}")
    expect(wxml).toContain("搜索会覆盖全部在库车辆")
    expect(wxml).not.toContain('bindtap="handleRetryLoad">重新加载</button>')
    expect(wxss).toContain(".garage-action-content")
    expect(wxss).toContain(".garage-state-icon")
    expect(wxss).toContain(".availability-option-pressed")
    expect(wxss).toContain(".availability-filter-native-icon")
    expect(wxss).toContain(".horizontal-scroll-cue-arrow")
  })

  test("客户侧使用友好状态文案并可只看可预约车辆", () => {
    const page = createPage(loadPageDefinition())
    page.applyCars(
      [
        {
          id: "vehicle-idle",
          category: "luxury_sedan",
          status: "idle",
          sort: 1
        },
        {
          id: "vehicle-active",
          category: "luxury_sedan",
          status: "active",
          sort: 2
        },
        {
          id: "vehicle-maintenance",
          category: "city_suv",
          status: "maintenance",
          sort: 3
        }
      ],
      {
        page: 0,
        total: 3,
        truncated: false,
        hasMore: false
      }
    )

    expect(page.data.cars.map((item) => item.statusText)).toEqual([
      "可预约",
      "使用中",
      "维护中"
    ])
    expect(page.data.categorySummary).toMatchObject({
      total: 3,
      available: 1
    })

    page.handleAvailabilityFilterTap({
      currentTarget: {
        dataset: {
          mode: "available"
        }
      }
    })

    expect(page.data.availableOnly).toBe(true)
    expect(page.data.filteredCars.map((item) => item.id)).toEqual(["vehicle-idle"])
    expect(page.data.categorySummary).toMatchObject({
      total: 3,
      available: 1
    })

    page.handleShowAllStatuses()

    expect(page.data.availableOnly).toBe(false)
    expect(page.data.filteredCars).toHaveLength(3)
  })

  test("车型搜索可与分类和可预约状态组合筛选", () => {
    const page = createPage(loadPageDefinition())
    page.applyCars(
      [
        {
          id: "porsche-911",
          name: "Porsche 911 Carrera",
          nickname: "赛道之星",
          brand: "Porsche",
          category: "supercar",
          status: "idle",
          tags: ["跑车", "自动挡"]
        },
        {
          id: "porsche-cayenne",
          name: "Porsche Cayenne",
          brand: "Porsche",
          category: "city_suv",
          status: "active",
          tags: ["SUV"]
        },
        {
          id: "bmw-x7",
          name: "BMW X7",
          brand: "BMW",
          category: "city_suv",
          status: "idle",
          tags: ["SUV"]
        }
      ],
      {
        page: 0,
        total: 3,
        truncated: false,
        hasMore: false
      }
    )

    page.handleSearchInput({
      detail: {
        value: "porsche"
      }
    })
    expect(page.data.filteredCars.map((item) => item.id)).toEqual([
      "porsche-911",
      "porsche-cayenne"
    ])
    expect(page.data.searchResultCount).toBe(2)

    page.handleAvailabilityFilterTap({
      currentTarget: {
        dataset: {
          mode: "available"
        }
      }
    })
    expect(page.data.filteredCars.map((item) => item.id)).toEqual(["porsche-911"])

    page.handleClearSearch()
    expect(page.data.searchKeyword).toBe("")
    expect(page.data.filteredCars.map((item) => item.id)).toEqual(["porsche-911", "bmw-x7"])
  })

  test("输入关键词后防抖请求服务端全量搜索并携带组合筛选", () => {
    jest.useFakeTimers()
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ success }) => success({
          result: {
            ok: true,
            page: 0,
            total: 1,
            searchedTotal: 1,
            categoryTotal: 1,
            availableCount: 1,
            categoryCounts: { all: 1, supercar: 1 },
            hasMore: false,
            list: [{ id: "remote-911", name: "Porsche 911", category: "supercar", status: "available" }]
          }
        }))
      },
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition())
    page.data.currentCategory = "supercar"
    page.data.availableOnly = true

    page.handleSearchInput({ detail: { value: "Porsche" } })
    expect(wx.cloud.callFunction).not.toHaveBeenCalled()

    jest.advanceTimersByTime(350)

    expect(wx.cloud.callFunction).toHaveBeenCalledWith(expect.objectContaining({
      name: "garageVehicleList",
      data: expect.objectContaining({
        keyword: "Porsche",
        category: "supercar",
        availableOnly: true
      })
    }))
    expect(page.data.filteredCars.map((item) => item.id)).toEqual(["remote-911"])
    expect(page.data.searchResultCount).toBe(1)
  })

  test("搜索防抖期间禁止加载旧分页并从第一页请求", () => {
    jest.useFakeTimers()
    global.wx = {
      cloud: {
        callFunction: jest.fn()
      },
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition())
    page.data.page = 3
    page.data.hasMore = true

    page.handleSearchInput({ detail: { value: "Ferrari" } })
    page.handleLoadMore()

    expect(wx.cloud.callFunction).not.toHaveBeenCalled()
    jest.advanceTimersByTime(350)
    expect(wx.cloud.callFunction).toHaveBeenCalledTimes(1)
    expect(wx.cloud.callFunction).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        page: 0,
        keyword: "Ferrari"
      })
    }))
  })

  test("搜索防抖期间切换分类会接管请求且不重复搜索", () => {
    jest.useFakeTimers()
    global.wx = {
      cloud: {
        callFunction: jest.fn()
      },
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition())

    page.handleSearchInput({ detail: { value: "Porsche" } })
    page.handleCategoryTap({ currentTarget: { dataset: { categoryId: "supercar" } } })

    expect(wx.cloud.callFunction).toHaveBeenCalledTimes(1)
    expect(wx.cloud.callFunction).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        page: 0,
        keyword: "Porsche",
        category: "supercar"
      })
    }))
    jest.advanceTimersByTime(350)
    expect(wx.cloud.callFunction).toHaveBeenCalledTimes(1)
  })

  test("首页云函数无响应时结束骨架屏并提供重试入口", () => {
    jest.useFakeTimers()
    const page = createPage(loadPageDefinition())
    global.wx = {
      cloud: {
        callFunction: jest.fn()
      },
      showToast: jest.fn()
    }

    page.loadCars()
    expect(page.data.loadingCars).toBe(true)

    jest.advanceTimersByTime(15 * 1000)

    expect(page.data.loadingCars).toBe(false)
    expect(page.data.initialLoading).toBe(false)
    expect(page.data.loadError).toBe(true)
    expect(page.data.loadErrorText).toBe("加载超时，请检查网络后重试")
  })

  test("首页超时后忽略迟到的成功回调", () => {
    jest.useFakeTimers()
    let lateSuccess
    const page = createPage(loadPageDefinition())
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ success }) => {
          lateSuccess = success
        })
      },
      showToast: jest.fn()
    }

    page.loadCars()
    jest.advanceTimersByTime(15 * 1000)
    lateSuccess({
      result: {
        ok: true,
        page: 0,
        total: 1,
        hasMore: false,
        list: [{ id: "late-car", status: "idle" }]
      }
    })

    expect(page.data.loadError).toBe(true)
    expect(page.data.cars).toEqual([])
  })

  test("加载更多超时时保留已有车辆并结束按钮加载态", () => {
    jest.useFakeTimers()
    const page = createPage(loadPageDefinition())
    page.data.cars = [{ id: "existing-car", status: "idle" }]
    page.data.page = 0
    page.data.hasMore = true
    global.wx = {
      cloud: {
        callFunction: jest.fn()
      },
      showToast: jest.fn()
    }

    page.loadCars({ append: true })
    jest.advanceTimersByTime(15 * 1000)

    expect(page.data.loadingCars).toBe(false)
    expect(page.data.cars).toEqual([{ id: "existing-car", status: "idle" }])
    expect(wx.showToast).toHaveBeenCalledWith({
      title: "加载超时，请重试",
      icon: "none"
    })
  })

  test("云函数同步抛错时转为可重试错误状态", () => {
    const page = createPage(loadPageDefinition())
    global.wx = {
      cloud: {
        callFunction: jest.fn(() => {
          throw new Error("cloud init failed")
        })
      },
      showToast: jest.fn()
    }

    expect(() => page.loadCars()).not.toThrow()
    expect(page.data.loadingCars).toBe(false)
    expect(page.data.loadError).toBe(true)
    expect(page.data.loadErrorText).toBe("cloud init failed")
  })
})
