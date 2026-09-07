const path = require("path");
const {
  parseArgs,
  printTable,
  listCloudfunctions,
  colorize,
  delDirIfExists,
} = require("./_cloudUtil");

function run(opts = {}) {
  const { flags } = opts.cli !== false ? parseArgs(process.argv) : { flags: opts.flags || {} };
  const apply = !!flags["--apply"];
  const items = listCloudfunctions();
  const targets = items.filter((i) => i.hasNm);
  const before = targets.length;
  let removed = 0;
  const rows = targets.map((t) => {
    const dir = path.join(t.dir, "node_modules");
    let ok = false;
    if (apply) {
      ok = delDirIfExists(dir);
      if (ok) removed++;
    }
    return {
      name: t.name,
      action: apply
        ? ok
          ? colorize("🗑️ 已删除", "green")
          : colorize("❌ 删失败", "red")
        : colorize("（DRY）将删除 加 --apply 生效", "yellow"),
    };
  });
  console.log(
    colorize(
      `【云端·node_modules 清理】 模式：${apply ? colorize("APPLY（实际删除）", "green") : colorize("DRY（只预览，加 --apply 才删除）", "yellow")}`,
      "bold"
    )
  );
  if (rows.length === 0) {
    console.log(colorize("🎉 无需清理，0 个残留", "green"));
  } else {
    printTable(rows, [
      { key: "name", label: "函数名" },
      { key: "action", label: "操作" },
    ]);
  }
  console.log("");
  if (apply) {
    let after = 0;
    for (const it of listCloudfunctions()) if (it.hasNm) after++;
    console.log(
      `清理前 ${colorize(before, "yellow")} 个残留   清理后 ${colorize(after, before === 0 ? "green" : "red")} 个残留   删除成功 ${colorize(removed, "green")} 个`
    );
    const exitCode = after === 0 ? 0 : 1;
    if (opts.cli !== false) process.exit(exitCode);
    return { exitCode, before, after, removed };
  } else {
    console.log(`预览将删除：${colorize(before, "yellow")} 个   （加 --apply 确认执行）`);
    if (opts.cli !== false) process.exit(0);
    return { exitCode: 0, wouldRemove: before };
  }
}

if (require.main === module) run();
module.exports = { run };
