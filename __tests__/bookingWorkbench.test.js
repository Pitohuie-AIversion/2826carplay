const {
  OVERDUE_MS,
  normalizeBooking,
  buildBookingWorkbench
} = require("../shared/bookingWorkbench")

describe("shared/bookingWorkbench", () => {
  const now = new Date("2026-08-10T12:00:00.000Z").getTime()

  test("汇总优先、候补、协调中和超时待办并按紧急程度排序", () => {
    const view = buildBookingWorkbench(
      [
        {
          id: "priority",
          status: "pending",
          schedulePriority: "priority",
          coordinationStatus: "pending",
          createdAt: new Date(now - 2 * 60 * 60 * 1000).toISOString()
        },
        {
          id: "overdue",
          status: "pending",
          schedulePriority: "normal",
          coordinationStatus: "pending",
          createdAt: new Date(now - 25 * 60 * 60 * 1000).toISOString()
        },
        {
          id: "standby",
          status: "contacted",
          schedulePriority: "standby",
          coordinationStatus: "coordinating",
          createdAt: new Date(now - 5 * 60 * 60 * 1000).toISOString()
        },
        {
          id: "resolved",
          status: "contacted",
          coordinationStatus: "resolved",
          createdAt: new Date(now - 50 * 60 * 60 * 1000).toISOString()
        },
        {
          id: "completed",
          status: "completed",
          schedulePriority: "priority",
          coordinationStatus: "pending",
          createdAt: new Date(now - 50 * 60 * 60 * 1000).toISOString()
        }
      ],
      "todo",
      now
    )

    expect(view.summary).toEqual({
      todo: 3,
      pending: 2,
      priority: 1,
      overdue: 1,
      standby: 1,
      coordinating: 1
    })
    expect(view.queue.map((item) => item.id)).toEqual([
      "overdue",
      "priority",
      "standby"
    ])
    expect(view.queue[0].badges.map((item) => item.key)).toContain("overdue")
  })

  test("不同工作台筛选只返回对应待办", () => {
    const list = [
      {
        id: "priority",
        status: "pending",
        schedulePriority: "priority",
        coordinationStatus: "pending",
        createdAt: new Date(now - OVERDUE_MS - 1).toISOString()
      },
      {
        id: "standby",
        status: "contacted",
        schedulePriority: "standby",
        coordinationStatus: "coordinating",
        createdAt: new Date(now - 1000).toISOString()
      }
    ]

    expect(buildBookingWorkbench(list, "priority", now).queue.map((item) => item.id)).toEqual(["priority"])
    expect(buildBookingWorkbench(list, "pending", now).queue.map((item) => item.id)).toEqual(["priority"])
    expect(buildBookingWorkbench(list, "overdue", now).queue.map((item) => item.id)).toEqual(["priority"])
    expect(buildBookingWorkbench(list, "standby", now).queue.map((item) => item.id)).toEqual(["standby"])
    expect(buildBookingWorkbench(list, "coordinating", now).queue.map((item) => item.id)).toEqual(["standby"])
  })

  test("历史预约缺少字段时按常规、待协调处理，24 小时整视为超时", () => {
    const item = normalizeBooking(
      {
        id: "legacy",
        status: "pending",
        createdAt: new Date(now - OVERDUE_MS).toISOString()
      },
      now
    )

    expect(item.schedulePriority).toBe("normal")
    expect(item.coordinationStatus).toBe("pending")
    expect(item.overdue).toBe(true)
    expect(item.waitingText).toBe("已等待 1 天")
  })
})
