jest.mock("../shared/analytics", () => ({ trackEvent: jest.fn() }))

describe("customer phone callbacks after contact configuration changes", () => {
  const routes = [
    ["favorites", "handleCallConsultant"],
    ["car-detail", "handlePhoneCall"],
    ["mine", "handlePhoneCall"],
    ["content-page", "handlePhoneCall"],
    ["booking", "handleCallServicePhone"]
  ]

  afterEach(() => {
    delete global.Page
    delete global.wx
    delete global.getCurrentPages
  })

  test.each(routes)("%s only reports the number that is still configured after %s", (route, handler) => {
    jest.resetModules()
    let page
    global.Page = (definition) => {
      page = { ...definition, data: { ...definition.data } }
      page.setData = jest.fn((patch) => Object.assign(page.data, patch))
    }
    global.wx = {
      makePhoneCall: jest.fn(), showModal: jest.fn(), showToast: jest.fn(), setClipboardData: jest.fn()
    }
    require(`../pages/${route}/${route}`)
    global.getCurrentPages = () => [page]
    page.data.compareCars = [{ id: "a", name: "A" }, { id: "b", name: "B" }]

    for (const updatedPhone of ["", "18800002222", " 18800001111 "]) {
      page.data.servicePhone = "18800001111"
      page[handler]()
      expect(wx.makePhoneCall).toHaveBeenLastCalledWith(expect.objectContaining({ phoneNumber: "18800001111" }))
      const request = wx.makePhoneCall.mock.calls[wx.makePhoneCall.mock.calls.length - 1][0]
      page.data.servicePhone = updatedPhone
      wx.showModal.mockClear()
      request.fail({ errMsg: "makePhoneCall:fail unavailable" })
      if (updatedPhone.trim() === "18800001111") {
        expect(wx.showModal).toHaveBeenCalledTimes(1)
        expect(wx.showModal.mock.calls[0][0].content).toContain("18800001111")
      } else {
        expect(wx.showModal).not.toHaveBeenCalled()
      }
    }
  })
})
