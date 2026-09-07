const {
  parseArgs,
  printTable,
  summarize,
  listCloudfunctions,
  colorize,
} = require("./_cloudUtil");

function run(opts = {}) {
  const _ = opts.cli !== false ? parseArgs(process.argv) : null;
  const items = listCloudfunctions();
  const rows = [];
  let dirty = 0;
  for (const it of items) {
    if (it.hasNm) {
      rows.push({ name: it.name, exists: colorize("✅ 存在残留", "red") });
      dirty++;
    }
  }
  const clean = items.length - dirty;
  console.log(colorize("【云端·node_modules 残留检查】", "bold"));
  if (dirty === 0) {
    console.log(colorize("🎉 56/56 个云函数均无 node_modules 残留", "green"));
  } else {
    printTable(rows, [
      { key: "name", label: "残留 node_modules 的函数" },
      { key: "exists", label: "状态" },
    ]);
  }
  summarize("NM 残留", items.length, clean, dirty);
  const exitCode = dirty > 0 ? 1 : 0;
  if (opts.cli !== false) process.exit(exitCode);
  return { exitCode, dirty, total: items.length, clean };
}

if (require.main === module) run();
module.exports = { run };
