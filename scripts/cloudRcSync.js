const {
  parseArgs,
  listCloudfunctions,
  readCloudbaserc,
  writeCloudbaserc,
  colorize,
} = require("./_cloudUtil");

const DEFAULT_RUNTIME = process.env.CLOUD_DEFAULT_RUNTIME || "Nodejs20.19";
const DEFAULT_TIMEOUT = Number(process.env.CLOUD_DEFAULT_TIMEOUT || 15);
const DEFAULT_MEMORY = Number(process.env.CLOUD_DEFAULT_MEM || 256);

function makeDefaultFn(name) {
  return {
    name,
    type: "Event",
    runtime: DEFAULT_RUNTIME,
    handler: "index.main",
    timeout: DEFAULT_TIMEOUT,
    memorySize: DEFAULT_MEMORY,
    installDependency: true,
    ignore: ["node_modules/**"],
  };
}

function run(opts = {}) {
  const { flags } = opts.cli !== false ? parseArgs(process.argv) : { flags: opts.flags || {} };
  const write = !!flags["--write"];
  const rc = readCloudbaserc();
  if (!rc) {
    console.log(colorize("❌ cloudbaserc.json 不存在", "red"));
    if (opts.cli !== false) process.exit(1);
    return { exitCode: 1 };
  }
  const rcFnNames = new Set((rc.functions || []).map((f) => f.name));
  const rcFnMap = new Map((rc.functions || []).map((f) => [f.name, f]));
  const items = listCloudfunctions();
  const dirNames = new Set(items.map((i) => i.name));

  const missing = items.filter((i) => !rcFnNames.has(i.name)).map((i) => i.name);
  const extra = (rc.functions || []).filter((f) => !dirNames.has(f.name)).map((f) => f.name);
  const common = items.filter((i) => rcFnNames.has(i.name)).map((i) => i.name);

  console.log(
    colorize(
      `【云端·配置×目录一致性】 模式：${write ? colorize("WRITE（写入 cloudbaserc.json）", "green") : colorize("DRY（只读，加 --write 才补全）", "yellow")}`,
      "bold"
    )
  );
  console.log(`cloudbaserc 条目=${colorize(rcFnNames.size, "cyan")}   functions/目录数=${colorize(dirNames.size, "cyan")}`);
  console.log("");
  const block = (title, arr, color) => {
    console.log(colorize(`${title}（${arr.length}）`, color));
    if (arr.length === 0) console.log(colorize("  （无）", "gray"));
    else console.log("  • " + arr.sort().join("\n  • "));
    console.log("");
  };
  block("MISSING_IN_RC（目录有但配置漏）", missing, "red");
  block("EXTRA_IN_RC（配置有但目录没）", extra, "yellow");
  block("COMMON（二者均有）", common, "green");

  let exitCode = missing.length === 0 && extra.length === 0 ? 0 : 1;

  if (write && missing.length > 0) {
    const nextFns = [...(rc.functions || [])];
    for (const name of missing) nextFns.push(makeDefaultFn(name));
    nextFns.sort((a, b) => a.name.localeCompare(b.name));
    rc.functions = nextFns;
    writeCloudbaserc(rc);
    console.log(colorize(`✏️ 已补写 ${missing.length} 条函数默认配置（按字母序）`, "green"));
    const rcFnNames2 = new Set((rc.functions || []).map((f) => f.name));
    const missing2 = items.filter((i) => !rcFnNames2.has(i.name)).map((i) => i.name);
    const extra2 = (rc.functions || []).filter((f) => !dirNames.has(f.name)).map((f) => f.name);
    const common2 = items.filter((i) => rcFnNames2.has(i.name)).map((i) => i.name);
    exitCode = missing2.length === 0 && extra2.length === 0 ? 0 : 1;
    if (opts.cli !== false) process.exit(exitCode);
    return { exitCode, missing: missing2, extra: extra2, common: common2, rcSize: rcFnNames2.size, dirSize: dirNames.size };
  }

  if (opts.cli !== false) process.exit(exitCode);
  return { exitCode, missing, extra, common, rcSize: rcFnNames.size, dirSize: dirNames.size };
}

if (require.main === module) run();
module.exports = { run, makeDefaultFn };
