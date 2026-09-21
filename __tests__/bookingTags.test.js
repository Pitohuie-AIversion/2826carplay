const {
  PRESET_CUSTOMER_TAGS,
  normalizeTags,
  hasMatchingTag,
  getTagStyle
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
})
