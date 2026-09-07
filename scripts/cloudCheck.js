const {
  parseArgs,
  printTable,
  colorize,
} = require("./_cloudUtil");
const { run: sdk } = require("./cloudSdkCheck");
const { run: nm } = require("./cloudNmCheck");
const { run: rc } = require("./cloudRcSync");
const { run: auth } = require("./cloudAuthAudit");
const { run: spec } = require("./cloudSpecCheck");

const STEPS = [
  { key: "SDK", name: "SDK 版本一致性（cloud:sdk:check）", runner: () => sdk({ cli: false }) },
  { key: "NM", name: "node_modules 残留（cloud:nm:check）", runner: () => nm({ cli: false }) },
  { key: "RC", name: "配置×目录一致性（cloud:rc:sync --dry）", runner: () => rc({ cli: false, flags: { "--dry": true } }) },
  { key: "AUTH", name: "权限审计（cloud:auth:audit）", runner: () => auth({ cli: false }) },
  { key: "SPEC", name: "规格体检（cloud:spec:check）", runner: () => spec({ cli: false }) },
];

function run(opts = {}) {
  const _ = opts.cli !== false ? parseArgs(process.argv) : null;
  console.log(colorize("【云端·全景汇总检查 cloud:check】", "bold"));
  console.log(colorize("（串行跑 SDK / NM / RC / AUTH / SPEC 5 项，不含 cloud:audit 因其耗时）", "gray"));
  console.log("");
  const rows = [];
  let passed = 0;
  let failed = 0;
  for (const s of STEPS) {
    let res;
    try {
      res = s.runner();
    } catch (e) {
      res = { exitCode: 99, error: String(e && e.message || e) };
    }
    const ok = res.exitCode === 0;
    if (ok) passed++;
    else failed++;
    let note = "";
    if (s.key === "SDK") note = `target=${res.target} 通过=${res.passed}`;
    if (s.key === "NM") note = `残留=${res.dirty}`;
    if (s.key === "RC") note = `missing=${res.missing.length} extra=${res.extra.length}`;
    if (s.key === "AUTH") note = `unexpected=${res.unexpected.length}`;
    if (s.key === "SPEC") note = `警告=${res.warnings}`;
    rows.push({
      step: s.key,
      name: s.name,
      result: ok ? colorize("✅ PASS", "green") : colorize("❌ FAIL", "red"),
      exit: res.exitCode,
      note,
    });
  }
  printTable(rows, [
    { key: "step", label: "#" },
    { key: "name", label: "检查项" },
    { key: "result", label: "结果" },
    { key: "exit", label: "Exit", align: "right" },
    { key: "note", label: "备注" },
  ]);
  console.log("");
  const total = STEPS.length;
  console.log(
    `共 ${colorize(total, "cyan")} 项   ` +
      colorize(`通过 ${passed}`, "green") +
      `   ` +
      colorize(`失败 ${failed}`, failed === 0 ? "green" : "red")
  );
  const exitCode = failed === 0 ? 0 : 1;
  if (opts.cli !== false) process.exit(exitCode);
  return { exitCode, passed, failed, total, rows };
}

if (require.main === module) run();
module.exports = { run };
