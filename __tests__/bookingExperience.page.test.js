const fs = require("fs")
const path = require("path")

function loadPageDefinition() {
  jest.resetModules()
  let definition = null
  global.Page = jest.fn((input) => {
    definition = input
  })
  require("../pages/booking/booking")
  return definition
}

function createPage(definition) {
  const page = {
    ...definition,
    data: {
      ...definition.data,
      form: { ...definition.data.form }
    }
  }
  page.setData = jest.fn((patch, done) => {
    Object.keys(patch).forEach((key) => {
      if (key.startsWith("form.")) {
        page.data.form[key.slice(5)] = patch[key]
      } else {
        page.data[key] = patch[key]
      }
    })
    if (typeof done === "function") {
      done()
    }
  })
  return page
}

describe("预约表单人性化体验", () => {
  afterEach(() => {
    delete global.Page
    delete global.wx
  })

  test("城市列表加载后不再静默选择第一个城市", () => {
    global.wx = {}
    const page = createPage(loadPageDefinition())
    page.data.cityOptions = ["杭州", "上海"]

    page.syncCitySelection()

    expect(page.data.form.city).toBe("")
    expect(page.data.cityIndex).toBe(-1)
    expect(page.data.pickerCityIndex).toBe(0)
  })

  test("上次联系人仅在用户主动点击后填入", () => {
    global.wx = {
      getStorageSync: jest.fn(() => ({ userName: "张先生", phone: "13800138000" })),
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition())

    page.loadSavedContact()
    expect(page.data.savedContactAvailable).toBe(true)
    expect(page.data.form.userName).toBe("")
    expect(page.data.form.phone).toBe("")

    page.handleUseSavedContact()
    expect(page.data.form.userName).toBe("张先生")
    expect(page.data.form.phone).toBe("13800138000")
    expect(page.data.formProgress.phoneComplete).toBe(true)
  })

  test("常用日期快捷按钮可安排三天行程并提供即时手机号提示", () => {
    global.wx = {}
    const page = createPage(loadPageDefinition())
    page.data.today = "2026-08-05"

    page.handleDateShortcut({ currentTarget: { dataset: { action: "three-days" } } })

    expect(page.data.form.startDate).toBe("2026-08-05")
    expect(page.data.form.endDate).toBe("2026-08-08")
    const wxml = fs.readFileSync(path.resolve(__dirname, "../pages/booking/booking.wxml"), "utf8")
    expect(wxml).toContain("field-inline-error")
    expect(wxml).toContain('data-action="three-days"')
    expect(wxml).toContain("使用上次联系人")
  })
})
