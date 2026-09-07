const {
  parseArgs,
  printTable,
  listCloudfunctions,
  readCloudbaserc,
  colorize,
} = require("./_cloudUtil");

function run(opts = {}) {
  const _ = opts.cli !== false ? parseArgs(process.argv) : null;
  const items = listCloudfunctions();
  const rc = readCloudbaserc();
  const rcMap = new Map((rc ? rc.functions || [] : []).map((f) => [f.name, f]));
  const rows = [];
  let warn = 0;
  for (const it of items) {
    const fn = rcMap.get(it.name);
    const timeout = fn ? fn.timeout : colorize("（RC 无）", "yellow");
    const memory = fn ? fn.memorySize : colorize("（RC 无）", "yellow");
    const hints = [];
    if (it.lines > 400 && fn && fn.timeout === 15) {
      hints.push(colorize("建议 timeout→20s", "yellow"));
      warn++;
    }
    if (it.logs >= 5) {
      hints.push(colorize(`日志 ${it.logs} 条（建议精简）`, "yellow"));
      warn++;
    }
    rows.push({
      name: it.name,
      lines: it.lines,
      logs: it.logs,
      timeout,
      memory,
      advice: hints.length ? hints.join("；") : colorize("-", "gray"),
    });
  }
  console.log(colorize("【云端·云函数规格体检】", "bold"));
  printTable(rows, [
    { key: "name", label: "函数名" },
    { key: "lines", label: "代码行", align: "right" },
    { key: "logs", label: "日志数", align: "right" },
    { key: "timeout", label: "超时(s)", align: "right" },
    { key: "memory", label: "内存(MB)", align: "right" },
    { key: "advice", label: "建议" },
  ]);
  console.log("");
  console.log(
    `共 ${colorize(items.length, "cyan")} 项   ` +
      colorize(`建议点 ${warn}`, warn === 0 ? "green" : "yellow")
  );
  const exitCode = 0;
  if (opts.cli !== false) process.exit(exitCode);
  return { exitCode, total: items.length, warnings: warn };
}

if (require.main === module) run();
module.exports = { run };
