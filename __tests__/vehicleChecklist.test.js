const {
  EMERGENCY_HOTLINE,
  CATEGORY_NAMES,
  getVehicleReadinessCard
} = require("../shared/vehicleChecklist")

describe("shared/vehicleChecklist 超跑与豪华座驾行车准备与安全小卡", () => {
  test("针对超级跑车输出 98# 燃油与底盘升降操作贴士", () => {
    const card = getVehicleReadinessCard({
      name: "保时捷 911 Carrera S",
      category: "supercar"
    })
    expect(card.category).toBe("supercar")
    expect(card.categoryName).toBe("超级跑车")
    expect(card.vehicleName).toBe("保时捷 911 Carrera S")
    expect(card.fuelNotice).toContain("98#")
    expect(card.suspensionNotice).toContain("底盘升降")
    expect(card.drivingNotice).toContain("ESC")
    expect(card.emergencyHotline).toBe(EMERGENCY_HOTLINE)
  })

  test("针对豪华轿车输出空气悬挂与长轴距盲区贴士", () => {
    const card = getVehicleReadinessCard({
      name: "保时捷 Panamera 4S",
      category: "luxury_sedan"
    })
    expect(card.category).toBe("luxury_sedan")
    expect(card.categoryName).toBe("豪华轿车")
    expect(card.fuelNotice).toContain("95#")
    expect(card.drivingNotice).toContain("360°")
    expect(card.parkingNotice).toContain("电吸门")
  })

  test("针对豪华 SUV 输出全地形与限高通过贴士", () => {
    const card = getVehicleReadinessCard({
      name: "保时捷 Cayenne Turbo GT",
      category: "suv"
    })
    expect(card.category).toBe("suv")
    expect(card.categoryName).toBe("全地形豪华 SUV")
    expect(card.suspensionNotice).toContain("全地形")
    expect(card.parkingNotice).toContain("后备箱")
  })

  test("缺失或未知车型提供安全通用提示且不抛错", () => {
    const emptyCard = getVehicleReadinessCard(null)
    expect(emptyCard.category).toBe("default")
    expect(emptyCard.categoryName).toBe(CATEGORY_NAMES.default)
    expect(emptyCard.fuelNotice).toBeTruthy()
    expect(emptyCard.emergencyHotline).toBe(EMERGENCY_HOTLINE)

    const unknownCard = getVehicleReadinessCard({ name: "未来概念座驾", category: "electric_hyper" })
    expect(unknownCard.category).toBe("default")
    expect(unknownCard.vehicleName).toBe("未来概念座驾")
  })
})
