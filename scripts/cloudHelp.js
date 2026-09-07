const { colorize } = require("./_cloudUtil");

const CMDS = [
  ["cloud:audit", "对 56 个云函数逐个执行 npm audit --audit-level=critical 依赖漏洞审计"],
  ["cloud:sdk:check", "检查 56 个云函数 wx-server-sdk 版本是否与 target（默认 4.0.2）一致", "可选 --target=4.0.2"],
  ["cloud:sdk:bump", "批量升级 56 个云函数 wx-server-sdk 版本", "必选 --target=VER；默认 dry-run，需显式 --write 才真正写入 package.json"],
  ["cloud:nm:check", "检查 56 个云函数下是否存在 node_modules 残留"],
  ["cloud:nm:clean", "删除 56 个云函数下残留的 node_modules 目录", "默认 dry-run，需显式 --apply 才真正删除"],
  ["cloud:rc:sync", "核对 cloudbaserc.json functions 条目与 cloudfunctions/ 目录双向一致性", "默认 --dry；需 --write 才按默认规格补齐缺失条目"],
  ["cloud:auth:audit", "审计 56 个云函数权限校验代码，EXPECTED_PUBLIC 白名单 vs UNEXPECTED_PUBLIC"],
  ["cloud:spec:check", "输出 56 云函数规格体检表（代码行数/日志数/timeout/memorySize/建议）"],
  ["cloud:check", "一键汇总 SDK+NM+RC+AUTH 四项检查（不跑耗时的 cloud:audit）"],
  ["cloud:help", "输出本帮助"],
];

console.log(colorize("【云端管理 CLI · 命令帮助】", "bold"));
console.log("");
for (const [name, desc, extra] of CMDS) {
  console.log(`  ${colorize("npm run " + name, "cyan")}`);
  console.log(`      ${desc}`);
  if (extra) console.log(`      ${colorize(extra, "yellow")}`);
  console.log("");
}
console.log(
  colorize(
    "通用约定：默认 dry-run 防误改；涉及写入的命令必须显式加 --write / --apply。退出码 0=PASS / 1=NG / 2=参数错误。",
    "gray"
  )
);
