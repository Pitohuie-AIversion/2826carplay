const fs = require("fs");
const {
  parseArgs,
  printTable,
  summarize,
  listCloudfunctions,
  colorize,
} = require("./_cloudUtil");

const DEP_KEY = "wx-server-sdk";

function run(opts = {}) {
  const { flags } = opts.cli !== false ? parseArgs(process.argv) : { flags: opts.flags || {} };
  const target = flags["--target"];
  const write = !!flags["--write"];
  if (!target) {
    console.log(colorize("❌ 参数错误：必须指定 --target=VER（例：--target=4.0.2）", "red"));
    console.log(colorize("查看帮助：npm run cloud:help", "gray"));
    if (opts.cli !== false) process.exit(2);
    return { exitCode: 2 };
  }
  const items = listCloudfunctions();
  const rows = [];
  let changed = 0;
  let skipped = 0;
  for (const it of items) {
    if (!it.hasPkg) {
      rows.push({ name: it.name, from: colorize("-", "yellow"), to: colorize("SKIP（缺 package.json）", "yellow"), action: "-" });
      skipped++;
      continue;
    }
    const from =
      (it.pkgJson && it.pkgJson.dependencies && it.pkgJson.dependencies[DEP_KEY]) ||
      colorize("（未安装）", "yellow");
    const willChange = from !== target;
    if (willChange) {
      if (write) {
        const pkg = JSON.parse(fs.readFileSync(it.pkgPath, "utf8"));
        if (!pkg.dependencies) pkg.dependencies = {};
        pkg.dependencies[DEP_KEY] = target;
        fs.writeFileSync(it.pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
      }
      rows.push({
        name: it.name,
        from: String(from),
        to: target,
        action: write ? colorize("✏️ 已更新", "green") : colorize("（DRY）将更新", "yellow"),
      });
      changed++;
    } else {
      rows.push({ name: it.name, from: String(from), to: target, action: colorize("- 无需变", "gray") });
    }
  }
  console.log(
    colorize(
      `【云端·SDK 版本升级】 目标版本 ${target}   模式：${write ? colorize("WRITE（写入文件）", "green") : colorize("DRY（不写文件，加 --write 生效）", "yellow")}`,
      "bold"
    )
  );
  printTable(rows, [
    { key: "name", label: "函数名" },
    { key: "from", label: "原版本" },
    { key: "to", label: "新版本" },
    { key: "action", label: "操作" },
  ]);
  console.log("");
  console.log(
    `共 ${colorize(items.length, "cyan")} 个   ` +
      colorize(`待更新/已更新：${changed}`, changed > 0 ? "yellow" : "green") +
      `   ${colorize(`跳过：${skipped}`, "gray")}`
  );
  if (opts.cli !== false) process.exit(0);
  return { exitCode: 0, changed, skipped, total: items.length };
}

if (require.main === module) run();
module.exports = { run };
