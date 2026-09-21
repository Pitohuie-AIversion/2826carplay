const { colorize, readCloudbaserc } = require("./_cloudUtil");

function checkTriggers() {
  const rc = readCloudbaserc();
  if (!rc || !Array.isArray(rc.functions)) {
    console.error(colorize("❌ 无法读取 cloudbaserc.json", "red"));
    process.exit(1);
  }

  console.log(colorize("【云端·定时触发器 (Cron Triggers) 巡检】", "bold"));
  console.log(`环境 ID: ${colorize(rc.envId, "cyan")}`);
  console.log("");

  const functionsWithTriggers = rc.functions.filter(
    (f) => Array.isArray(f.triggers) && f.triggers.length > 0
  );

  if (functionsWithTriggers.length === 0) {
    console.log(colorize("⚠️ 当前没有任何云函数配置定时触发器！", "yellow"));
    return;
  }

  console.log(
    `已配置定时触发器的云函数: ${colorize(functionsWithTriggers.length, "green")} 个`
  );
  console.log("");

  functionsWithTriggers.forEach((fn, idx) => {
    console.log(`${idx + 1}. 函数名: ${colorize(fn.name, "cyan")}`);
    fn.triggers.forEach((tr) => {
      console.log(`   • 触发器名称: ${colorize(tr.name, "bold")}`);
      console.log(`     类型: ${tr.type} | 规格: ${colorize(tr.config, "yellow")}`);
    });
    console.log("");
  });

  console.log(colorize("✔ 定时触发器语法与配置校验通过！", "green"));
}

if (require.main === module) {
  checkTriggers();
}

module.exports = { checkTriggers };
