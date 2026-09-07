const { colorize } = require("./_cloudUtil");
const { run: sdk } = require("./cloudSdkCheck");
const { run: nm } = require("./cloudNmCheck");
const { run: rc } = require("./cloudRcSync");
const { run: auth } = require("./cloudAuthAudit");
const { run: spec } = require("./cloudSpecCheck");
require("./cloudHelp");

console.log("");
console.log(colorize("━━━ SMOKE 全部云端 CLI 命令（除 cloud:audit npm audit 耗时跳过） ━━━", "bold"));
const stages = [
  ["cloud:sdk:check", () => sdk({ cli: false })],
  ["cloud:nm:check", () => {
    const r = nm({ cli: false });
    if (r.exitCode !== 0) {
      console.log(colorize("⚠️  存在 node_modules 残留，建议先执行：npm run cloud:nm:clean -- --apply", "yellow"));
    }
    return r;
  }],
  ["cloud:rc:sync --dry", () => rc({ cli: false, flags: { "--dry": true } })],
  ["cloud:auth:audit", () => auth({ cli: false })],
  ["cloud:spec:check", () => spec({ cli: false })],
];
let ng = 0;
for (const [name, fn] of stages) {
  let res;
  try {
    res = fn();
  } catch (e) {
    res = { exitCode: 99, error: String(e.message || e) };
  }
  const ok = res.exitCode === 0;
  if (!ok) ng++;
  console.log(
    `  ${name.padEnd(26, " ")}  =>  ${
      ok ? colorize("✅ PASS exit=0", "green") : colorize(`❌ FAIL exit=${res.exitCode}`, "red")
    }  ${res.error ? "  " + res.error : ""}`
  );
}
console.log("");
if (ng === 0) {
  console.log(colorize("🎉 SMOKE 全部通过", "green"));
  process.exit(0);
} else {
  console.log(colorize(`❌ SMOKE 失败：${ng} 项 NG`, "red"));
  process.exit(1);
}
