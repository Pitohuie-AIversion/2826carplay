describe("privacy request confirmed facts survive list reconciliation", () => {
  let page
  let stack
  let requests
  let storage
  const existing = { id: "request_old", type: "access", description: "原有查询申请", status: "pending" }
  const draft = "新的更正说明"

  beforeEach(() => {
    jest.resetModules()
    jest.useFakeTimers()
    requests = []
    storage = new Map()
    global.wx = {
      cloud: { callFunction: jest.fn((options) => requests.push(options)) },
      showToast: jest.fn(),
      enableAlertBeforeUnload: jest.fn(({ success }) => success()),
      disableAlertBeforeUnload: jest.fn(({ success }) => success()),
      getStorageSync: (key) => storage.get(key),
      setStorageSync: jest.fn((key, value) => storage.set(key, value))
    }
    global.Page = (definition) => {
      page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) }
      page.setData = jest.fn((patch) => Object.assign(page.data, patch))
    }
    require("../pages/privacy-request/privacy-request")
    stack = [page]
    global.getCurrentPages = () => stack
    page.fetchList()
    requests[0].success({ result: { ok: true, page: 0, hasMore: true, list: [{ ...existing }] } })
    requests = []
    page.handleTypeTap({ currentTarget: { dataset: { value: "correction" } } })
    page.handleDescriptionInput({ detail: { value: draft } })
  })

  afterEach(() => {
    page.onUnload()
    expect(jest.getTimerCount()).toBe(0)
    jest.useRealTimers()
    delete global.Page
    delete global.wx
    delete global.getCurrentPages
  })

  test.each(["submit", "cancel"].flatMap((kind) => [false, true].flatMap((background) => ["network", "business", "malformed", "timeout"].map((failure) => [kind, background, failure]))))(
    "%s confirmed result survives refresh failure; background=%s failure=%s", (kind, background, failure) => {
      if (kind === "submit") page.handleSubmit()
      else {
        page.handleRecordFilterTap({ currentTarget: { dataset: { filter: "active" } } })
        page.cancelRequest(existing.id)
        page.handleDescriptionInput({ detail: { value: "撤回期间继续编辑" } })
      }
      const confirmed = kind === "submit"
        ? { id: "request_new", type: "correction", description: draft, status: "pending" }
        : { ...existing, status: "cancelled" }
      if (background) stack = [page, {}]
      page.setData.mockClear()
      requests[0].success({ result: { ok: true, id: confirmed.id, status: confirmed.status } })
      if (background) {
        expect(page.setData).not.toHaveBeenCalled()
        expect(wx.showToast).not.toHaveBeenCalled()
        expect(requests).toHaveLength(1)
        stack = [page]
        page.onShow()
      }
      expect(page.data.list.find((item) => item.id === confirmed.id)).toMatchObject(confirmed)
      expect(storage.get("privacy_requests_snapshot").find((item) => item.id === confirmed.id)).toMatchObject(confirmed)
      expect(page.data.description).toBe(kind === "submit" ? "" : "撤回期间继续编辑")
      expect(page._hasUnsavedChanges).toBe(kind === "cancel")
      if (kind === "cancel") {
        expect(page.data.visibleList).toEqual([])
        expect(page.data.requestSummary).toEqual({ total: 1, active: 0, completed: 1 })
      }
      expect(requests[1].name).toBe("privacyRequestMyList")
      if (failure === "network") requests[1].fail(new Error("offline"))
      else if (failure === "business") requests[1].success({ result: { ok: false, message: "服务暂不可用" } })
      else if (failure === "malformed") requests[1].success({ result: { ok: true, list: null } })
      else jest.advanceTimersByTime(15000)
      expect(page.data.list.find((item) => item.id === confirmed.id)).toMatchObject(confirmed)
      expect(page.data.loadError).not.toBe("")
      expect(page.data.submitting).toBe(false)
      expect(page.data.cancellingId).toBe("")

      page.handleRetry()
      requests[2].success({ result: { ok: true, page: 0, hasMore: false, list: [{ ...confirmed, resolutionNote: "服务端最新记录" }] } })
      expect(page.data.list).toHaveLength(1)
      expect(page.data.list[0]).toMatchObject({ ...confirmed, resolutionNote: "服务端最新记录" })
      expect(page.data.requestSummary.total).toBe(1)
      expect(page.data.loadError).toBe("")
      expect(storage.get("privacy_requests_snapshot")).toHaveLength(1)
    }
  )

  test("idempotent submit response updates an existing real id without inventing pending status or another row", () => {
    page.applyRequestList([{ id: "request_replayed", type: "correction", description: draft, status: "processing" }])
    page.handleSubmit()
    requests[0].success({ result: { ok: true, id: "request_replayed", status: "completed", duplicate: true } })
    expect(page.data.list).toHaveLength(1)
    expect(page.data.list[0]).toMatchObject({ id: "request_replayed", status: "completed", description: draft, canCancel: false })
    expect(page.data.requestSummary).toEqual({ total: 1, active: 0, completed: 1 })
    requests[1].fail(new Error("offline"))
    expect(storage.get("privacy_requests_snapshot")[0].status).toBe("completed")
  })

  test("after creation changes list positions, load-more retries the first page and the snapshot stays one page", () => {
    page.data.pageSize = 1
    page.handleLoadMore()
    requests[0].success({ result: { ok: true, page: 1, hasMore: true, list: [{ ...existing, id: "request_older" }] } })
    page.handleSubmit()
    requests[1].success({ result: { ok: true, id: "request_new", status: "pending" } })
    expect(storage.get("privacy_requests_snapshot").map((item) => item.id)).toEqual(["request_new"])
    requests[2].fail(new Error("offline"))
    page.handleLoadMore()
    expect(requests[3].data.page).toBe(0)
    requests[3].success({ result: { ok: true, page: 0, hasMore: true, list: [{ id: "request_new", type: "correction", description: draft, status: "pending" }] } })
    expect(page.data.list.map((item) => item.id)).toEqual(["request_new"])
    page.handleLoadMore()
    expect(requests[4].data.page).toBe(1)
  })

  test.each([
    { status: "pending" },
    { id: "  ", status: "pending" },
    { id: 42, status: "pending" },
    { id: "request_new" },
    { id: "request_new", status: "unknown" }
  ])("an incomplete create result %j refreshes without inventing a persistent request", (result) => {
    page.handleSubmit()
    requests[0].success({ result: { ok: true, ...result } })
    expect(page.data.list.map((item) => item.id)).toEqual([existing.id])
    expect(storage.get("privacy_requests_snapshot").map((item) => item.id)).toEqual([existing.id])
    expect(page.data.description).toBe("")
    expect(requests[1].name).toBe("privacyRequestMyList")
  })

  test("creation replaces an in-flight older page, finishing its callback once and ignoring late data", () => {
    const done = jest.fn()
    page.fetchList({ append: true, done })
    page.handleSubmit()
    requests[1].success({ result: { ok: true, id: "request_new", status: "pending" } })
    expect(done).toHaveBeenCalledTimes(1)
    expect(requests[2].data.page).toBe(0)
    expect(jest.getTimerCount()).toBe(1)
    requests[0].success({ result: { ok: true, page: 1, hasMore: false, list: [{ ...existing, id: "request_older" }] } })
    requests[0].fail(new Error("stale read failed"))
    expect(done).toHaveBeenCalledTimes(1)
    expect(page.data.list.map((item) => item.id)).toEqual(["request_new", existing.id])
    expect(page.data.loading).toBe(true)
    requests[2].fail(new Error("offline"))
    expect(page.data.list.map((item) => item.id)).toEqual(["request_new", existing.id])
    expect(jest.getTimerCount()).toBe(0)
  })

  test("cancelling a later-page item updates its state while the cache retains only the first page", () => {
    page.data.pageSize = 1
    page.handleLoadMore()
    requests[0].success({ result: { ok: true, page: 1, hasMore: false, list: [{ ...existing, id: "request_older" }] } })
    page.cancelRequest("request_older")
    requests[1].success({ result: { ok: true, id: "request_older", status: "cancelled" } })
    requests[2].fail(new Error("offline"))
    expect(page.data.list[1]).toMatchObject({ id: "request_older", status: "cancelled", canCancel: false })
    expect(storage.get("privacy_requests_snapshot").map((item) => item.id)).toEqual([existing.id])
    expect(page.data.description).toBe(draft)
    expect(page._hasUnsavedChanges).toBe(true)
  })
})
