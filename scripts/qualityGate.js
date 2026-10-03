/**
 * 极境车库 - 全链路工程质量总门禁 (Quality Gate & Engineering Doctor)
 *
 * 工业级 CI/CD 与本地发版前全要素自动体检流水线：
 * 1. 结构与文件规范 (checkProjectStructure)
 * 2. 密钥与敏感凭据防线 (checkRepositorySecrets)
 * 3. 运营攻略内容合规校验 (contentDraftsValidate)
 * 4. 16 集合 × 52 复合索引安全规则巡检 (checkDatabaseIndexes)
 * 5. 56 个云函数架构规范与安全鉴权审计 (cloudCheck)
 * 6. 小程序主包与分包体积预算 (checkMiniProgramPackage, <= 1.75 MiB)
 * 7. Jest 自动化测试全量回归 (154 套件，1850+ 用例)
 * 8. 无头全页面组件交互点击仿真 (333 项点击断言)
 * 9. 真实用户多角色业务旅程全闭环验证 (30 项端到端流程)
 *
 * 用法：
 *   node scripts/qualityGate.js          # 全量 9 阶段深度体检
 *   node scripts/qualityGate.js --static # 静态合规与架构规范快速体检 (前 6 项)
 */

const { spawnSync } = require("child_process")
const path = require("path")

const PROJECT_ROOT = path.resolve(__dirname, "..")
const isStaticOnly = process.argv.includes("--static") || process.argv.includes("--fast")

const STAGES = [
  {
    id: "structure",
    name: "阶段 1/9: 项目目录与页面声明规范",
    script: "scripts/checkProjectStructure.js",
    args: []
  },
  {
    id: "secrets",
    name: "阶段 2/9: 仓库敏感信息与凭据扫描",
    script: "scripts/checkRepositorySecrets.js",
    args: []
  },
  {
    id: "drafts",
    name: "阶段 3/9: 运营攻略草稿 Schema 校验",
    script: "scripts/contentDraftsValidate.js",
    args: []
  },
  {
    id: "database",
    name: "阶段 4/9: 数据库集合安全规则与索引校验",
    script: "scripts/checkDatabaseIndexes.js",
    args: []
  },
  {
    id: "cloud",
    name: "阶段 5/9: 云函数架构规范与安全鉴权审计 (56 Functions)",
    script: "scripts/cloudCheck.js",
    args: []
  },
  {
    id: "package",
    name: "阶段 6/9: 小程序主包与分包体积预算",
    script: "scripts/checkMiniProgramPackage.js",
    args: []
  }
]

if (!isStaticOnly) {
  STAGES.push(
    {
      id: "jest",
      name: "阶段 7/9: 单元与集成测试全量回归 (Jest 154 Suites)",
      script: "node_modules/jest/bin/jest.js",
      args: ["--runInBand"]
    },
    {
      id: "clicks",
      name: "阶段 8/9: 无头全页面组件交互点击仿真 (333 Clicks)",
      script: "scripts/simulateAllComponentClicks.js",
      args: []
    },
    {
      id: "usage",
      name: "阶段 9/9: 真实用户全场景业务旅程仿真 (30 Scenarios)",
      script: "scripts/verifyActualUsage.js",
      args: []
    }
  )
}

function runStage(stage) {
  const startTime = Date.now()
  console.log(`\n\x1b[36m▶ [RUNNING]\x1b[0m ${stage.name}`)
  console.log(`  \x1b[90m$ node ${stage.script} ${stage.args.join(" ")}\x1b[0m`)

  const isJest = stage.id === "jest"
  const targetScript = path.resolve(PROJECT_ROOT, stage.script)
  const proc = spawnSync(process.execPath, [targetScript, ...stage.args], {
    cwd: PROJECT_ROOT,
    stdio: isJest ? "inherit" : "inherit",
    env: { ...process.env, CI: "true" }
  })

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2)
  const passed = proc.status === 0

  if (passed) {
    console.log(`\x1b[32m✔ [PASSED]\x1b[0m ${stage.name} (${elapsed}s)`)
  } else {
    console.error(`\x1b[31m✘ [FAILED]\x1b[0m ${stage.name} (退出码: ${proc.status}, 耗时: ${elapsed}s)`)
  }

  return { ...stage, passed, elapsed }
}

function main() {
  const overallStart = Date.now()
  console.log("\x1b[1m\x1b[35m")
  console.log("╔════════════════════════════════════════════════════════════════════╗")
  console.log("║         极境车库工程质量总门禁 (Quality Gate & Doctor)             ║")
  console.log("╚════════════════════════════════════════════════════════════════════╝")
  console.log(`模式: ${isStaticOnly ? "静态快速体检 (前 6 阶段)" : "全量深度体检 (全 9 阶段)"}`)
  console.log(`基准目录: ${PROJECT_ROOT}\x1b[0m`)

  const results = []
  let anyFailed = false

  for (const stage of STAGES) {
    const result = runStage(stage)
    results.push(result)
    if (!result.passed) {
      anyFailed = true
      break
    }
  }

  const totalDuration = ((Date.now() - overallStart) / 1000).toFixed(2)

  console.log("\n\x1b[1m" + "─".repeat(70) + "\x1b[0m")
  console.log("\x1b[1m质量门禁检查汇总报告 (Quality Gate Summary):\x1b[0m")
  results.forEach((r) => {
    const icon = r.passed ? "\x1b[32m✔ PASS\x1b[0m" : "\x1b[31m✘ FAIL\x1b[0m"
    console.log(`  ${icon} | ${r.name.padEnd(48)} | ${r.elapsed}s`)
  })
  console.log("\x1b[1m" + "─".repeat(70) + "\x1b[0m")

  if (anyFailed) {
    console.error(`\n\x1b[31m\x1b[1m✘ 质量门禁未通过！发现异常阶段，已终止发布流程。\x1b[0m`)
    console.error(`总耗时: ${totalDuration}s\n`)
    process.exit(1)
  }

  console.log(`\n\x1b[32m\x1b[1m🎉 质量门禁全项通过！工程健康评分：100 / 100\x1b[0m`)
  console.log(`累计执行阶段: ${results.length}/${STAGES.length} | 总耗时: ${totalDuration}s\n`)
  process.exit(0)
}

main()
