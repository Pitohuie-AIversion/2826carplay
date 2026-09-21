const h = (id, name, type, address, feeText = "免接送服务费") => ({ id, name, type, address, feeText })

const CITY_HUBS_MAP = {
  "上海": [
    h("sh-hq", "虹桥国际机场 / 高铁枢纽", "hub", "虹桥综合交通枢纽地下贵宾停靠区"),
    h("sh-pd", "浦东国际机场", "hub", "浦东国际机场 T1/T2 贵宾车位"),
    h("sh-wt", "外滩新天地旗舰自提点", "store", "黄浦区湖滨路 222 号极境车库展厅", "自提免服务费"),
    h("sh-door", "市区尊享送车上门", "delivery", "上海中环内指定五星级酒店/私人住宅", "专人送达")
  ],
  "北京": [
    h("bj-sd", "首都国际机场 T2/T3", "hub", "首都国际机场停车楼 VIP 接驳区"),
    h("bj-dx", "大兴国际机场", "hub", "大兴机场停车楼 1 层商务车位"),
    h("bj-gm", "国贸三里屯旗舰自提点", "store", "朝阳区建国门外大街 1 号极境空间", "自提免服务费"),
    h("bj-door", "市区尊享送车上门", "delivery", "北京五环内指定地点", "专人送达")
  ],
  "杭州": [
    h("hz-xs", "萧山国际机场", "hub", "萧山机场贵宾停车场区域"),
    h("hz-east", "杭州东站高铁枢纽", "hub", "东广场地下停车专区"),
    h("hz-xh", "西湖湖滨旗舰自提点", "store", "上城区平海路 124 号湖滨极境中心", "自提免服务费"),
    h("hz-door", "市区尊享送车上门", "delivery", "杭州核心主城区专人送达", "专人送达")
  ],
  "深圳": [
    h("sz-ba", "宝安国际机场 T3", "hub", "宝安机场地面交通中心贵宾区"),
    h("sz-north", "深圳北站高铁枢纽", "hub", "深圳北站西广场 VIP 停车位"),
    h("sz-bay", "深圳湾科技园自提点", "store", "南山区科苑南路深圳湾 1 号尊享专区", "自提免服务费"),
    h("sz-door", "市区尊享送车上门", "delivery", "深圳南山/福田/罗湖指定地点", "专人送达")
  ],
  "广州": [
    h("gz-by", "白云国际机场 T1/T2", "hub", "白云机场 P1/P4 停车楼接驳区"),
    h("gz-south", "广州南站高铁枢纽", "hub", "广州南站地下快速接客区"),
    h("gz-zhujiang", "珠江新城旗舰自提点", "store", "天河区珠江东路 6 号极境车库", "自提免服务费"),
    h("gz-door", "市区尊享送车上门", "delivery", "广州天河/越秀/海珠指定地点", "专人送达")
  ]
}

const DEFAULT_FALLBACK_HUBS = [
  h("gen-store", "城市旗舰中心自提", "store", "极境车库城市服务中心", "自提免服务费"),
  h("gen-hub", "核心交通枢纽接送", "hub", "当地主要机场或高铁枢纽", "免费接送"),
  h("gen-door", "市区指定送车上门", "delivery", "指定星级酒店或商务办公区", "专人送达")
]

function getCityHubs(city) {
  const c = String(city || "").trim()
  if (CITY_HUBS_MAP[c]) {
    return [...CITY_HUBS_MAP[c]]
  }
  const match = Object.keys(CITY_HUBS_MAP).find((k) => c.includes(k))
  if (match) {
    return [...CITY_HUBS_MAP[match]]
  }
  return [...DEFAULT_FALLBACK_HUBS]
}

function getDefaultHub(city) {
  const hubs = getCityHubs(city)
  return hubs[0] || DEFAULT_FALLBACK_HUBS[0]
}

function formatLocationDisplay(location, city = "") {
  const loc = String(location || "").trim()
  if (!loc) return city ? `${city} · 门店自提` : "门店自提"
  if (city && !loc.startsWith(city)) {
    return `${city} · ${loc}`
  }
  return loc
}

function normalizeBookingLocation(val, city = "") {
  const str = String(val || "").trim()
  if (!str) {
    const def = getDefaultHub(city)
    return def ? def.name : "旗舰自提点"
  }
  return str.slice(0, 60)
}

module.exports = {
  CITY_HUBS_MAP,
  DEFAULT_FALLBACK_HUBS,
  getCityHubs,
  getDefaultHub,
  formatLocationDisplay,
  normalizeBookingLocation
}
