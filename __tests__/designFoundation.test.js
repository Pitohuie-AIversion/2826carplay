const fs = require("fs")
const path = require("path")

describe("全局交互视觉基础", () => {
  test("按钮、筛选胶囊和输入框具备统一反馈", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "../app.wxss"), "utf8")

    expect(source).toMatch(/button\s*\{[^}]*transition:/s)
    expect(source).toMatch(/button::after\s*\{[^}]*border:\s*0/s)
    expect(source).toMatch(/button\[disabled\]\s*\{[^}]*transform:\s*none/s)
    expect(source).toMatch(/\.ui-pill\s*\{[^}]*transition:/s)
    expect(source).toMatch(/\.ui-pill-pressed,\s*\.ui-pill:active\s*\{/s)
    expect(source).toMatch(/\.ui-pill:active\s*\{[^}]*transform:\s*scale\(0\.98\)/s)
    expect(source).toMatch(/\.ui-scroll-cue\s*\{[^}]*linear-gradient/s)
    expect(source).toMatch(/\.ui-scroll-cue::after\s*\{[^}]*rotate\(45deg\)/s)
    expect(source).toMatch(/\.ui-input:focus\s*\{[^}]*box-shadow:/s)
    expect(source).toMatch(/page\s*\{[^}]*font-variant-numeric:\s*tabular-nums/s)
    expect(source).toMatch(/page\s*\{[^}]*font-feature-settings:\s*"tnum"\s+1/s)
    expect(source).toMatch(/input,\s*textarea\s*\{[^}]*caret-color:\s*#6e9fea/s)
  })

  test("四个核心页面正文同时适配左右与底部安全区", () => {
    const pageStyles = [
      "../pages/garage/garage.wxss",
      "../pages/bookings/bookings.wxss",
      "../pages/favorites/favorites.wxss",
      "../pages/mine/mine.wxss"
    ]

    pageStyles.forEach((relativePath) => {
      const source = fs.readFileSync(path.resolve(__dirname, relativePath), "utf8")

      expect(source).toContain("calc(24rpx + env(safe-area-inset-right))")
      expect(source).toContain("calc(24rpx + env(safe-area-inset-left))")
      expect(source).toContain("calc(220rpx + env(safe-area-inset-bottom))")
    })
  })

  test("管理端页面和共享车辆表单统一适配全面屏安全区", () => {
    const managementStyles = [
      "../shared/management-shell.wxss",
      "../shared/vehicle-form.wxss",
      "../pages/audit-log-manage/audit-log-manage.wxss",
      "../pages/analytics-manage/analytics-manage.wxss",
      "../pages/booking-workbench/booking-workbench.wxss",
      "../pages/config-manage/config-manage.wxss",
      "../pages/vehicle-manage/vehicle-manage.wxss",
      "../pages/privacy-data-inventory/privacy-data-inventory.wxss",
      "../pages/operations-overview/operations-overview.wxss",
      "../pages/role-manage/role-manage.wxss",
      "../pages/vehicle-detail-manage/vehicle-detail-manage.wxss",
      "../pages/error-log-manage/error-log-manage.wxss",
      "../pages/booking-manage-detail/booking-manage-detail.wxss",
      "../pages/privacy-request-manage/privacy-request-manage.wxss",
      "../pages/booking-calendar/booking-calendar.wxss",
      "../pages/system-health/system-health.wxss",
      "../pages/booking-manage/booking-manage.wxss"
    ]

    managementStyles.forEach((relativePath) => {
      const source = fs.readFileSync(path.resolve(__dirname, relativePath), "utf8")

      expect(source).toContain("calc(24rpx + env(safe-area-inset-right))")
      expect(source).toContain("calc(24rpx + env(safe-area-inset-left))")
      expect(source).toContain("env(safe-area-inset-bottom)")
    })
  })
})
