const {
  PRESET_CUSTOMER_TAGS,
  normalizeTags,
  hasMatchingTag,
  getTagStyle,
  deriveBookingDurationTags,
  autoTagBooking
} = require("../shared/bookingTags")

describe("bookingTags helper", () => {
  test("PRESET_CUSTOMER_TAGS 包含常用运营标签", () => {
    expect(PRESET_CUSTOMER_TAGS).toContain("老客户")
    expect(PRESET_CUSTOMER_TAGS).toContain("高意向")
    expect(PRESET_CUSTOMER_TAGS).toContain("需要送车")
    expect(PRESET_CUSTOMER_TAGS.length).toBeGreaterThanOrEqual(5)
  })

  test("normalizeTags 规范化处理标签数组或分隔字符串", () => {
    // 数组输入、去重与空格修剪
    expect(normalizeTags([" 老客户 ", "老客户", "高意向"])).toEqual(["老客户", "高意向"])

    // 字符串分隔输入
    expect(normalizeTags("老客户, 需要送车、长租意向")).toEqual(["老客户", "需要送车", "长租意向"])

    // 数量截断与过长标签过滤 (最多5个，单标签<=12字)
    const longList = ["T1", "T2", "T3", "T4", "T5", "T6", "超长超长超长超长超长超长超长标签"]
    const normalized = normalizeTags(longList)
    expect(normalized).toHaveLength(5)
    expect(normalized).toEqual(["T1", "T2", "T3", "T4", "T5"])

    // 异常输入
    expect(normalizeTags(null)).toEqual([])
    expect(normalizeTags(undefined)).toEqual([])
    expect(normalizeTags("")).toEqual([])
  })

  test("hasMatchingTag 正确匹配标签", () => {
    const booking = { tags: ["老客户", "需要送车"] }

    expect(hasMatchingTag(booking, "老客户")).toBe(true)
    expect(hasMatchingTag(booking, "需要送车")).toBe(true)
    expect(hasMatchingTag(booking, "高意向")).toBe(false)
    expect(hasMatchingTag(null, "老客户")).toBe(false)
  })

  test("getTagStyle 返回合理的视觉配色", () => {
    const goldStyle = getTagStyle("老客户")
    expect(goldStyle.text).toBe("#E8C88B")

    const defaultStyle = getTagStyle("自定义标签")
    expect(defaultStyle.text).toBe("#A6B5CC")
  })

  test("deriveBookingDurationTags 租期大于等于7天自动赋予长租意向标签", () => {
    // 7天行程 (2026-10-01 到 2026-10-07)
    expect(deriveBookingDurationTags("2026-10-01", "2026-10-07")).toEqual(["长租意向"])
    // 30天行程
    expect(deriveBookingDurationTags("2026-10-01", "2026-10-30")).toEqual(["长租意向"])
    // 6天行程 (不足7天)
    expect(deriveBookingDurationTags("2026-10-01", "2026-10-06")).toEqual([])
    // 1天单日
    expect(deriveBookingDurationTags("2026-10-01", "2026-10-01")).toEqual([])
    // 异常或空参数
    expect(deriveBookingDurationTags("", "")).toEqual([])
    expect(deriveBookingDurationTags(null, undefined)).toEqual([])
    expect(deriveBookingDurationTags("2026-10-05", "2026-10-01")).toEqual([])
  })

  test("autoTagBooking 自动合并现有标签与长租标签并去重", () => {
    const booking7Days = {
      startDate: "2026-10-01",
      endDate: "2026-10-07",
      tags: ["高意向"]
    }
    expect(autoTagBooking(booking7Days)).toEqual(["高意向", "长租意向"])

    // 已有长租意向时不重复添加
    const alreadyTagged = {
      startDate: "2026-10-01",
      endDate: "2026-10-10",
      tags: ["长租意向", "老客户"]
    }
    expect(autoTagBooking(alreadyTagged)).toEqual(["长租意向", "老客户"])

    // 短租不增加长租标签
    const shortBooking = {
      startDate: "2026-10-01",
      endDate: "2026-10-03",
      tags: ["需要送车"]
    }
    expect(autoTagBooking(shortBooking)).toEqual(["需要送车"])

    // 空对象防御
    expect(autoTagBooking(null)).toEqual([])
  })
})
