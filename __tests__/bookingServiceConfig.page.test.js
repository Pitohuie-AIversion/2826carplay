const savedHubs = [
  { id: "sh-store", city: "上海", name: "已配置上海门店", address: "已保存上海地址", feeText: "费用以报价为准", type: "store", latitude: 31.21, longitude: 121.41 },
  { id: "hz-hub", city: "杭州", name: "已配置杭州接送点", address: "已保存杭州地址", feeText: "", type: "hub", latitude: null, longitude: null }
]

function createPage(route) {
  jest.resetModules()
  let definition
  global.Page = (value) => { definition = value }
  require(`../pages/${route}/${route}`)
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) }
  page.setData = jest.fn((patch) => {
    for (const [key, value] of Object.entries(patch)) {
      const parts = key.split(".")
      let target = page.data
      for (const part of parts.slice(0, -1)) target = target[part]
      target[parts[parts.length - 1]] = value
    }
  })
  return page
}

describe("预约已保存服务配置闭环", () => {
  afterEach(() => {
    jest.useRealTimers()
    delete global.Page
    delete global.wx
    delete global.getCurrentPages
    delete global.getApp
  })

  test.each(["picker", "input", "clear"])("车辆请求迟到或重试不得覆盖用户已操作城市：%s", (method) => {
    const requests = []
    global.wx = { cloud: { callFunction: jest.fn((request) => requests.push(request)) }, setNavigationBarTitle: jest.fn() }
    const page = createPage("booking")
    page.data.serviceHubs = savedHubs
    page.data.cityOptions = ["上海", "杭州"]
    page._initialCity = "上海"
    page.loadBookingCar("car_1")
    if (method === "picker") page.handleCityChange({ detail: { value: 1 } })
    else page.handleInput({ currentTarget: { dataset: { field: "city" } }, detail: { value: method === "clear" ? "" : "杭州" } })
    requests[0].success({ result: { ok: true, car: { name: "车辆", location: "上海" } } })
    page.loadBookingCar("car_1")
    requests[1].success({ result: { ok: true, car: { name: "车辆", location: "上海" } } })
    expect(page.data.form.city).toBe(method === "clear" ? "" : "杭州")
    expect(page.data.form.pickupLocation).toBe(method === "clear" ? "" : savedHubs[1].name)
    page.onUnload()
  })

  test("城市选择只接受市后缀等价，不把名称子串当作选中城市", () => {
    global.wx = {}
    const page = createPage("booking")
    page.data.cityOptions = ["上海", "杭州"]
    page.data.form.city = "海"
    page.syncCitySelection()
    expect(page.data.cityIndex).toBe(-1)
    page.data.form.city = "上海市"
    page.syncCitySelection()
    expect(page.data.cityIndex).toBe(0)
  })

  test("配置失败后可主动重试，成功清空也不会恢复已删除网点", () => {
    const requests = []
    global.wx = { cloud: { callFunction: jest.fn((request) => requests.push(request)) } }
    const page = createPage("booking")
    page.data.form.city = "上海"
    page.loadOperationConfig()
    requests[0].fail({ errMsg: "offline" })
    expect(page.data.operationConfigFailed).toBe(true)
    expect(page.data.operationConfigLoading).toBe(false)
    page.handleRetryServiceConfig()
    page.handleRetryServiceConfig()
    expect(requests).toHaveLength(2)
    requests[1].success({ result: { ok: true, config: { cityOptions: ["上海"], serviceHubs: savedHubs } } })
    expect(page.data.operationConfigFailed).toBe(false)
    expect(page.data.form.pickupLocation).toBe(savedHubs[0].name)
    page.loadOperationConfig({ force: true })
    requests[2].success({ result: { ok: true, config: { cityOptions: [], serviceHubs: [] } } })
    expect(page.data.operationConfigFailed).toBe(false)
    expect(page.data.form.pickupLocation).toBe("")
    expect(page.data.form.city).toBe("上海")
    page.onUnload()
  })

  test.each([false, true])("配置失败重试恢复同城已选网点，真实删除时不恢复：删除=%s", (deleted) => {
    const requests = []
    global.wx = { cloud: { callFunction: jest.fn((request) => requests.push(request)) } }
    const page = createPage("booking")
    const second = { ...savedHubs[0], id: "second", name: "同城第二网点" }
    page.data.form.city = "上海"
    page.data.serviceHubs = [savedHubs[0], second]
    page.syncCitySelection()
    page.handlePickupHubChange({ detail: { value: 1 } })
    expect(page.data.form.pickupLocation).toBe(second.name)
    page.loadOperationConfig({ force: true })
    requests[0].fail({ errMsg: "temporary failure" })
    expect(page.data.form.pickupLocation).toBe("")
    page.handleRetryServiceConfig()
    requests[1].success({ result: { ok: true, config: { serviceHubs: deleted ? [] : [savedHubs[0], { ...second, name: "第二网点新名称" }] } } })
    expect(page.data.form.pickupLocation).toBe(deleted ? "" : "第二网点新名称")
    page.onUnload()
  })

  test.each(["booking", "booking-detail"])("%s 活动配置请求失效立即撤销旧入口，预约加载状态可重试", (route) => {
    const requests = []
    global.wx = { cloud: { callFunction: jest.fn((request) => requests.push(request)) } }
    const page = createPage(route)
    page.data.serviceHubs = savedHubs
    if (route === "booking") { page.data.form.city = "上海"; page.loadOperationConfig() }
    else { page.applyBooking({ id: "b1", city: "上海", pickupLocation: savedHubs[0].name }); page.loadNotificationConfig() }
    require("../shared/operationConfigRequest").clearOperationConfigCache()
    expect(page.data.operationConfigFailed).toBe(true)
    expect(page.data.serviceHubs).toEqual([])
    if (route === "booking") {
      expect(page.data.operationConfigLoading).toBe(false)
      page.handleRetryServiceConfig()
      expect(requests).toHaveLength(2)
    } else expect(page.data.canNavigatePickup).toBe(false)
    requests[0].success({ result: { ok: true, config: { serviceHubs: savedHubs } } })
    expect(page.data.serviceHubs).toEqual([])
    page.onUnload()
  })

  test("断网时首次配置失败，网络恢复会重读服务配置", () => {
    let reconnect
    jest.doMock("../shared/networkStatus", () => ({ onNetworkReconnect: (callback) => { reconnect = callback; return jest.fn() } }))
    const requests = []
    global.getApp = () => ({ globalData: {} })
    global.wx = { cloud: { callFunction: jest.fn((request) => requests.push(request)) } }
    const page = createPage("booking")
    page.loadBookingCar = jest.fn()
    page.onLoad({ carId: "c1" })
    const configRequests = () => requests.filter((request) => request.name === "operationConfigGet")
    configRequests()[0].fail({ errMsg: "offline" })
    reconnect()
    expect(configRequests()).toHaveLength(2)
    configRequests()[1].success({ result: { ok: true, config: { cityOptions: ["上海"], serviceHubs: savedHubs } } })
    expect(page.data.serviceHubs).toHaveLength(2)
    page.onUnload()
    jest.dontMock("../shared/networkStatus")
  })

  test.each(["booking", "booking-detail"])("从其他页面返回时%s消费失效后的配置，保留已保存预约文字", (route) => {
    let request
    global.wx = { cloud: { callFunction: jest.fn((value) => { request = value }) } }
    const page = createPage(route)
    page.onShow()
    if (route === "booking") { page.data.form.city = "上海"; page.loadOperationConfig() }
    else { page.applyBooking({ id: "b1", city: "上海", pickupLocation: savedHubs[0].name }); page.loadNotificationConfig() }
    request.success({ result: { ok: true, config: { serviceHubs: savedHubs } } })
    require("../shared/operationConfigRequest").clearOperationConfigCache()
    page.onShow()
    request.success({ result: { ok: true, config: { serviceHubs: [] } } })
    expect(page.data.serviceHubs).toEqual([])
    if (route === "booking") expect(page.data.form.pickupLocation).toBe("")
    else {
      expect(page.data.booking.pickupLocation).toBe(savedHubs[0].name)
      expect(page.data.canNavigatePickup).toBe(false)
    }
    page.onUnload()
  })

  test("仅有城市且取车地点待确认时不导航，也不把新网点写入日程", () => {
    global.wx = { openLocation: jest.fn(), addPhoneCalendar: jest.fn(), showToast: jest.fn() }
    const page = createPage("booking-detail")
    page.data.serviceHubs = savedHubs
    page.applyBooking({ id: "b1", city: "上海", pickupLocation: "", location: "", startDate: "2099-10-01", endDate: "2099-10-02" })
    expect(page.data.canNavigatePickup).toBe(false)
    page.handleOpenLocation()
    page.handleAddToCalendar()
    expect(wx.openLocation).not.toHaveBeenCalled()
    expect(wx.addPhoneCalendar.mock.calls[0][0].location).toBe("上海 · 取车地点待确认")
    expect(page.data.pickupLocationDisplay).not.toContain(savedHubs[0].name)
  })

  test("管理详情保留历史location和还车地点，不用当前网点替换已保存字段", () => {
    const requests = []
    global.wx = { cloud: { callFunction: jest.fn((request) => requests.push(request)) } }
    const page = createPage("booking-manage-detail")
    page.data.id = "b1"
    page.loadDetail()
    requests[0].success({ result: { ok: true, detail: { id: "b1", city: "上海", location: "历史约定取车地址", pickupLocation: "", returnLocation: "异地约定还车地址" } } })
    expect(page.data.booking.location).toBe("历史约定取车地址")
    expect(page.data.booking.returnLocation).toBe("异地约定还车地址")
    const fs = require("fs")
    const path = require("path")
    const admin = fs.readFileSync(path.resolve(__dirname, "../pages/booking-manage-detail/booking-manage-detail.wxml"), "utf8")
    const customer = fs.readFileSync(path.resolve(__dirname, "../pages/booking-detail/booking-detail.wxml"), "utf8")
    expect(admin).toContain("booking.pickupLocation || booking.location")
    expect(admin).toContain("{{booking.returnLocation}}")
    expect(customer).toContain("{{booking.returnLocation}}")
    page.onUnload()
  })

  test.each(["杭州", "上海市"])("联系信息保存成功后刷新失败仍显示已保存城市及正确取车状态：%s", (city) => {
    const requests = []
    global.wx = { cloud: { callFunction: jest.fn((request) => requests.push(request)) }, setStorageSync: jest.fn(), showToast: jest.fn() }
    const page = createPage("booking-detail")
    page.data.id = "b1"
    page.data.serviceHubs = savedHubs
    page.applyBooking({ id: "b1", status: "pending", city: "上海", userName: "联系人", phone: "13800138000", pickupLocation: savedHubs[0].name, location: "历史地址", returnLocation: "异地还车地址" })
    page.data.editing = true
    page.data.editForm = { userName: "新联系人", phone: "13800138000", city, note: "保存备注" }
    page.handleSaveEdit()
    expect(requests[0].name).toBe("bookingUpdateMyContact")
    requests[0].success({ result: { ok: true, updated: true } })
    expect(requests[1].name).toBe("bookingMyDetail")
    requests[1].fail({ errMsg: "refresh failed" })
    expect(page.data.booking.city).toBe(city)
    expect(page.data.booking.userName).toBe("新联系人")
    expect(page.data.booking.returnLocation).toBe("异地还车地址")
    expect(page.data.booking.pickupLocation).toBe(city === "杭州" ? "" : savedHubs[0].name)
    expect(page.data.canNavigatePickup).toBe(city !== "杭州")
    expect(wx.setStorageSync.mock.calls.at(-1)[1].booking.city).toBe(city)
    page.onUnload()
  })

  test("无城市选项时手动输入城市会同步清除不属于新城市的网点", () => {
    global.wx = {}
    const page = createPage("booking")
    page.data.serviceHubs = savedHubs
    page.handleInput({ currentTarget: { dataset: { field: "city" } }, detail: { value: "上海" } })
    expect(page.data.form.pickupLocation).toBe(savedHubs[0].name)
    page.handleInput({ currentTarget: { dataset: { field: "city" } }, detail: { value: "杭州" } })
    expect(page.data.pickupHubs).toEqual([savedHubs[1]])
    expect(page.data.form.pickupLocation).toBe(savedHubs[1].name)
    page.handleInput({ currentTarget: { dataset: { field: "city" } }, detail: { value: "" } })
    expect(page.data.pickupHubs).toEqual([])
    expect(page.data.form.pickupLocation).toBe("")
  })

  test("未填写城市时前台阻止提交并给出明确提示", () => {
    global.wx = { cloud: { callFunction: jest.fn() }, showToast: jest.fn() }
    const page = createPage("booking")
    Object.assign(page.data, { carId: "c1", carName: "预约车辆", privacyAgreed: true })
    Object.assign(page.data.form, { userName: "联系人", phone: "13800138000", startDate: "2099-10-01", endDate: "2099-10-02", city: "" })
    page.handleSubmit()
    expect(wx.cloud.callFunction).not.toHaveBeenCalled()
    expect(wx.showToast).toHaveBeenCalledWith({ title: "请输入或选择取车城市", icon: "none" })
  })

  test.each(["booking", "booking-detail"])("缓存失效后配置读取失败会撤销 %s 旧配置操作入口", (route) => {
    let request
    global.wx = { cloud: { callFunction: jest.fn((options) => { request = options }) } }
    const page = createPage(route)
    const loadConfig = () => route === "booking" ? page.loadOperationConfig() : page.loadNotificationConfig()
    if (route === "booking") page.data.form.city = "上海"
    else page.applyBooking({ id: "b1", city: "上海", pickupLocation: savedHubs[0].name })
    loadConfig()
    request.success({ result: { ok: true, config: { cityOptions: ["上海"], serviceHubs: savedHubs, servicePhone: "400-321-7654", emergencyPhone: "400-123-4567" } } })
    expect(page.data.serviceHubs).toHaveLength(2)
    require("../shared/operationConfigRequest").clearOperationConfigCache()
    loadConfig()
    request.fail({ errMsg: "network failed" })
    expect(page.data.serviceHubs).toEqual([])
    if (route === "booking") {
      expect(page.data.pickupHubs).toEqual([])
      expect(page.data.form.pickupLocation).toBe("")
      Object.assign(page.data, { carId: "c1", carName: "预约车辆", privacyAgreed: true })
      Object.assign(page.data.form, { userName: "联系人", phone: "13800138000", startDate: "2099-10-01", endDate: "2099-10-02" })
      expect(page.validateForm()).toBe("")
    } else {
      expect(page.data.canNavigatePickup).toBe(false)
      expect(page.data.emergencyPhone).toBe("")
      expect(page.data.servicePhone).toBe("")
      expect(page.data.booking.pickupLocation).toBe(savedHubs[0].name)
    }
    page.onUnload()
  })

  test.each([true, false])("网点配置与车辆信息先后返回都正确选中真实网点：配置先返回 %s", (configFirst) => {
    let respond
    global.wx = { cloud: { callFunction: jest.fn(({ success }) => { respond = success }) }, setNavigationBarTitle: jest.fn() }
    const page = createPage("booking")
    page.loadOperationConfig()
    const config = { cityOptions: ["上海", "杭州", "北京"], serviceHubs: savedHubs }
    if (configFirst) respond({ result: { ok: true, config } })
    page.applyCar({ name: "已配置车辆", location: "上海" })
    if (!configFirst) respond({ result: { ok: true, config } })
    expect(page.data.form.pickupLocation).toBe(savedHubs[0].name)
    expect(page.data.pickupHubs).toEqual([savedHubs[0]])

    page.handleCityChange({ detail: { value: 1 } })
    expect(page.data.form.city).toBe("杭州")
    expect(page.data.form.pickupLocation).toBe(savedHubs[1].name)
    page.handleCityChange({ detail: { value: 2 } })
    expect(page.data.pickupHubs).toEqual([])
    expect(page.data.form.pickupLocation).toBe("")

    page.handleCityChange({ detail: { value: 0 } })
    require("../shared/operationConfigRequest").clearOperationConfigCache()
    page.loadOperationConfig()
    respond({ result: { ok: true, config: { cityOptions: ["上海"], serviceHubs: [] } } })
    expect(page.data.pickupHubs).toEqual([])
    expect(page.data.form.pickupLocation).toBe("")
    page.onUnload()
  })

  test.each([true, false])("详情与配置先后返回都只导航到订单保存网点：配置先返回 %s", (configFirst) => {
    let respond
    global.wx = { cloud: { callFunction: jest.fn(({ success }) => { respond = success }) }, openLocation: jest.fn(), showToast: jest.fn() }
    const page = createPage("booking-detail")
    page.loadNotificationConfig()
    const config = { serviceHubs: savedHubs, emergencyPhone: "400-123-4567" }
    if (configFirst) respond({ result: { ok: true, config } })
    page.applyBooking({ id: "b1", city: "上海", pickupLocation: savedHubs[0].name })
    if (!configFirst) respond({ result: { ok: true, config } })
    expect(page.data.canNavigatePickup).toBe(true)
    page.handleOpenLocation()
    expect(wx.openLocation).toHaveBeenCalledWith(expect.objectContaining({ name: savedHubs[0].name, address: savedHubs[0].address, latitude: 31.21, longitude: 121.41 }))

    require("../shared/operationConfigRequest").clearOperationConfigCache()
    page.loadNotificationConfig()
    respond({ result: { ok: true, config: { serviceHubs: [], emergencyPhone: "" } } })
    expect(page.data.canNavigatePickup).toBe(false)
    expect(page.data.emergencyPhone).toBe("")
    expect(page.data.booking.pickupLocation).toBe(savedHubs[0].name)
    expect(page.data.pickupLocationDisplay).toContain(savedHubs[0].name)
    page.handleOpenLocation()
    expect(wx.openLocation).toHaveBeenCalledTimes(1)
    page.onUnload()
  })

  test("历史约定地点未匹配或缺少坐标时保留文字并禁止伪造导航", () => {
    global.wx = { openLocation: jest.fn(), showToast: jest.fn() }
    const page = createPage("booking-detail")
    page.data.serviceHubs = savedHubs
    for (const booking of [
      { city: "上海", pickupLocation: "历史特别约定地点" },
      { city: "上海", location: "历史 location 地址" },
      { city: "杭州", pickupLocation: savedHubs[1].name },
      { city: "北京" }
    ]) {
      page.applyBooking(booking)
      expect(page.data.canNavigatePickup).toBe(false)
      expect(page.data.pickupLocationDisplay).toContain(booking.pickupLocation || booking.location || "取车地点待确认")
      page.handleOpenLocation()
    }
    expect(wx.openLocation).not.toHaveBeenCalled()
  })

  test("救援只拨独立救援电话，凭证只包含已保存客服电话", () => {
    global.wx = { makePhoneCall: jest.fn(), showToast: jest.fn(), setClipboardData: jest.fn() }
    const page = createPage("booking-detail")
    page.applyBooking({ id: "b1", location: "历史约定地点" })
    page.data.servicePhone = "400-321-7654"
    page.handleEmergencyCall()
    expect(wx.makePhoneCall).not.toHaveBeenCalled()
    page.data.emergencyPhone = "400-123-4567"
    page.handleEmergencyCall()
    expect(wx.makePhoneCall).toHaveBeenCalledWith(expect.objectContaining({ phoneNumber: "400-123-4567" }))
    page.handleCopyBookingId({ currentTarget: { dataset: { type: "voucher" } } })
    const voucher = wx.setClipboardData.mock.calls[0][0].data
    expect(voucher).toContain("历史约定地点")
    expect(voucher).toContain("客服专线：400-321-7654")
    expect(voucher).not.toContain("400-888-2826")
    page.data.servicePhone = ""
    page.handleCopyBookingId({ currentTarget: { dataset: { type: "voucher" } } })
    expect(wx.setClipboardData.mock.calls[1][0].data).not.toContain("客服专线")
  })

  test("页面切走后导航、日历、拨号失败不弹出提示；卸载取消迟到配置", () => {
    let respond
    global.wx = {
      cloud: { callFunction: jest.fn(({ success }) => { respond = success }) },
      makePhoneCall: jest.fn(), openLocation: jest.fn(), addPhoneCalendar: jest.fn(), showToast: jest.fn()
    }
    const page = createPage("booking-detail")
    global.getCurrentPages = () => [page]
    page.data.serviceHubs = savedHubs
    page.data.emergencyPhone = "400-123-4567"
    page.applyBooking({ id: "b1", city: "上海", pickupLocation: savedHubs[0].name, startDate: "2099-10-01", endDate: "2099-10-02" })
    page.handleOpenLocation()
    page.handleAddToCalendar()
    page.handleEmergencyCall()
    global.getCurrentPages = () => [{}]
    for (const method of [wx.openLocation, wx.addPhoneCalendar, wx.makePhoneCall]) method.mock.calls[0][0].fail({ errMsg: "network failed" })
    expect(wx.showToast).not.toHaveBeenCalled()
    page.loadNotificationConfig()
    page.onUnload()
    respond({ result: { ok: true, config: { serviceHubs: [], emergencyPhone: "" } } })
    expect(page.data.emergencyPhone).toBe("400-123-4567")
  })
})
