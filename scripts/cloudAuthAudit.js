const fs = require("fs");
const {
  parseArgs,
  printTable,
  listCloudfunctions,
  colorize,
} = require("./_cloudUtil");

const EXPECTED_PUBLIC = new Set([
  "contentGuideDetail",
  "contentGuideList",
  "garageVehicleList",
  "operationConfigGet",
  "vehiclePublicDetail",
]);

const EXPECTED_PUBLIC_DESC = {
  contentGuideDetail: "公开展示的驾驶指引详情（无需鉴权）",
  contentGuideList: "公开展示的驾驶指引列表（无需鉴权）",
  garageVehicleList: "公开展示的车库车辆列表（无需鉴权）",
  operationConfigGet: "公开展示的运营配置获取（无需鉴权）",
  vehiclePublicDetail: "公开展示的车辆详情（无需鉴权）",
};

const AUTH_PATTERN =
  /getWXContext|OPENID|verifyAdminPermission|checkPermission|requireAdminRole|getMyPermissions|adminPermission|isAdmin/i;

function run(opts = {}) {
  const _ = opts.cli !== false ? parseArgs(process.argv) : null;
  const items = listCloudfunctions();
  const expRows = [];
  const unexpRows = [];
  const authed = [];
  for (const it of items) {
    let src = "";
    if (it.hasIdx) src = fs.readFileSync(it.idxPath, "utf8");
    const hit = AUTH_PATTERN.test(src);
    if (hit) {
      authed.push(it.name);
      continue;
    }
    if (EXPECTED_PUBLIC.has(it.name)) {
      expRows.push({ name: it.name, note: EXPECTED_PUBLIC_DESC[it.name] || "白名单" });
    } else {
      unexpRows.push({ name: it.name, note: colorize("⚠️ 未在白名单，且无 AUTH 命中", "red") });
    }
  }
  console.log(colorize("【云端·权限校验审计】", "bold"));
  console.log("");
  console.log(colorize("── EXPECTED_PUBLIC（显式允许公开，白名单） ──", "green"));
  const expCols = [
    { key: "name", label: "函数名" },
    { key: "note", label: "说明" },
  ];
  if (expRows.length > 0) printTable(expRows, expCols);
  else console.log(colorize("  （无）", "gray"));
  console.log("");
  console.log(colorize("── UNEXPECTED_PUBLIC（疑似漏洞） ──", unexpRows.length === 0 ? "green" : "red"));
  if (unexpRows.length > 0) printTable(unexpRows, expCols);
  else console.log(colorize("  🎉 0 个非预期公开函数", "green"));
  console.log("");
  console.log(
    `共 ${colorize(items.length, "cyan")}   ` +
      colorize(`已鉴权=${authed.length}`, "cyan") +
      `   ` +
      colorize(`白名单公开=${expRows.length}`, "green") +
      `   ` +
      colorize(`非预期=${unexpRows.length}`, unexpRows.length === 0 ? "green" : "red")
  );
  const exitCode = unexpRows.length === 0 ? 0 : 1;
  if (opts.cli !== false) process.exit(exitCode);
  return { exitCode, expected: expRows.map((r) => r.name), unexpected: unexpRows.map((r) => r.name), authedCount: authed.length, total: items.length };
}

if (require.main === module) run();
module.exports = { run, EXPECTED_PUBLIC };
