// Phase 9 note:
// 首页分类仍使用本地配置，不包含车辆业务数据。
// 后续如接入云数据库，可保持当前 id/name 结构不变，
// 让首页继续按相同字段完成分类高亮与筛选。
const categories = [
  {
    id: "luxury_sedan",
    name: "豪华轿车"
  },
  {
    id: "city_suv",
    name: "城市SUV"
  },
  {
    id: "offroad",
    name: "硬派越野"
  },
  {
    id: "supercar",
    name: "超级跑车"
  },
  {
    id: "commuter_ev",
    name: "代步电车"
  },
  {
    id: "pickup",
    name: "皮卡"
  }
]

module.exports = categories
