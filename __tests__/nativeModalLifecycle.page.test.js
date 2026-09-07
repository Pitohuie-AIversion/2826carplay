function loadPageDefinition(modulePath) {
  jest.resetModules()
  let definition = null
  global.Page = jest.fn((input) => {
    definition = input
  })
  require(modulePath)
  return definition
}

function createPage(definition, data) {
  const page = {
    ...definition,
    data: {
      ...definition.data,
      ...(data || {})
    }
  }
  page.setData = jest.fn((patch) => {
    Object.assign(page.data, patch)
  })
  return page
}

describe("native callback lifecycle", () => {
  afterEach(() => {
    delete global.Page
    delete global.wx
    delete global.getCurrentPages
    delete global.getApp
  })

  test("does not remove a favorite after the page unloads", () => {
    let modalOptions
    global.wx = {
      showModal: jest.fn((options) => {
        modalOptions = options
      }),
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition("../pages/favorites/favorites"))
    page.removeFavorite = jest.fn()

    page.handleRemove({ currentTarget: { dataset: { id: "favorite-unload" } } })
    page.onUnload()
    modalOptions.success({ confirm: true })

    expect(page.removeFavorite).not.toHaveBeenCalled()
  })

  test("does not start analytics cleanup after the page unloads", () => {
    let modalOptions
    global.wx = {
      showModal: jest.fn((options) => {
        modalOptions = options
      }),
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition("../pages-admin/analytics-manage/analytics-manage"), {
      canCleanup: true,
      loading: false
    })
    page.runCleanup = jest.fn()

    page.handleCleanup()
    page.onUnload()
    modalOptions.success({ confirm: true })

    expect(page.runCleanup).not.toHaveBeenCalled()
  })

  test("does not update a vehicle after the list page unloads", () => {
    let modalOptions
    global.wx = {
      showModal: jest.fn((options) => {
        modalOptions = options
      }),
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition("../pages-admin/vehicle-manage/vehicle-manage"))
    page.updateVehicleStatus = jest.fn()

    page.handleUpdateStatus({
      currentTarget: {
        dataset: {
          id: "vehicle-unload",
          status: "idle",
          currentStatus: "active",
          plateNumber: "沪A00001"
        }
      }
    })
    page.onUnload()
    modalOptions.success({ confirm: true })

    expect(page.updateVehicleStatus).not.toHaveBeenCalled()
  })

  test("does not run a mine tool after its confirmation page unloads", () => {
    let modalOptions
    global.wx = {
      cloud: { callFunction: jest.fn() },
      showModal: jest.fn((options) => {
        modalOptions = options
      }),
      showToast: jest.fn(),
      hideLoading: jest.fn()
    }
    const page = createPage(loadPageDefinition("../pages/mine/mine"))
    page.runMineTool = jest.fn()

    page.handleMenuTap({
      currentTarget: { dataset: { key: "storageCleanup", title: "存储清理" } }
    })
    page.onUnload()
    modalOptions.success({ confirm: true })

    expect(page.runMineTool).not.toHaveBeenCalled()
  })

  test("does not export personal data after the inventory page unloads", () => {
    let modalOptions
    global.wx = {
      cloud: { callFunction: jest.fn() },
      showModal: jest.fn((options) => {
        modalOptions = options
      }),
      showToast: jest.fn()
    }
    const page = createPage(
      loadPageDefinition("../pages-admin/privacy-data-inventory/privacy-data-inventory"),
      {
        loading: false,
        refreshing: false,
        requestId: "privacy-unload",
        request: { type: "access" }
      }
    )

    page.handleExport()
    page.onUnload()
    modalOptions.success({ confirm: true })

    expect(global.wx.cloud.callFunction).not.toHaveBeenCalled()
    expect(page.data.exporting).toBe(false)
  })

  test("does not update booking priority after the action sheet page unloads", () => {
    let actionSheetOptions
    global.wx = {
      showActionSheet: jest.fn((options) => {
        actionSheetOptions = options
      }),
      showToast: jest.fn()
    }
    const page = createPage(
      loadPageDefinition("../pages/booking-workbench/booking-workbench"),
      {
        loading: false,
        refreshing: false
      }
    )
    page.updateCoordination = jest.fn()

    page.handlePriorityTap({
      currentTarget: {
        dataset: {
          id: "booking-unload",
          schedulePriority: "normal",
          coordinationStatus: "pending"
        }
      }
    })
    page.onUnload()
    actionSheetOptions.success({ tapIndex: 1 })

    expect(page.updateCoordination).not.toHaveBeenCalled()
  })

  test("does not handle a privacy request after the action sheet page unloads", () => {
    let actionSheetOptions
    global.wx = {
      showActionSheet: jest.fn((options) => {
        actionSheetOptions = options
      }),
      showToast: jest.fn()
    }
    const request = {
      id: "privacy-unload",
      type: "delete",
      status: "pending",
      canHandle: true
    }
    const page = createPage(
      loadPageDefinition("../pages-admin/privacy-request-manage/privacy-request-manage"),
      { list: [request] }
    )
    page.updateStatus = jest.fn()
    page.promptResolution = jest.fn()

    page.handleRequestAction({ currentTarget: { dataset: { id: request.id } } })
    page.onUnload()
    actionSheetOptions.success({ tapIndex: 0 })

    expect(page.updateStatus).not.toHaveBeenCalled()
    expect(page.promptResolution).not.toHaveBeenCalled()
  })

  test("does not report a section scroll failure after the content page unloads", () => {
    let scrollOptions
    global.wx = {
      pageScrollTo: jest.fn((options) => {
        scrollOptions = options
      }),
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition("../pages/content-page/content-page"), {
      sections: [{ key: "privacy-rights" }]
    })

    page.handleSectionTap({
      currentTarget: { dataset: { key: "privacy-rights" } }
    })
    page.onUnload()
    scrollOptions.fail({ errMsg: "pageScrollTo:fail" })

    expect(global.wx.showToast).not.toHaveBeenCalled()
  })

  test.each([
    ["vehicle management", "../pages-admin/vehicle-manage/vehicle-manage"],
    ["booking management", "../pages/booking-manage/booking-manage"],
    ["audit log management", "../pages-admin/audit-log-manage/audit-log-manage"],
    ["error log management", "../pages-admin/error-log-manage/error-log-manage"],
    ["privacy request management", "../pages-admin/privacy-request-manage/privacy-request-manage"]
  ])("does not reload %s after a delayed clear-search render callback", (_label, modulePath) => {
    global.wx = {}
    const page = createPage(loadPageDefinition(modulePath), { keyword: "待清空" })
    let renderCallback
    page.setData = jest.fn((patch, done) => {
      Object.assign(page.data, patch)
      renderCallback = done
    })
    page.fetchList = jest.fn()

    page.handleClearKeyword()
    page.onUnload()
    renderCallback()

    expect(page.fetchList).not.toHaveBeenCalled()
  })

  test.each([
    [
      "booking workbench",
      "../pages/booking-workbench/booking-workbench",
      { loading: false, phone: "13800138000" },
      "handleCopyPhone",
      { currentTarget: { dataset: { phone: "13800138000" } } }
    ],
    [
      "booking detail",
      "../pages/booking-detail/booking-detail",
      { booking: { id: "booking-hidden" } },
      "handleCopyBookingId",
      undefined
    ]
  ])("does not show a late clipboard result over %s's next page", (_label, modulePath, data, handler, event) => {
    let clipboardOptions
    global.wx = {
      setClipboardData: jest.fn((options) => {
        clipboardOptions = options
      }),
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition(modulePath), data)
    global.getCurrentPages = jest.fn(() => [page])

    page[handler](event)
    global.getCurrentPages.mockReturnValue([page, {}])
    clipboardOptions.success()

    expect(global.wx.showToast).not.toHaveBeenCalled()
  })

  test("does not show a clipboard result while the mini program is hidden", () => {
    let clipboardOptions
    global.wx = {
      setClipboardData: jest.fn((options) => {
        clipboardOptions = options
      }),
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition("../pages/booking-workbench/booking-workbench"), {
      loading: false
    })
    global.getCurrentPages = jest.fn(() => [page])
    global.getApp = jest.fn(() => ({
      globalData: { nativeActionAppVisible: true }
    }))

    page.handleCopyPhone({
      currentTarget: { dataset: { phone: "13800138000" } }
    })
    global.getApp.mockReturnValue({
      globalData: { nativeActionAppVisible: false }
    })
    clipboardOptions.success()

    expect(global.wx.showToast).not.toHaveBeenCalled()
  })

  test.each([
    [
      "vehicle management mutation",
      "../pages-admin/vehicle-manage/vehicle-manage",
      { pageAuthorized: true, updatingId: "vehicle-writing" },
      "fetchList",
      (page) => {
        page._vehicleMutationLoadingVisible = true
      }
    ],
    [
      "booking cancellation",
      "../pages/bookings/bookings",
      { loading: true },
      "loadList",
      () => {}
    ],
    [
      "workbench write",
      "../pages/booking-workbench/booking-workbench",
      { pageAuthorized: true, allBookings: [{ id: "booking-writing" }], statusUpdatingId: "booking-writing" },
      "fetchBookings",
      (page) => {
        page._workbenchWriteActive = true
      }
    ],
    [
      "booking detail edit",
      "../pages/booking-detail/booking-detail",
      { id: "booking-editing", editing: true },
      "loadDetail",
      () => {}
    ],
    [
      "mine tool",
      "../pages/mine/mine",
      { permissionsReady: true, summaryLoading: false },
      "loadOperationSummary",
      (page) => {
        page._mineToolActive = true
      }
    ]
  ])("does not auto-refresh during an active %s", (_label, modulePath, data, refreshMethod, prepare) => {
    global.wx = {}
    const page = createPage(loadPageDefinition(modulePath), data)
    page[refreshMethod] = jest.fn()
    prepare(page)

    page.onShow()

    expect(page[refreshMethod]).not.toHaveBeenCalled()
  })

  test.each([
    [
      "vehicle management",
      "../pages-admin/vehicle-manage/vehicle-manage",
      { pageAuthorized: true, updatingId: "vehicle-writing" },
      "fetchList"
    ],
    [
      "booking workbench",
      "../pages/booking-workbench/booking-workbench",
      { pageAuthorized: true, statusUpdatingId: "booking-writing" },
      "fetchBookings"
    ]
  ])("does not pull-to-refresh %s during a write", (_label, modulePath, data, refreshMethod) => {
    global.wx = { stopPullDownRefresh: jest.fn() }
    const page = createPage(loadPageDefinition(modulePath), data)
    page[refreshMethod] = jest.fn()

    page.onPullDownRefresh()

    expect(page[refreshMethod]).not.toHaveBeenCalled()
    expect(global.wx.stopPullDownRefresh).toHaveBeenCalledTimes(1)
  })

  test.each([
    ["analytics", "../pages-admin/analytics-manage/analytics-manage", { loading: true }, "handleRetry", "fetchOverview"],
    ["favorites", "../pages/favorites/favorites", { loading: true }, "handleRetry", "fetchList"],
    ["privacy requests", "../pages/privacy-request/privacy-request", { loading: true }, "handleRetry", "fetchList"],
    ["workbench", "../pages/booking-workbench/booking-workbench", { loading: true }, "handleRetry", "fetchBookings"],
    ["booking detail", "../pages/booking-detail/booking-detail", { loading: true }, "handleRetryLoad", "loadDetail"],
    ["managed booking detail", "../pages/booking-manage-detail/booking-manage-detail", { loading: true }, "handleRetryLoad", "loadDetail"],
    ["configuration", "../pages-admin/config-manage/config-manage", { loading: true }, "handleRetryLoad", "fetchConfig"],
    ["bookings", "../pages/bookings/bookings", { loading: true }, "handleRetryLoad", "loadList"],
    ["vehicle edit", "../pages-admin/vehicle-edit/vehicle-edit", { id: "vehicle-busy", loading: true }, "handleRetryLoad", "fetchDetail"],
    ["booking form", "../pages/booking/booking", { loadingCar: true }, "handleRetryLoad", "loadBookingCar"],
    ["car detail", "../pages/car-detail/car-detail", { loading: true }, "handleRetryLoad", "loadCarDetail"],
    ["garage", "../pages/garage/garage", { loadingCars: true }, "handleRetryLoad", "loadCars"]
  ])("does not retry %s while its page is busy", (_label, modulePath, data, handler, readMethod) => {
    global.wx = {}
    const page = createPage(loadPageDefinition(modulePath), data)
    page[readMethod] = jest.fn()

    page[handler]()

    expect(page[readMethod]).not.toHaveBeenCalled()
  })

  test.each([
    [
      "booking management detail navigation",
      "../pages/booking-manage/booking-manage",
      { loading: true },
      () => {},
      "handleViewDetail",
      { currentTarget: { dataset: { id: "booking-writing" } } },
      "navigateTo"
    ],
    [
      "workbench phone copy",
      "../pages/booking-workbench/booking-workbench",
      { statusUpdatingId: "booking-writing" },
      (page) => {
        page._workbenchWriteActive = true
      },
      "handleCopyPhone",
      { currentTarget: { dataset: { phone: "13800138000" } } },
      "setClipboardData"
    ],
    [
      "managed booking conflict navigation",
      "../pages/booking-manage-detail/booking-manage-detail",
      { id: "booking-current" },
      (page) => {
        page._bookingDetailMutationActive = true
      },
      "handleConflictTap",
      { currentTarget: { dataset: { id: "booking-conflict" } } },
      "navigateTo"
    ],
    [
      "vehicle management edit navigation",
      "../pages-admin/vehicle-manage/vehicle-manage",
      { updatingId: "vehicle-writing" },
      () => {},
      "handleEdit",
      { currentTarget: { dataset: { id: "vehicle-writing" } } },
      "navigateTo"
    ],
    [
      "vehicle image preview",
      "../pages-admin/vehicle-detail-manage/vehicle-detail-manage",
      {
        uploading: true,
        detail: { imageList: ["cloud://vehicle/image.jpg"] }
      },
      () => {},
      "handlePreviewImage",
      { currentTarget: { dataset: { fileId: "cloud://vehicle/image.jpg" } } },
      "previewImage"
    ],
    [
      "privacy request account copy",
      "../pages-admin/privacy-request-manage/privacy-request-manage",
      { updatingId: "privacy-writing" },
      () => {},
      "handleCopyOpenid",
      { currentTarget: { dataset: { openid: "openid-writing" } } },
      "setClipboardData"
    ],
    [
      "privacy inventory booking navigation",
      "../pages-admin/privacy-data-inventory/privacy-data-inventory",
      { exporting: true },
      () => {},
      "handleBookingTap",
      { currentTarget: { dataset: { id: "booking-exporting" } } },
      "navigateTo"
    ]
  ])("does not start %s while a write is active", (_label, modulePath, data, prepare, handler, event, nativeMethod) => {
    global.wx = {
      navigateTo: jest.fn(),
      previewImage: jest.fn(),
      setClipboardData: jest.fn()
    }
    const page = createPage(loadPageDefinition(modulePath), data)
    prepare(page)

    page[handler](event)

    expect(global.wx[nativeMethod]).not.toHaveBeenCalled()
  })

  test.each([
    ["booking export", "../pages/booking-manage/booking-manage", { loading: true }],
    ["audit export", "../pages-admin/audit-log-manage/audit-log-manage", { exporting: true }],
    ["error export", "../pages-admin/error-log-manage/error-log-manage", { exporting: true }],
    ["privacy export", "../pages-admin/privacy-data-inventory/privacy-data-inventory", { exporting: true }]
  ])("does not use a replacing %s file", (_label, modulePath, busyData) => {
    global.wx = {
      shareFileMessage: jest.fn(),
      openDocument: jest.fn(),
      showModal: jest.fn()
    }
    const page = createPage(loadPageDefinition(modulePath), {
      ...busyData,
      exportFilePath: "/tmp/export.csv",
      exportFileName: "export.csv"
    })

    page.handleShareExportedFile()
    page.handleOpenExportedFile()
    page.handleDeleteExportedFile()

    expect(global.wx.shareFileMessage).not.toHaveBeenCalled()
    expect(global.wx.openDocument).not.toHaveBeenCalled()
    expect(global.wx.showModal).not.toHaveBeenCalled()
  })

  test.each([
    [
      "favorite removal",
      "../pages/favorites/favorites",
      { loading: false, removingId: "vehicle-active" },
      "removeFavorite",
      "vehicle-next"
    ],
    [
      "privacy request cancellation",
      "../pages/privacy-request/privacy-request",
      { loading: false, submitting: false, cancellingId: "privacy-active" },
      "cancelRequest",
      "privacy-next"
    ],
    [
      "booking list cancellation",
      "../pages/bookings/bookings",
      { loading: true },
      "cancelBooking",
      "booking-next"
    ],
    [
      "booking detail cancellation",
      "../pages/booking-detail/booking-detail",
      { loading: true, saving: false, canCancel: true, id: "booking-current" },
      "cancelBooking",
      "booking-current"
    ]
  ])("does not replace an active %s request", (_label, modulePath, data, method, id) => {
    global.wx = {
      cloud: { callFunction: jest.fn() },
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition(modulePath), data)

    page[method](id)

    expect(global.wx.cloud.callFunction).not.toHaveBeenCalled()
  })

  test("only accepts the newest favorite removal confirmation", () => {
    const modalOptions = []
    global.wx = {
      showModal: jest.fn((options) => modalOptions.push(options))
    }
    const page = createPage(loadPageDefinition("../pages/favorites/favorites"), {
      loading: false,
      removingId: ""
    })
    page.removeFavorite = jest.fn()
    const event = { currentTarget: { dataset: { id: "vehicle-confirm" } } }

    page.handleRemove(event)
    page.handleRemove(event)
    modalOptions[0].success({ confirm: true })
    modalOptions[1].success({ confirm: true })

    expect(page.removeFavorite).toHaveBeenCalledTimes(1)
  })

  test("invalidates an older vehicle confirmation when another write is chosen", () => {
    const modalOptions = []
    global.wx = {
      showModal: jest.fn((options) => modalOptions.push(options))
    }
    const page = createPage(loadPageDefinition("../pages-admin/vehicle-manage/vehicle-manage"), {
      loading: false,
      updatingId: "",
      deletingId: ""
    })
    page.retireVehicle = jest.fn()
    page.deleteVehicle = jest.fn()
    const event = {
      currentTarget: {
        dataset: { id: "vehicle-confirm", plateNumber: "沪A00001" }
      }
    }

    page.handleRetire(event)
    page.handleDelete(event)
    modalOptions[0].success({ confirm: true })
    modalOptions[1].success({ confirm: true })

    expect(page.retireVehicle).not.toHaveBeenCalled()
    expect(page.deleteVehicle).toHaveBeenCalledTimes(1)
  })

  test("only opens one booking detail cancellation confirmation at a time", () => {
    const modalOptions = []
    global.wx = {
      showModal: jest.fn((options) => modalOptions.push(options))
    }
    const page = createPage(loadPageDefinition("../pages/booking-detail/booking-detail"), {
      loading: false,
      saving: false,
      canCancel: true,
      id: "booking-confirm"
    })
    page.cancelBooking = jest.fn()

    page.handleCancel()
    page.handleCancel()
    modalOptions[0].success({ confirm: true })

    expect(global.wx.showModal).toHaveBeenCalledTimes(1)
    expect(page.cancelBooking).toHaveBeenCalledTimes(1)
    expect(page.cancelBooking).toHaveBeenCalledWith("booking-confirm")
  })

  test("only starts one personal-data export from duplicate confirmations", () => {
    const modalOptions = []
    global.wx = {
      cloud: { callFunction: jest.fn() },
      showModal: jest.fn((options) => modalOptions.push(options)),
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition("../pages-admin/privacy-data-inventory/privacy-data-inventory"), {
      loading: false,
      refreshing: false,
      exporting: false,
      partial: false,
      requestId: "privacy-export",
      request: { type: "access" }
    })

    page.handleExport()
    page.handleExport()
    modalOptions[0].success({ confirm: true })
    modalOptions[1].success({ confirm: true })

    expect(global.wx.cloud.callFunction).toHaveBeenCalledTimes(1)
    page.onUnload()
  })

  test.each([
    ["booking", "../pages/booking-manage/booking-manage", "loading"],
    ["audit", "../pages-admin/audit-log-manage/audit-log-manage", "exporting"],
    ["error", "../pages-admin/error-log-manage/error-log-manage", "exporting"],
    ["privacy", "../pages-admin/privacy-data-inventory/privacy-data-inventory", "exporting"]
  ])("ignores a stale %s file deletion confirmation after replacement starts", (_label, modulePath, busyField) => {
    let modalOptions
    global.wx = {
      getFileSystemManager: jest.fn(),
      showModal: jest.fn((options) => {
        modalOptions = options
      })
    }
    const page = createPage(loadPageDefinition(modulePath), {
      loading: false,
      exporting: false,
      exportFilePath: "/tmp/export.csv",
      exportFileName: "export.csv"
    })

    page.handleDeleteExportedFile()
    page.data[busyField] = true
    modalOptions.success({ confirm: true })

    expect(global.wx.getFileSystemManager).not.toHaveBeenCalled()
  })

  test.each([
    [
      "vehicle create",
      "../pages-admin/vehicle-create/vehicle-create",
      { isSubmitting: true },
      (page) => {
        page.handlePlateInput({ detail: { value: "沪A00001" } })
        page.handleTextInput({ currentTarget: { dataset: { field: "brandModel" } }, detail: { value: "MX-5" } })
        page.handleVehicleTypeChange({ detail: { value: 1 } })
        page.handleStatusChange({ detail: { value: 1 } })
        page.handleDateChange({ detail: { value: "2026-08-08" } })
        page.handleTransmissionChange({ detail: { value: 1 } })
        page.handleFuelTypeChange({ detail: { value: 1 } })
      }
    ],
    [
      "vehicle edit",
      "../pages-admin/vehicle-edit/vehicle-edit",
      { isSubmitting: true },
      (page) => {
        page.handlePlateInput({ detail: { value: "沪A00001" } })
        page.handleTextInput({ currentTarget: { dataset: { field: "brandModel" } }, detail: { value: "MX-5" } })
        page.handleVehicleTypeChange({ detail: { value: 1 } })
        page.handleStatusChange({ detail: { value: 1 } })
        page.handleDateChange({ detail: { value: "2026-08-08" } })
        page.handleTransmissionChange({ detail: { value: 1 } })
        page.handleFuelTypeChange({ detail: { value: 1 } })
      }
    ],
    [
      "booking submission",
      "../pages/booking/booking",
      { isSubmitting: true, cityOptions: ["上海"] },
      (page) => {
        page._savedContact = { userName: "张先生", phone: "13800138000" }
        page.handleUseSavedContact()
        page.handleInput({ currentTarget: { dataset: { field: "userName" } }, detail: { value: "李先生" } })
        page.handleDateChange({ currentTarget: { dataset: { field: "startDate" } }, detail: { value: "2026-08-09" } })
        page.handleDateShortcut({ currentTarget: { dataset: { action: "tomorrow" } } })
        page.handleCityChange({ detail: { value: 0 } })
        page.handlePrivacyAgreementChange({ detail: { value: ["agreed"] } })
        page.checkVehicleAvailability()
      }
    ],
    [
      "booking detail save",
      "../pages/booking-detail/booking-detail",
      { editing: true, saving: true },
      (page) => page.handleEditInput({
        currentTarget: { dataset: { field: "userName" } },
        detail: { value: "迟到姓名" }
      })
    ],
    [
      "privacy request submission",
      "../pages/privacy-request/privacy-request",
      { submitting: true },
      (page) => {
        page.handleTypeTap({ currentTarget: { dataset: { value: "delete" } } })
        page.handleDescriptionInput({ detail: { value: "迟到说明" } })
      }
    ],
    [
      "configuration save",
      "../pages-admin/config-manage/config-manage",
      { saving: true, hasLoadedConfig: true, loadFailed: false },
      (page) => {
        page.handleInput({ currentTarget: { dataset: { field: "brandName" } }, detail: { value: "迟到品牌" } })
        page.handleReset()
      }
    ],
    [
      "role save",
      "../pages-admin/role-manage/role-manage",
      { saving: true },
      (page) => {
        page.handleOpenidInput({ detail: { value: "openid-late" } })
        page.handleTogglePermission({ currentTarget: { dataset: { value: "canManageBookings" } } })
        page.handleEditRole({ currentTarget: { dataset: { openid: "openid-late", permissions: [] } } })
        page.handleResetForm()
      }
    ]
  ])("does not mutate the %s form while its save snapshot is active", (_label, modulePath, data, exercise) => {
    global.wx = {}
    const page = createPage(loadPageDefinition(modulePath), data)

    exercise(page)

    expect(page.setData).not.toHaveBeenCalled()
  })

  test("does not start vehicle or booking management reads during writes", () => {
    global.wx = { stopPullDownRefresh: jest.fn() }
    const vehiclePage = createPage(loadPageDefinition("../pages-admin/vehicle-manage/vehicle-manage"), {
      keyword: "车辆",
      currentStatus: "all",
      hasMore: true,
      updatingId: "vehicle-writing"
    })
    vehiclePage.fetchList = jest.fn()
    vehiclePage.handleKeywordConfirm()
    vehiclePage.handleStatusTap({ currentTarget: { dataset: { status: "active" } } })
    vehiclePage.handleReset()
    vehiclePage.handleLoadMore()

    const bookingPage = createPage(loadPageDefinition("../pages/booking-manage/booking-manage"), {
      loading: true,
      currentStatus: "all",
      currentPriority: "all",
      currentCoordination: "all",
      hasMore: true,
      pageAuthorized: true
    })
    bookingPage.fetchList = jest.fn()
    bookingPage.handleKeywordConfirm()
    bookingPage.handleSearch()
    bookingPage.handleStatusTap({ currentTarget: { dataset: { status: "pending" } } })
    bookingPage.handlePriorityTap({ currentTarget: { dataset: { value: "priority" } } })
    bookingPage.handleCoordinationTap({ currentTarget: { dataset: { value: "pending" } } })
    bookingPage.handleReset()
    bookingPage.handleLoadMore()
    bookingPage.onPullDownRefresh()

    expect(vehiclePage.fetchList).not.toHaveBeenCalled()
    expect(bookingPage.fetchList).not.toHaveBeenCalled()
    expect(global.wx.stopPullDownRefresh).toHaveBeenCalledTimes(1)
  })

  test.each([
    [
      "audit logs",
      "../pages-admin/audit-log-manage/audit-log-manage",
      { keyword: "审计", currentAction: "create" },
      "handleResetFilters"
    ],
    [
      "error logs",
      "../pages-admin/error-log-manage/error-log-manage",
      { keyword: "错误", currentFunc: "bookingCreate" },
      "handleResetFilters"
    ],
    [
      "privacy requests",
      "../pages-admin/privacy-request-manage/privacy-request-manage",
      { keyword: "申请", currentType: "delete", currentStatus: "completed" },
      "handleResetFilters"
    ]
  ])("does not reload %s after a delayed reset callback unloads", (_label, modulePath, data, handler) => {
    global.wx = {}
    const page = createPage(loadPageDefinition(modulePath), data)
    let renderCallback
    page.setData = jest.fn((patch, done) => {
      Object.assign(page.data, patch)
      renderCallback = done
    })
    page.fetchList = jest.fn()

    page[handler]()
    page.onUnload()
    renderCallback()

    expect(page.fetchList).not.toHaveBeenCalled()
  })
})
