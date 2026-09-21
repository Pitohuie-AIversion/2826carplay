const EMERGENCY_HOTLINE = "400-888-2826"

const CATEGORY_NAMES = {
  supercar: "超级跑车",
  luxury_sedan: "豪华轿车",
  suv: "全地形豪华 SUV",
  sports: "运动轿跑",
  default: "尊享座驾"
}

const CATEGORY_TIPS_MAP = {
  supercar: {
    fuelNotice: "请务必加注 98# 优质汽油；油箱盖位于车身侧方，熄火解锁后轻按弹开",
    suspensionNotice: "通过地库坡道、减速带或坑洼路面时，请在中控台开启「前桥底盘升降」防剐蹭",
    drivingNotice: "大马力后置/中置驱动，雨雪湿滑路面请切至 WET/雨雪模式，公开道路切勿关闭车身稳定系统 (ESC)",
    parkingNotice: "P 挡驻车后确认电子手刹亮起；激烈驾驶后建议平缓巡航 2 分钟以保护双涡轮散热"
  },
  luxury_sedan: {
    fuelNotice: "建议加注 95# 或以上高标号清洁燃油",
    suspensionNotice: "配备多腔空气悬架，可在中控调节舒适/运动高度，地库减速慢行",
    drivingNotice: "轴距较长转弯半径较大，狭窄弯道与倒车时建议留意 360° 全景影像与盲区预警",
    parkingNotice: "配备电吸门系统，车门虚掩即可自动闭锁，无需用力摔关"
  },
  suv: {
    fuelNotice: "建议加注 95# 或以上燃油，油箱容积较大请留足续航余量",
    suspensionNotice: "离地间隙较高，非铺装路面可切换全地形越野模式，限高地库注意顶部距离",
    drivingNotice: "车身自重较大制动距离偏长，高速跟车请保持至少 3 秒安全车距",
    parkingNotice: "停车后注意后备箱开启高度，避免在低矮地下车库碰触车顶管道"
  }
}

const DEFAULT_TIPS = {
  fuelNotice: "请按油箱盖内侧标示加注对应标号燃油",
  suspensionNotice: "行经减速带及起伏路面请减速慢行",
  drivingNotice: "雨雪湿滑路面请谨慎驾驶并保持足够车距",
  parkingNotice: "离开车辆前请确认车窗全部关闭并锁好车门"
}

function getVehicleReadinessCard(vehicle) {
  const v = vehicle && typeof vehicle === "object" ? vehicle : {}
  const rawCat = String(v.category || v.vehicleType || "").trim().toLowerCase()
  const cat = CATEGORY_TIPS_MAP[rawCat] ? rawCat : (rawCat.includes("super") || rawCat.includes("sport") ? "supercar" : (rawCat.includes("suv") ? "suv" : (rawCat.includes("sedan") ? "luxury_sedan" : "default")))
  const tips = CATEGORY_TIPS_MAP[cat] || DEFAULT_TIPS

  return {
    category: cat,
    categoryName: CATEGORY_NAMES[cat] || CATEGORY_NAMES.default,
    vehicleName: String(v.name || v.brandModel || "极境座驾").trim(),
    fuelNotice: tips.fuelNotice,
    suspensionNotice: tips.suspensionNotice,
    drivingNotice: tips.drivingNotice,
    parkingNotice: tips.parkingNotice,
    emergencyHotline: EMERGENCY_HOTLINE
  }
}

module.exports = {
  EMERGENCY_HOTLINE,
  CATEGORY_NAMES,
  CATEGORY_TIPS_MAP,
  getVehicleReadinessCard
}
