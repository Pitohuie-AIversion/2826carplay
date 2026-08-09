const fs = require("fs")
const path = require("path")

const PROJECT_ROOT = path.resolve(__dirname, "..")

function read(relativePath) {
  return fs.readFileSync(path.join(PROJECT_ROOT, relativePath), "utf8")
}

describe("页面异步生命周期覆盖", () => {
  test("发起云端异步任务的页面均声明离页清理入口", () => {
    const appConfig = JSON.parse(read("app.json"))
    const asyncPages = []
    const missingUnload = []

    appConfig.pages.forEach((route) => {
      const source = read(`${route}.js`)
      const usesCloudTask =
        /wx\.cloud\.(?:callFunction|uploadFile|deleteFile)\s*\(/.test(source) ||
        /requestOperationConfig\s*\(/.test(source)
      if (!usesCloudTask) {
        return
      }
      asyncPages.push(route)
      if (!/\bonUnload\s*\(\)\s*\{/.test(source)) {
        missingUnload.push(route)
      }
    })

    expect(asyncPages.length).toBeGreaterThanOrEqual(20)
    expect(missingUnload).toEqual([])
  })

  test("列表搜索清空后的渲染回调会校验当前请求序号", () => {
    const guardedPages = [
      ["pages/vehicle-manage/vehicle-manage.js", "_vehicleListRequestId", 1],
      ["pages/booking-manage/booking-manage.js", "_bookingListRequestId", 1],
      ["pages/audit-log-manage/audit-log-manage.js", "_auditListRequestId", 2],
      ["pages/error-log-manage/error-log-manage.js", "_errorListRequestId", 2],
      ["pages/privacy-request-manage/privacy-request-manage.js", "_privacyManageListRequestId", 2]
    ]

    guardedPages.forEach(([relativePath, requestField, minimumCount]) => {
      const source = read(relativePath)
      const declaration = `const listRequestId = Number(this.${requestField} || 0)`
      expect(source.split(declaration).length - 1).toBeGreaterThanOrEqual(minimumCount)
      expect(source).toContain(`listRequestId !== Number(this.${requestField} || 0)`)
    })
  })

  test("页面实例上的超时句柄均提供离页入口与对应清理", () => {
    const appConfig = JSON.parse(read("app.json"))
    let timerCount = 0

    appConfig.pages.forEach((route) => {
      const source = read(`${route}.js`)
      const timerFields = new Set(
        Array.from(source.matchAll(/this\.(_[A-Za-z0-9]+Timer)\s*=\s*setTimeout\s*\(/g))
          .map((match) => match[1])
      )
      if (!timerFields.size) {
        return
      }

      expect(source).toMatch(/\bonUnload\s*\(\)\s*\{/)
      timerFields.forEach((field) => {
        timerCount += 1
        expect(source).toContain(`clearTimeout(this.${field})`)
      })
    })

    expect(timerCount).toBeGreaterThanOrEqual(55)
  })

  test("详情页一次性事件通道在离页时解绑并拒绝迟到数据", () => {
    const cases = [
      [
        "pages/booking-detail/booking-detail.js",
        "acceptBookingDetail",
        "_bookingDetailUnloaded"
      ],
      [
        "pages/booking-manage-detail/booking-manage-detail.js",
        "acceptManageBookingDetail",
        "isPageNativeActionActive(this, eventAction)"
      ]
    ]

    cases.forEach(([relativePath, eventName, lifecycleGuard]) => {
      const source = read(relativePath)
      expect(source).toContain(`eventChannel.on("${eventName}"`)
      expect(source).toContain(`.off(\n        "${eventName}"`)
      expect(source).toContain(lifecycleGuard)
    })
  })

  test("恢复刷新与进行中的写操作保持互斥", () => {
    const expectations = [
      ["pages/vehicle-manage/vehicle-manage.js", "this.data.updatingId", "this.data.deletingId"],
      ["pages/bookings/bookings.js", "this._bookingCancelTimer", "this.data.loading"],
      ["pages/booking-workbench/booking-workbench.js", "this.isWorkbenchWriteBusy()", "this.data.refreshing"],
      ["pages/booking-detail/booking-detail.js", "this.data.editing", "this.data.saving"],
      ["pages/mine/mine.js", "this._mineToolActive", "this.data.summaryLoading"]
    ]

    expectations.forEach(([relativePath, firstGuard, secondGuard]) => {
      const source = read(relativePath)
      expect(source).toContain(firstGuard)
      expect(source).toContain(secondGuard)
    })
  })

  test("列表读取与重试入口声明忙碌态保护", () => {
    const expectations = [
      ["pages/vehicle-manage/vehicle-manage.js", "isVehicleMutationBusy()"],
      ["pages/booking-manage/booking-manage.js", "if (this.data.loading)"],
      ["pages/role-manage/role-manage.js", "this.data.saving"],
      ["pages/analytics-manage/analytics-manage.js", "this.data.cleanupLoading"],
      ["pages/favorites/favorites.js", "this.data.removingId"],
      ["pages/privacy-request/privacy-request.js", "this.data.submitting"],
      ["pages/config-manage/config-manage.js", "this.data.isDirty"],
      ["pages/booking-detail/booking-detail.js", "this.data.editing"],
      ["pages/booking-manage-detail/booking-manage-detail.js", "this._bookingDetailMutationActive"]
    ]

    expectations.forEach(([relativePath, guard]) => {
      expect(read(relativePath)).toContain(guard)
    })
  })
})
