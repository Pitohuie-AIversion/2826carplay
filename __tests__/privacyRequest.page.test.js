const fs = require("fs")
const path = require("path")

function loadPageDefinition() {
  jest.resetModules()
  let definition = null
  global.Page = jest.fn((input) => {
    definition = input
  })
  require("../pages/privacy-request/privacy-request")
  return definition
}

function createPage(definition) {
  const page = {
    ...definition,
    data: {
      ...definition.data,
      typeOptions: definition.data.typeOptions.map((item) => ({ ...item })),
      requestSummary: {
        ...definition.data.requestSummary
      }
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

describe("pages/privacy-request 用户申请流程", () => {
  afterEach(() => {
    delete global.Page
    delete global.wx
  })

  test("申请说明实时反馈是否可以提交", () => {
    const page = createPage(loadPageDefinition())

    page.handleDescriptionInput({
      detail: {
        value: "查"
      }
    })
    expect(page.data.formReady).toBe(false)
    expect(page.data.descriptionHint).toBe("还需补充 1 个字")

    page.handleDescriptionInput({
      detail: {
        value: "查询当前保存的信息"
      }
    })
    expect(page.data.formReady).toBe(true)
    expect(page.data.descriptionLength).toBe(9)
    expect(page.data.descriptionHint).toBe("说明已填写，可以提交申请")
  })

  test("首次加载使用记录卡片骨架而不是文字占位", () => {
    const pageDir = path.resolve(__dirname, "../pages/privacy-request")
    const wxmlSource = fs.readFileSync(path.join(pageDir, "privacy-request.wxml"), "utf8")
    const wxssSource = fs.readFileSync(path.join(pageDir, "privacy-request.wxss"), "utf8")

    expect(wxmlSource).toContain('class="request-skeleton"')
    expect(wxmlSource).toContain("request-skeleton-card")
    expect(wxmlSource).toContain('aria-hidden="true"')
    expect(wxmlSource).not.toContain("正在加载申请记录…")
    expect(wxssSource).toContain("@keyframes privacy-skeleton-shimmer")
  })

  test("申请类型与三类空状态使用对应原生图标和辅助语义", () => {
    const pageDir = path.resolve(__dirname, "../pages/privacy-request")
    const wxmlSource = fs.readFileSync(path.join(pageDir, "privacy-request.wxml"), "utf8")
    const wxssSource = fs.readFileSync(path.join(pageDir, "privacy-request.wxss"), "utf8")

    expect(wxmlSource).toContain("type-glyph-{{item.value}}")
    expect(wxmlSource).toContain('aria-role="radio"')
    expect(wxmlSource).toContain("empty-alert-icon")
    expect(wxmlSource).toContain("empty-filter-icon")
    expect(wxmlSource).toContain("empty-record-icon")
    expect(wxmlSource).toContain("hero-lock-icon")
    expect(wxssSource).toContain(".type-glyph-correction .type-glyph-icon")
    expect(wxssSource).toContain(".empty-visual-error")
  })

  test("申请提交与记录操作使用对应原生图标", () => {
    const pageDir = path.resolve(__dirname, "../pages/privacy-request")
    const wxmlSource = fs.readFileSync(path.join(pageDir, "privacy-request.wxml"), "utf8")
    const wxssSource = fs.readFileSync(path.join(pageDir, "privacy-request.wxss"), "utf8")

    expect(wxmlSource).toContain("privacy-submit-native-icon")
    expect(wxmlSource).toContain("privacy-retry-native-icon")
    expect(wxmlSource).toContain("privacy-cancel-native-icon")
    expect(wxmlSource).toContain("privacy-list-native-icon")
    expect(wxmlSource).toContain("privacy-more-native-icon")
    expect(wxmlSource).toContain("privacy-complete-native-icon")
    expect(wxmlSource).toContain('aria-pressed="{{currentFilter === \'all\'}}"')
    expect(wxmlSource).toContain('aria-pressed="{{currentFilter === \'active\'}}"')
    expect(wxmlSource).toContain('aria-pressed="{{currentFilter === \'completed\'}}"')
    expect(wxmlSource).toContain('aria-role="group" aria-label="个人信息申请记录状态筛选"')
    expect(wxmlSource).toContain('aria-label="查看当前已加载的 {{requestSummary.total}} 条申请"')
    expect(wxmlSource).toContain('aria-label="查看处理中的 {{requestSummary.active}} 条申请"')
    expect(wxmlSource).toContain('aria-label="查看已结束的 {{requestSummary.completed}} 条申请"')
    expect(wxmlSource).toContain('class="hero-emblem" src="/assets/icons/jijing-garage-emblem.png" mode="aspectFill" aria-hidden="true"')
    expect(wxmlSource).toContain('aria-role="radiogroup"')
    expect(wxmlSource).toContain('class="privacy-required-mark"')
    expect(wxmlSource).toContain("{{formReady ? 'description-input-ready' : ''}}")
    expect(wxmlSource).toContain('aria-required="{{true}}"')
    expect(wxmlSource).toContain('hover-class="privacy-submit-pressed"')
    expect(wxssSource).toContain(".description-input:focus")
    expect(wxssSource).toContain(".description-input-ready")
    expect(wxssSource).toContain(".privacy-submit-pressed")
    expect(wxmlSource).toContain('hover-class="record-filter-pressed"')
    expect(wxmlSource).toContain("form-tip-native-icon")
    expect(wxmlSource).toContain("{{cancellingId === item.id ? '正在撤回' : '撤回申请'}}")
    expect(wxmlSource).toContain("{{loading ? '正在加载' : '加载更多'}}")
    expect(wxmlSource).toContain("'正在撤回' + item.typeLabel + '申请'")
    expect(wxmlSource).not.toContain('bindtap="handleRetry">重新加载</button>')
    expect(wxssSource).toContain(".privacy-action-content")
    expect(wxssSource).toContain(".form-tip-native-icon")
    expect(wxssSource).toContain(".record-filter-pressed")
    expect(wxssSource).toContain("calc(24rpx + env(safe-area-inset-right))")
    expect(wxssSource).toContain("calc(24rpx + env(safe-area-inset-left))")
    expect(wxssSource).toContain("calc(60rpx + env(safe-area-inset-bottom))")
    expect(wxssSource).toMatch(/\.hero-emblem\s*\{[^}]*border-radius:\s*50%/s)
  })

  test("申请记录汇总处理中与已结束状态并支持筛选", () => {
    const page = createPage(loadPageDefinition())
    page.applyRequestList(
      [
        {
          id: "pending",
          type: "access",
          status: "pending"
        },
        {
          id: "processing",
          type: "correction",
          status: "processing"
        },
        {
          id: "completed",
          type: "deletion",
          status: "completed"
        },
        {
          id: "cancelled",
          type: "access",
          status: "cancelled"
        }
      ],
      {
        page: 0,
        hasMore: false
      }
    )

    expect(page.data.requestSummary).toEqual({
      total: 4,
      active: 2,
      completed: 2
    })
    expect(page.data.list[0]).toMatchObject({
      statusLabel: "待处理",
      canCancel: true,
      active: true
    })

    page.handleRecordFilterTap({
      currentTarget: {
        dataset: {
          filter: "active"
        }
      }
    })

    expect(page.data.visibleList.map((item) => item.id)).toEqual(["pending", "processing"])

    page.handleRecordFilterTap({
      currentTarget: {
        dataset: {
          filter: "completed"
        }
      }
    })

    expect(page.data.visibleList.map((item) => item.id)).toEqual(["completed", "cancelled"])
    expect(page.data.list.find((item) => item.id === "completed").stageHint).toContain("处理完成")
  })
})
