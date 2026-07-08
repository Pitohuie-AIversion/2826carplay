// Phase 9 note:
// 当前分类数据来自本地 mock 文件。
// 后续如接入云数据库，可保持当前 id/name 结构不变，
// 让首页继续按相同字段完成分类高亮与筛选。
const categories = [
  {
    id: "mini_fun",
    name: "迷你乐趣"
  },
  {
    id: "luxury",
    name: "奢享旗舰"
  },
  {
    id: "performance",
    name: "性能闪电"
  },
  {
    id: "classic_fuel",
    name: "经典燃油"
  }
]

module.exports = categories
