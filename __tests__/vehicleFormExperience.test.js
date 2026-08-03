const fs = require("fs")
const path = require("path")

const { buildVehicleFormProgress } = require("../shared/vehicleFormProgress")

describe("车辆新增与编辑表单体验", () => {
  test("必填完成度按统一的五项车辆身份字段计算", () => {
    expect(buildVehicleFormProgress({})).toEqual({
      completed: 0,
      total: 5,
      percent: 0,
      ready: false,
      plateNumberComplete: false,
      vehicleTypeComplete: false,
      brandModelComplete: false,
      registerDateComplete: false,
      statusComplete: false,
      nextField: "plateNumber",
      hint: "下一项：填写车牌号"
    })

    expect(buildVehicleFormProgress({
      plateNumber: "浙A12345",
      vehicleType: "sedan",
      brandModel: "BMW 740Li"
    })).toMatchObject({
      completed: 3,
      percent: 60,
      ready: false,
      nextField: "registerDate",
      hint: "下一项：填写注册日期"
    })
  })

  test("五项必填资料完整后显示可提交状态", () => {
    expect(buildVehicleFormProgress({
      plateNumber: "浙A12345",
      vehicleType: "sedan",
      brandModel: "BMW 740Li",
      registerDate: "2026-01-01",
      status: "active"
    })).toEqual({
      completed: 5,
      total: 5,
      percent: 100,
      ready: true,
      plateNumberComplete: true,
      vehicleTypeComplete: true,
      brandModelComplete: true,
      registerDateComplete: true,
      statusComplete: true,
      nextField: "",
      hint: "必填信息已完整，可以提交"
    })
  })

  test("新增和编辑页共享进度、分组图标及吸底提交栏", () => {
    const createSource = fs.readFileSync(
      path.resolve(__dirname, "../pages/vehicle-create/vehicle-create.wxml"),
      "utf8"
    )
    const editSource = fs.readFileSync(
      path.resolve(__dirname, "../pages/vehicle-edit/vehicle-edit.wxml"),
      "utf8"
    )
    const detailSource = fs.readFileSync(
      path.resolve(__dirname, "../pages/vehicle-detail-manage/vehicle-detail-manage.wxml"),
      "utf8"
    )
    const styleSource = fs.readFileSync(
      path.resolve(__dirname, "../shared/vehicle-form.wxss"),
      "utf8"
    )

    ;[createSource, editSource].forEach((source) => {
      expect(source).toContain("vehicle-form-progress")
      expect(source).toContain("vehicle-section-glyph-identity")
      expect(source).toContain("vehicle-section-glyph-rental")
      expect(source).toContain("vehicle-section-glyph-archive")
      expect(source).toContain("vehicle-submit-dock")
      expect(source).not.toContain(">✓<")
      expect(source).toContain('hover-class="vehicle-picker-pressed"')
      expect(source).toContain("vehicle-form-control-complete")
      expect((source.match(/aria-required="\{\{true\}\}"/g) || []).length).toBeGreaterThanOrEqual(5)
    })
    expect(styleSource).toMatch(/\.vehicle-form-page \.vehicle-submit-dock\s*\{[\s\S]*?position:\s*sticky/)
    expect(styleSource).toContain(".vehicle-form-progress-ready")
    expect(styleSource).toContain(".vehicle-form-control-complete")
    expect(createSource).toContain("vehicle-create-native-icon")
    expect(editSource).toContain("vehicle-retry-native-icon")
    expect(editSource).toContain("vehicle-back-native-icon")
    expect(editSource).toContain("vehicle-image-native-icon")
    expect(editSource).toContain("vehicle-save-native-icon")
    expect(detailSource).toContain("vehicle-detail-empty-button ui-btn ui-btn-primary")
    expect(detailSource).toContain("<view class=\"back-native-icon\"")
    expect(styleSource).toContain(".vehicle-form-action-content")
    expect(styleSource).toContain(".vehicle-retry-native-icon")
    expect(editSource).toContain('hover-class="vehicle-form-state-button-pressed"')
    expect(styleSource).toContain(".vehicle-form-state-button-pressed")
    expect(styleSource).toMatch(/\.vehicle-form-page \.form-input:focus,[\s\S]*?box-shadow:/)
    expect(styleSource).toContain(".vehicle-form-page .vehicle-picker-pressed")
  })
})
