const fs = require("fs")
const path = require("path")

const CONTENT_TYPES = ["route", "guide", "vehicle_advice", "handover_guide", "vehicle_tip"]
const SCENARIOS = ["weekend_trip", "business_reception", "group_travel", "ev_experience", "handover_tips"]
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

function text(value, max) {
  return String(value || "").trim().slice(0, max)
}

function strings(value, maxItems, maxLength) {
  return Array.from(new Set((Array.isArray(value) ? value : [])
    .map((item) => text(item, maxLength)).filter(Boolean))).slice(0, maxItems)
}

function normalizeGuide(input) {
  return {
    slug: text(input.slug, 64),
    title: text(input.title, 100),
    summary: text(input.summary, 300),
    body: text(input.body, 20000),
    contentType: text(input.contentType, 32),
    scenario: text(input.scenario, 32),
    vehicleIds: strings(input.vehicleIds, 20, 64).filter((id) => ID_PATTERN.test(id)),
    tags: strings(input.tags, 20, 30),
    shareTitle: text(input.shareTitle, 100)
  }
}

function validateGuide(guide) {
  const fields = []
  if (!ID_PATTERN.test(guide.slug)) fields.push(`slug(${guide.slug})`)
  if (!guide.title) fields.push("title")
  if (!guide.summary) fields.push("summary")
  if (!guide.body) fields.push("body")
  if (!CONTENT_TYPES.includes(guide.contentType)) fields.push(`contentType(${guide.contentType})`)
  if (!SCENARIOS.includes(guide.scenario)) fields.push(`scenario(${guide.scenario})`)
  return fields
}

const BODY_1 = [
  "一、出发前 3 天：确认档期与报价",
  "1. 在车库首页选好车型，点「立即预约」填写取还车日期，留对手机号",
  "2. 顾问确认后会发送正式报价；报价确认后才会锁档，普通咨询不占车",
  "3. 如周末为节假日，参考车辆详情页的特殊日期价格说明，最终金额以报价版本为准",
  "",
  "二、出发前 1 天：取车交接核对 4 件事",
  "1. 确认取车时间和地点，如需送车上门提前告知顾问",
  "2. 交接时核对前、后、左、右 4 角照片，里程与油量/电量与系统一致",
  "3. 检查驾驶证是否在有效期（现场无需上传，但必须随身携带）",
  "4. 保存紧急联系电话，本页底部「一键救援」可直接拨打",
  "",
  "三、出发当天：上车先试 3 项",
  "1. 调整座椅、后视镜，熟悉雨刷和灯光位置",
  "2. 试一次刹车和加速，感受车辆动力特性",
  "3. 新能源车先看续航，油车先看油表；手机支架、充电线自备",
  "",
  "四、返程：还车前 30 分钟",
  "1. 简单清理车内杂物，不要遗留证件、钱包、数据线",
  "2. 如承诺满油/满电还车，提前补满；否则按报价规则结算差额",
  "3. 与顾问一起核对还车 4 角照片，确认无新的划痕后再离开",
  "",
  "五、常见问题",
  "· 下雨/下雪怎么办？正常交接即可，如遇重大事故先拨打紧急电话，不要私下解决",
  "· 可以带宠物吗？请提前告知顾问，部分车辆允许，但还车时需清洁到位",
  "· 超出里程怎么算？以报价说明为准，通常周末短途不会触及里程上限"
].join("\n")

const BODY_2 = [
  "一、三类场景选型建议",
  "· 机场接送 3 人以下：中大型轿车，平稳舒适，后备箱够放 2–3 件 24 寸行李",
  "· 4–6 人同行或企业全天接待：7 座商务，第三排与后备箱空间要同时兼顾",
  "· 高管长租 / 外宾接待：1 辆主车 + 备用车 1 辆；主车建议中高配置，带后排隐私玻璃与遮阳帘",
  "",
  "二、时间安排避坑",
  "· 航班落地后预留 45 分钟取行李时间，司机提前 30 分钟到达停车区",
  "· 雨天/早高峰/晚高峰：再加 30 分钟余量，避免接机迟到",
  "· 全天包天用车：提前一天敲定次日首段出发时间与大致路线",
  "",
  "三、车内标准准备",
  "· 瓶装饮用水 2 瓶以上，副驾后袋放纸巾盒",
  "· 手机充电线（Type-C + Lightning 各一条）备好",
  "· 车内温度提前调至 22–24℃，雨天提前开除雾",
  "",
  "四、费用与口径",
  "· 最终以报价版本为准；连租多天或多台车可联系顾问合并报价",
  "· 如行程变动超过 2 小时，请尽早告知顾问调整档期，避免空跑与冲突",
  "· 发票与结算凭证可在行程结束后统一联系客服"
].join("\n")

const BODY_3 = [
  "一、取车时先看「续航百分比」",
  "仪表显示的剩余里程是根据最近 30 公里驾驶习惯估算的，波动大；以百分比为准更稳定。",
  "",
  "二、三类主流快充平台",
  "· 国家电网：高速服务区覆盖好，需要 e 充电 App",
  "· 特来电：城市商业体和酒店多，App 或小程序均可",
  "· 星星充电：小区与写字楼地库常见，支持无感充电",
  "出发前在导航里收藏沿途 2 个以上充电站，避免单一站点故障或排队。",
  "",
  "三、长途出行的 30% 原则",
  "每次剩余 30% 就开始找下一站充电桩，不要等到 10% 以下才焦虑。冬季开暖气会掉电约 20%，留足余量。",
  "",
  "四、还车规则与费用",
  "· 按报价约定的电量百分比还车（例如约定 80%±10%），差额按说明处理",
  "· 还车前保留最后一张充电截图，作为凭证",
  "· 部分场站有超时占用费，充满后 15 分钟内离场",
  "",
  "五、与油车不同的操作习惯",
  "· 换挡方式：怀挡、旋钮挡、按键挡提前试一次",
  "· 动能回收强的车型松开电门会明显减速，提前适应",
  "· 雨刷、前后备箱开关位置若不熟悉，取车时让顾问演示一遍"
].join("\n")

const BODY_4 = [
  "一、路线类型 × 车型匹配",
  "· 高速跨城 3–4 人：中大型轿车或城市 SUV，舒适省油，续航压力小",
  "· 山路 / 省道 / 非铺装路面：硬派越野或四驱 SUV，底盘高、轮胎厚",
  "· 4 人以上家庭出行：优先 7 座 MPV 或 7 座 SUV，每人一排不挤",
  "",
  "二、每日驾驶节奏建议",
  "· 单日驾驶不超过 6 小时，每 2 小时进服务区 15 分钟下车拉伸",
  "· 避免夜间陌生山路，宁可提前一天下午出发住一晚",
  "· 午餐后留 30 分钟休息，不要硬撑",
  "",
  "三、出发前准备清单",
  "· 导航 App 离线地图包提前下载",
  "· 沿途加油站 / 充电站 / 服务区收藏 3 处以上",
  "· 备胎 / 应急三角牌 / 反光背心检查到位（交接时可确认）",
  "· 常用药、晕车药、矿泉水、零食按人数备",
  "",
  "四、多人出行轮换",
  "· 建议 2 人及以上会开车的轮换；每段不超过 3 小时",
  "· 换人后重新调整座椅、后视镜和方向盘位置，不要凑合用前任的位置",
  "",
  "五、档期变动与费用",
  "· 如需延长或提前还车，提前联系顾问调整档期",
  "· 费用与结算以报价版本为准；超时按预约说明处理"
].join("\n")

const BODY_5 = [
  "1. 四角照片的标准拍法",
  "正前、正后、左前 45°、右后 45° 四个角度，务必把轮眉和前后保险杠拍完整，方便比对。",
  "",
  "2. 划痕判定法",
  "指甲能卡住的算明显划痕；指甲滑过没有明显顿挫的通常是太阳纹或浮尘。有争议就当场圈出来。",
  "",
  "3. 里程必须是整数",
  "取还车里程都取整公里；差值与实际路线大致吻合时再确认，异常差值要当场解释。",
  "",
  "4. 油量 / 电量按整数百分比记",
  "不要写「大概 3/4 油」，统一用 0–100 整数，后续差额结算才不会扯皮。",
  "",
  "5. 钥匙交接",
  "通常只交接正式钥匙一把；备用钥匙由运营保存，不要自行复制或转借。",
  "",
  "6. 紧急联系号码",
  "一键救援与客服电话已在多处页面预置；事故与人身安全先报 110/120，再联系客服。",
  "",
  "7. 还车超时",
  "预计晚还 1 小时以上必须提前联系顾问调整档期；临时临时超时容易被按超期处理。",
  "",
  "8. 遗留物必查 4 处",
  "还车前 5 分钟检查：4 个座位下方、门板储物、后备厢（含两侧暗格）、扶手箱与杯架。",
  "",
  "9. 物品损坏与责任",
  "车辆本身故障或出厂缺陷由运营负责；用户私人物品遗失需自行联系调取车内录像（如有）。",
  "",
  "10. 24 小时无异议原则",
  "还车完成后 24 小时内如双方都无新的异议，则本单交接流程正式结束。"
].join("\n")

const DRAFTS = [
  {
    slug: "weekend-short-trip-prep-2026",
    contentType: "guide",
    scenario: "weekend_trip",
    title: "周末短途自驾准备清单：2 天 1 夜省心出发",
    summary: "从选车、取车到路上应急，极境车库根据真实交接经验整理的周末出行备忘",
    shareTitle: "周末短途自驾，出发前这 8 件事先核对",
    tags: ["周末短途", "取车准备", "自驾攻略", "新手友好"],
    vehicleIds: [],
    body: BODY_1
  },
  {
    slug: "business-reception-guide-2026",
    contentType: "vehicle_advice",
    scenario: "business_reception",
    title: "商务接待用车全指南：车型选型 + 取还安排",
    summary: "针对机场接送、外宾接待、高管出行三类场景给出对应车型与时间建议",
    shareTitle: "商务接待不翻车：这 5 条安排细节先对一遍",
    tags: ["商务接待", "机场接送", "高管用车", "用车礼仪"],
    vehicleIds: [],
    body: BODY_2
  },
  {
    slug: "ev-first-rental-tips-2026",
    contentType: "vehicle_tip",
    scenario: "ev_experience",
    title: "新能源车第一次租：充电、续航与还车 7 条注意",
    summary: "极境车库整理的纯电车型体验要点，避免第一次租电车踩坑",
    shareTitle: "第一次租新能源车：这 7 点先知道",
    tags: ["新能源", "充电", "续航焦虑", "代步电车", "还车避坑"],
    vehicleIds: [],
    body: BODY_3
  },
  {
    slug: "long-distance-road-trip-2026",
    contentType: "route",
    scenario: "group_travel",
    title: "3–5 天长途自驾：车型 + 路线搭配建议",
    summary: "跨城/山路/海边三类长途场景的车型选择与路线节奏安排",
    shareTitle: "长途自驾不折腾：车型与节奏怎么安排",
    tags: ["长途自驾", "自驾路线", "家庭出行", "多人出行"],
    vehicleIds: [],
    body: BODY_4
  },
  {
    slug: "handover-checklist-2026",
    contentType: "handover_guide",
    scenario: "handover_tips",
    title: "取还车避坑 10 条：极境车库真实交接总结",
    summary: "从四角照片、里程油量到划痕判定，10 条能减少 90% 争议的交接要点",
    shareTitle: "取还车别嫌麻烦：这 10 条能少 90% 纠纷",
    tags: ["交接指南", "取车流程", "还车流程", "避坑", "新手必看"],
    vehicleIds: [],
    body: BODY_5
  }
]

if (require.main === module) {
  main()
}

function main() {
  const outDir = path.join(__dirname, "content_drafts_seed")
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })

  const slugMap = new Map()
  const results = DRAFTS.map((raw) => {
    const normalized = normalizeGuide(raw)
    const invalid = validateGuide(normalized)
    let duplicate = false
    if (slugMap.has(normalized.slug)) duplicate = true
    slugMap.set(normalized.slug, true)

    const ok = invalid.length === 0 && !duplicate
    const record = {
      ...normalized,
      status: "draft",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
    if (ok) {
      const slug = record.slug.replace(/[^A-Za-z0-9_-]/g, "_")
      const target = path.join(outDir, `draft_${slug}.json`)
      fs.writeFileSync(target, JSON.stringify(record, null, 2) + "\n", "utf8")
    }
    return { slug: normalized.slug, ok, invalid, duplicate }
  })

  const passed = results.filter((r) => r.ok).length
  const summary = {
    generatedAt: new Date().toISOString(),
    total: results.length,
    passed,
    failed: results.length - passed,
    expectedContentTypes: CONTENT_TYPES,
    expectedScenarios: SCENARIOS,
    outputDir: outDir,
    results
  }

  const summaryPath = path.join(outDir, "summary.json")
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + "\n", "utf8")

  console.log(`== content_guides 草稿本地校验报告 ==`)
  console.log(`总数: ${summary.total}，通过: ${passed}，失败: ${summary.failed}`)
  console.log(`输出目录: ${outDir}`)
  console.log()
  for (const r of results) {
    const mark = r.ok ? "✅" : "❌"
    const note = []
    if (r.invalid.length) note.push(`INVALID_FIELDS=${r.invalid.join(",")}`)
    if (r.duplicate) note.push("DUPLICATE_SLUG")
    console.log(`${mark} ${r.slug}  ${note.join(" ; ")}`)
  }
  console.log()
  console.log(`摘要写入: ${summaryPath}`)

  if (summary.failed > 0) process.exitCode = 1
}

module.exports = {
  DRAFTS,
  normalizeGuide,
  validateGuide,
  CONTENT_TYPES,
  SCENARIOS,
  ID_PATTERN,
  main
}
