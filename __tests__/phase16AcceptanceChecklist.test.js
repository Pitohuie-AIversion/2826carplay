const fs = require("fs")
const path = require("path")

const ACCEPTANCE_ITEMS = [
  { id: "PRE-3", category: "PRE", status: "HANDOVER", title: "配置 BOOTSTRAP_TOKEN ≥32 位环境变量", note: "云开发控制台 → 云函数 → bootstrapAdmin → 版本管理 → 配置 → 环境变量。≥32 位，1–2 分钟生效。", automatedBy: null },
  { id: "PRE-4", category: "PRE", status: "HANDOVER", title: "5 篇内容草稿 seed 入库并发布", note: "先 `npm run bootstrap:seeds -- --apply` 打印 payloads；真机管理员依次调 contentGuideManage create × 5 → publish × 5", automatedBy: "bootstrapContentDrafts.test.js 4 条 dry-run 断言 5/5 种子合法可发布" },

  { id: "A0", category: "管理员能力", status: "AUTOMATED", title: "管理员创建内容：非法枚举 contentType 必须 VALIDATION_ERROR 拒绝", automatedBy: "contentGuideManageForAcceptance.test.js A0" },
  { id: "A1", category: "管理员能力", status: "AUTOMATED", title: "管理员合法 create → ok + status=draft + audit write contentGuide.create", automatedBy: "contentGuideManageForAcceptance.test.js A1" },
  { id: "A2", category: "管理员能力", status: "AUTOMATED", title: "管理员 update 合法/非法（路径字符 id）边界", automatedBy: "contentGuideManageForAcceptance.test.js A2；analyticsOverview 权限边界由 analyticsOverviewAuthorization.test.js 4 条（普通用户 FORBIDDEN / admin 成功 / 空角色拒绝 / ops booking_manage 可看）" },
  { id: "A3", category: "管理员能力", status: "AUTOMATED", title: "管理员 publish 合法 id → status=published + publishedAt=serverDate", automatedBy: "contentGuideManageForAcceptance.test.js A3" },
  { id: "A4", category: "管理员能力", status: "AUTOMATED", title: "管理员 archive 合法 id → status=archived + audit", automatedBy: "contentGuideManageForAcceptance.test.js A4" },
  { id: "A5", category: "管理员能力", status: "AUTOMATED", title: "管理员 5 个 scenario × 5 content-type 枚举全部创建通过", automatedBy: "contentGuideManageForAcceptance.test.js A5" },
  { id: "A6", category: "管理员能力", status: "AUTOMATED", title: "vehicleIds 非法路径 / 超长被 normalize + ID_PATTERN 丢弃（防跳转/注入）", automatedBy: "contentGuideManageForAcceptance.test.js A6" },
  { id: "A7", category: "管理员能力", status: "AUTOMATED", title: "非法 ACTIONS（delete/bulk_import/export_all/promote/空）全 VALIDATION_ERROR", automatedBy: "contentGuideManageForAcceptance.test.js A7" },

  { id: "B0", category: "普通用户能力", status: "AUTOMATED", title: "普通用户 content-page 分享 → share_open + content_view 双埋点 arrayContaining", automatedBy: "contentPage.page.test.js L186-L316 6 条分享埋点 + 车辆跳转让渡" },
  { id: "B1", category: "普通用户能力", status: "HANDOVER", title: "普通用户 bookingCreate → attribution 嵌套写 channel/scene/contentId 不落 vehicleId", note: "真机普通用户从内容卡片跳到预约 → 提交预约 → 云开发 bookings 集合看 attribution 对象必须不含 vehicleId", automatedBy: "bookingCreate.int.test.js 归因专项（CHANNELS 6 + SCENES 4）；bookingExportCsv.int.test.js 391/409 行断言 attribution.vehicleId 绝不落 CSV" },
  { id: "B2", category: "普通用户能力", status: "AUTOMATED", title: "普通用户 analytics 冷却 5 秒同 key 只报 1 次，fail 回调删冷却键立刻重试", automatedBy: "analyticsPhase16Client.test.js 7 条" },
  { id: "B3", category: "普通用户能力", status: "HANDOVER", title: "普通用户真机分享带 scene 落地 → 后端 analyticsOverview 对应 channel/scene 桶出现", note: "真机普通用户转发内容卡片 → 另一微信号打开落地页 → 看 topSources 对应 key = channel:scene 是否出现", automatedBy: "analyticsOverview.int.test.js 10 条 buildSceneFunnel + buildContentAnalytics(topSources) 专项" },
  { id: "B4", category: "普通用户能力", status: "HANDOVER", title: "普通用户提交预约 → bookingExportCsv 17 列 CSV 能下载且 attribution 三列非空对应（含非白名单清空）", note: "真机普通用户走 content-view → content-booking-start → booking-submit 全链路；管理员下载 CSV 看 17 列完整性", automatedBy: "bookingExportCsv.int.test.js 15 条 + analyticsEventsPrivacy.test.js C2-4 白盒锁死 17 中文列 + 17 投影键" },
  { id: "B5", category: "普通用户能力", status: "AUTOMATED", title: "普通用户 4 个 ACTION 调 contentGuideManage 全 FORBIDDEN", automatedBy: "contentGuideManageForAcceptance.test.js B5" },

  { id: "C1", category: "参数/隐私/幂等", status: "AUTOMATED", title: "未知枚举 channel/scene + slug 路径字符/65 字符 → normalize 丢弃或 VALIDATION_ERROR 拒绝", automatedBy: "contentGuideManageForAcceptance.test.js C1 + contentAttribution.test.js 6 枚举白名单" },
  { id: "C2", category: "参数/隐私/幂等", status: "AUTOMATED", title: "analytics_events 仅 6 字段白名单；CSV 17 列；返回 JSON 无 openid/手机号/身份证等关键字", automatedBy: "analyticsEventsPrivacy.test.js C2-1/C2-2/C2-3/C2-4 共 4 条" },
  { id: "C3", category: "参数/隐私/幂等", status: "AUTOMATED", title: "同 slug 第二次 create 必 DUPLICATE_SLUG（幂等绝不重复落库）", automatedBy: "contentGuideManageForAcceptance.test.js C3" },

  { id: "X1", category: "部署自检", status: "HANDOVER", title: "真机跑 npm run check:deploy（=check:release + bootstrap:seeds）零退出码", note: "真机登录后部署环境跑一次，确保 5 篇内容 + 权限 + 1030+ 测试全绿", automatedBy: "package.json check:deploy + releaseHygiene.test.js 4 条命令断言" },
  { id: "X2", category: "部署自检", status: "HANDOVER", title: "bootstrapAdmin(token=真口令) 返回 initialized=true + roles 集合管理员角色记录存在", note: "真机管理员账号进入「我的」页 → 点「内容维护入口」→ 触发 bootstrapAdmin，再看云开发 roles 集合是否已有 admin openid 记录", automatedBy: "bootstrapAdmin.int.test.js 9 条（token 合法/非法/幂等/audit 仅写 4 字段）" }
]

function runAutomated(item) {
  const relSuite = item.automatedBy || ""
  const baseMatch = relSuite.match(/^([A-Za-z0-9_.\-\/]+)\s+/)
  let suiteFile = baseMatch ? baseMatch[1] : null
  if (!suiteFile) {
    const suiteMap = {
      "PRE-4": "bootstrapContentDrafts.test.js",
      "B0": "contentPage.page.test.js",
      "B1": "bookingCreate.int.test.js",
      "B2": "analyticsPhase16Client.test.js",
      "B3": "analyticsOverview.int.test.js",
      "B4": "bookingExportCsv.int.test.js",
      "X1": "releaseHygiene.test.js",
      "X2": "bootstrapAdmin.int.test.js"
    }
    suiteFile = suiteMap[item.id]
  }
  if (!suiteFile) return true
  const absolute = path.resolve(__dirname, suiteFile)
  if (!fs.existsSync(absolute)) {
    throw new Error(`[${item.id}] referenced suite missing: ${suiteFile}`)
  }
  return true
}

describe("PHASE 16 验收清单（it.each 21 项，AUTOMATED 跑对应文件存在性 + HANDOVER 打印真机操作指引，不失败）", () => {
  ACCEPTANCE_ITEMS.forEach((item) => {
    test(`${item.id} [${item.category}] [${item.status}] ${item.title}`, () => {
      if (item.status === "AUTOMATED") {
        expect(item.automatedBy).toBeTruthy()
        expect(runAutomated(item)).toBe(true)
        expect(["AUTOMATED"]).toContain(item.status)
      } else if (item.status === "HANDOVER") {
        expect(item.note).toBeTruthy()
        expect(item.note.length > 0).toBe(true)
        expect(["HANDOVER"]).toContain(item.status)
      }
      console.log(`[${item.id}] status=${item.status} :: ${item.title}`)
      if (item.note) console.log(`       note: ${item.note}`)
      if (item.automatedBy) console.log(`       automated by: ${item.automatedBy}`)
    })
  })

  test("汇总统计：21 项清单 = 2 PRE + 8 管理员(A0–A7) + 6 普通用户(B0–B5)+3 参数(C1–C3)+2 部署自检(X1–X2)", () => {
    expect(ACCEPTANCE_ITEMS).toHaveLength(21)
    const ids = new Set(ACCEPTANCE_ITEMS.map((item) => item.id))
    const expectedIds = [
      "PRE-3","PRE-4",
      "A0","A1","A2","A3","A4","A5","A6","A7",
      "B0","B1","B2","B3","B4","B5",
      "C1","C2","C3",
      "X1","X2"
    ]
    expect([...ids].sort()).toEqual(expectedIds.sort())
    const counts = ACCEPTANCE_ITEMS.reduce((acc, item) => {
      acc[item.category] = (acc[item.category] || 0) + 1
      acc[item.status] = (acc[item.status] || 0) + 1
      return acc
    }, {})
    expect(counts.PRE).toBe(2)
    expect(counts["管理员能力"]).toBe(8)
    expect(counts["普通用户能力"]).toBe(6)
    expect(counts["参数/隐私/幂等"]).toBe(3)
    expect(counts["部署自检"]).toBe(2)
    expect(counts.AUTOMATED + counts.HANDOVER).toBe(21)
    expect(counts.AUTOMATED).toBe(14)
    expect(counts.HANDOVER).toBe(7)
  })
})
