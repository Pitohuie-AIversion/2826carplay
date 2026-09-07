const fs = require("fs");
const {
  parseArgs,
  printTable,
  summarize,
  listCloudfunctions,
  colorize,
} = require("./_cloudUtil");

const DEFAULT_TARGET = "4.0.2";
const DEP_KEY = "wx-server-sdk";

function run(opts = {}) {
  const { flags } = opts.cli !== false ? parseArgs(process.argv) : { flags: opts.flags || {} };
  const target = flags["--target"] || DEFAULT_TARGET;
  const items = listCloudfunctions();
  const rows = [];
  let passed = 0;
  let failed = 0;
  for (const it of items) {
    if (!it.hasPkg) {
      rows.push({ name: it.name, version: colorize("（缺 package.json", "yellow"), status: colorize("SKIP", "yellow") });
      continue;
    }
    const v = (it.pkgJson && it.pkgJson.dependencies && it.pkgJson.dependencies[DEP_KEY]) || null;
    if (v === target) {
      rows.push({ name: it.name, version: v, status: colorize("✅ 匹配", "green") });
      passed++;
    } else {
      rows.push({
        name: it.name,
        version: v || colorize("（缺失依赖", "red"),
        status: colorize(`❌ 不匹配 期望=${target}`, "red"),
      });
      failed++;
    }
  }
  console.log(colorize(`【云端·SDK 版本一致性】 目标版本 ${target}`, "bold"));
  printTable(rows, [
    { key: "name", label: "函数名" },
    { key: "version", label: "实际版本" },
    { key: "status", label: "状态" },
  ]);
  summarize("SDK 版本", items.length, passed, failed);
  const exitCode = failed > 0 ? 1 : 0;
  if (opts.cli !== false) process.exit(exitCode);
  return { exitCode, passed, failed, total: items.length, target };
}

if (require.main === module) run();
module.exports = { run };
