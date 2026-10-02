const fs = require("fs")
const path = require("path")
const { normalizeServiceConfig, validateServiceConfig, isCustomerServiceUrl, isCustomerServiceCorpId, validateCityOptions } = require("../shared/serviceConfig")

const hub = { id: "west_store", city: "杭州", name: "西湖店", address: "真实地址", feeText: "", type: "store", latitude: "", longitude: "" }

test("服务配置部署副本与前台校验使用相同契约", () => {
  const source = fs.readFileSync(path.join(__dirname, "../shared/serviceConfig.js"), "utf8")
  for (const name of ["operationConfigGet", "operationConfigUpdate"]) {
    expect(fs.readFileSync(path.join(__dirname, `../cloudfunctions/${name}/serviceConfig.js`), "utf8")).toBe(source)
  }
})

test.each([
  [{ ...hub }, { ...hub }],
  [{ ...hub }, { ...hub, id: "different_id" }],
  [{ ...hub, address: "" }],
  [{ ...hub, type: "invalid" }],
  [{ ...hub, latitude: "91", longitude: "180" }],
  [{ ...hub, latitude: "30", longitude: "181" }],
  [{ ...hub, latitude: "30", longitude: "" }],
  [{ ...hub, latitude: "NaN", longitude: "120" }],
  [{ ...hub, latitude: [], longitude: [] }]
])("拒绝重复、缺少必要地址或无效坐标的网点 %j", (...serviceHubs) => {
  expect(validateServiceConfig({ serviceHubs })).toMatchObject({ field: "serviceHubs" })
})

test("可选服务配置清空、空坐标和零坐标保留各自语义", () => {
  expect(normalizeServiceConfig({})).toEqual({ serviceHoursText: "", emergencyPhone: "", wxKfCorpId: "", wxKfExtInfo: "", serviceHubs: [] })
  const input = { emergencyPhone: "  ", serviceHubs: [hub, { ...hub, id: "zero", name: "零坐标网点", latitude: "0", longitude: 0 }] }
  expect(validateServiceConfig(input)).toBeNull()
  expect(normalizeServiceConfig(input).serviceHubs).toEqual([
    { ...hub, latitude: null, longitude: null },
    { ...hub, id: "zero", name: "零坐标网点", latitude: 0, longitude: 0 }
  ])
})

test.each(["Base64EncodedValue", "http://work.weixin.qq.com/kfid/test-link", "https://", "https://work.weixin.qq.com/invalid space", "https://invalid..host/path", "https://host:99999/path"])("拒绝无效的微信客服 HTTPS 链接 %s", (wxKfExtInfo) => {
  expect(isCustomerServiceUrl(wxKfExtInfo)).toBe(false)
  expect(validateServiceConfig({ wxKfCorpId: "ww123456", wxKfExtInfo })).toMatchObject({ field: "wxKfExtInfo" })
})

test("客服 HTTPS 链接与企业 ID 可成对保存或同时清空", () => {
  const wxKfExtInfo = "https://work.weixin.qq.com/kfid/test-link?scene=mini"
  expect(isCustomerServiceUrl(wxKfExtInfo)).toBe(true)
  expect(validateServiceConfig({ wxKfCorpId: "ww123456", wxKfExtInfo })).toBeNull()
  expect(validateServiceConfig({ wxKfCorpId: "", wxKfExtInfo: "" })).toBeNull()
  expect(validateServiceConfig({ wxKfCorpId: "ww123456", wxKfExtInfo: "" })).toMatchObject({ field: "wxKfCorpId" })
})

test("城市数量在去重后校验，20项和空列表可保存，单项超长不能截断", () => {
  const cities = Array.from({ length: 20 }, (_, index) => `城市${index}`)
  expect(validateCityOptions(cities)).toBeNull()
  expect(validateCityOptions([...cities, "城市0"])).toBeNull()
  expect(validateCityOptions([])).toBeNull()
  expect(validateCityOptions([...cities, "额外城市"])).toMatchObject({ field: "cityOptions" })
  expect(validateCityOptions(["城".repeat(21)])).toMatchObject({ field: "cityOptions" })
  expect(validateCityOptions([123])).toMatchObject({ field: "cityOptions" })
  expect(isCustomerServiceCorpId("ww123456")).toBe(true)
  expect(isCustomerServiceCorpId("bad")).toBe(false)
})
