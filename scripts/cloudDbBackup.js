const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { colorize, readCloudbaserc, parseArgs } = require("./_cloudUtil");

const CORE_COLLECTIONS = [
  "vehicles",
  "bookings",
  "vehicle_calendar_days",
  "vehicle_availability_blocks",
  "roles",
  "app_configs",
  "audit_logs"
];

const ALL_COLLECTIONS = [
  "vehicles",
  "bookings",
  "vehicle_calendar_days",
  "vehicle_availability_blocks",
  "vehicle_price_rules",
  "booking_quotes",
  "booking_handovers",
  "roles",
  "app_configs",
  "audit_logs",
  "error_logs",
  "favorites",
  "content_guides",
  "privacy_requests",
  "pending_file_deletions",
  "analytics_events"
];

function formatTimestamp(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const mins = pad(d.getMinutes());
  const secs = pad(d.getSeconds());
  return `${year}${month}${day}_${hours}${mins}${secs}`;
}

async function runBackup() {
  const { flags } = parseArgs(process.argv);
  const isDryRun = !!flags["--dry"] || !!flags["--dry-run"];
  const isAll = !!flags["--all"];
  const singleCol = flags["--collection"];
  
  const rc = readCloudbaserc();
  const envId = rc && rc.envId ? rc.envId : "cloud1-d8gtmns36320e045e";
  
  let targetCollections = isAll ? ALL_COLLECTIONS : CORE_COLLECTIONS;
  if (singleCol) {
    targetCollections = [singleCol];
  }

  const projectRoot = path.resolve(__dirname, "..");
  const timestamp = formatTimestamp();
  const backupFolder = flags["--output-dir"] || path.join(projectRoot, "backups", `backup_${timestamp}`);

  console.log(colorize("【云端·数据库异地容灾冷备】", "bold"));
  console.log(`目标云环境: ${colorize(envId, "cyan")}`);
  console.log(`备份模式: ${isDryRun ? colorize("DRY-RUN（仅模拟，不执行导出）", "yellow") : colorize("LIVE（实时拉取归档）", "green")}`);
  console.log(`备份集合范围: ${singleCol ? colorize(singleCol, "yellow") : (isAll ? colorize("全部 16 个集合", "magenta") : colorize("核心 7 个核心业务集合", "cyan"))}`);
  console.log(`归档目标目录: ${colorize(path.relative(projectRoot, backupFolder) || backupFolder, "gray")}`);
  console.log("");

  if (isDryRun) {
    console.log(colorize("计划导出的集合清单:", "bold"));
    targetCollections.forEach((c, idx) => {
      console.log(`  ${idx + 1}. ${colorize(c, "cyan")}`);
    });
    console.log("");
    console.log(colorize("ℹ️ dry-run 校验通过。若要真正启动云端数据库冷备，请运行：", "gray"));
    console.log(colorize("    npm run cloud:backup -- --apply", "cyan"));
    console.log(colorize("    npm run cloud:backup -- --apply --all  (全量 16 个集合)", "cyan"));
    return;
  }

  if (!fs.existsSync(backupFolder)) {
    fs.mkdirSync(backupFolder, { recursive: true });
  }

  const results = [];
  console.log(colorize(`⏳ 开始从 ${envId} 导出数据库集合快照...`, "bold"));

  for (const col of targetCollections) {
    const start = Date.now();
    process.stdout.write(`  • 正在导出 ${colorize(col, "cyan")} ... `);
    try {
      const cmd = `tcb db nosql dump "${col}" --file-type json --output-dir "${backupFolder}"`;
      execSync(cmd, { stdio: "pipe", cwd: projectRoot });
      const durationMs = Date.now() - start;
      console.log(colorize(`✔ 成功 (${durationMs}ms)`, "green"));
      results.push({ collection: col, status: "SUCCESS", durationMs });
    } catch (err) {
      console.log(colorize(`❌ 失败: ${err.message.split("\n")[0]}`, "red"));
      results.push({ collection: col, status: "FAILED", error: err.message });
    }
  }

  const summaryData = {
    envId,
    timestamp,
    exportedAt: new Date().toISOString(),
    results,
    totalCount: targetCollections.length,
    successCount: results.filter(r => r.status === "SUCCESS").length
  };

  fs.writeFileSync(
    path.join(backupFolder, "backup_manifest.json"),
    JSON.stringify(summaryData, null, 2),
    "utf8"
  );

  console.log(colorize("\n🎉 数据库容灾备份任务完成！", "green"));
  console.log(`成功: ${summaryData.successCount}/${summaryData.totalCount} 个集合`);
  console.log(`归档凭据清单已生成: ${path.join(backupFolder, "backup_manifest.json")}`);
}

if (require.main === module) {
  runBackup().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { runBackup, CORE_COLLECTIONS, ALL_COLLECTIONS };
