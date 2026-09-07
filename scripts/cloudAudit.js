const fs = require("fs");
const path = require("path");
const child = require("child_process");
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
  let pass = 0;
  let fail = 0;
  let skip = 0;
  console.log(colorize("【云端·56 函数 npm audit 串行执行（critical 及以上）】", "bold"));
  console.log(colorize("（逐函数串行，避免并发 spawn 过多导致 Windows 报错）", "gray"));
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const lock = path.join(it.dir, "package-lock.json");
    if (!fs.existsSync(lock)) {
      rows.push({ name: it.name, result: colorize("⚠️ NO LOCK", "yellow") });
      skip++;
      continue;
    }
    let ok = false;
    let note = "";
    try {
      child.execSync(
        'npm audit --package-lock-only --omit=dev --audit-level=critical --prefix "' +
          it.dir.replace(/"/g, '""') +
          '"',
        { stdio: "pipe", encoding: "utf8", timeout: 60000 }
      );
      ok = true;
    } catch (e) {
      ok = false;
      const m = String(e.stdout || e.stderr || "").match(/(\d+)\s+(critical|high|moderate|low)/g);
      note = m ? m.join(" ") : "漏洞";
    }
    if (ok) {
      rows.push({ name: it.name, result: colorize("✅ PASS", "green") });
      pass++;
    } else {
      rows.push({ name: it.name, result: colorize("❌ FAIL " + note, "red") });
      fail++;
    }
    if ((i + 1) % 8 === 0) {
      process.stdout.write(
        colorize(`  progress ${i + 1}/${items.length}   pass=${pass}  fail=${fail}  skip=${skip}\n`, "gray")
      );
    }
  }
  printTable(rows, [
    { key: "name", label: "函数名" },
    { key: "result", label: "audit 结果" },
  ]);
  summarize("npm audit", items.length, pass, fail, colorize(`  无 lock 跳过 ${skip}`, "yellow"));
  const exitCode = fail > 0 ? 1 : 0;
  if (opts.cli !== false) process.exit(exitCode);
  return { exitCode, pass, fail, skip, total: items.length };
}

if (require.main === module) run();
module.exports = { run };
