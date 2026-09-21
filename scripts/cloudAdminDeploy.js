const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { colorize, readCloudbaserc, parseArgs } = require("./_cloudUtil");

function deployAdmin() {
  const { flags } = parseArgs(process.argv);
  const isDryRun = !!flags["--dry"] || !!flags["--dry-run"];
  
  const projectRoot = path.resolve(__dirname, "..");
  const adminHtmlPath = path.join(projectRoot, "web-admin", "index.html");
  
  if (!fs.existsSync(adminHtmlPath)) {
    console.error(colorize("❌ 找不到 web-admin/index.html 文件", "red"));
    process.exit(1);
  }

  const stat = fs.statSync(adminHtmlPath);
  const sizeKb = (stat.size / 1024).toFixed(2);
  
  const rc = readCloudbaserc();
  const envId = rc && rc.envId ? rc.envId : "cloud1-d8gtmns36320e045e";

  console.log(colorize("【云端·静态托管 Web 运营后台部署】", "bold"));
  console.log(`目标环境: ${colorize(envId, "cyan")}`);
  console.log(`源文件: web-admin/index.html (${sizeKb} KB)`);
  console.log(`模式: ${isDryRun ? colorize("DRY-RUN（仅模拟，不执行上传）", "yellow") : colorize("DEPLOY（真正上传到云端）", "green")}`);
  console.log("");

  if (isDryRun) {
    console.log(colorize("ℹ️ dry-run 检查通过。若要真正发布到静态托管，请运行：", "gray"));
    console.log(colorize("    node scripts/cloudAdminDeploy.js --apply", "cyan"));
    return;
  }

  try {
    console.log("🚀 正在上传主入口 index.html 到静态托管根目录...");
    const cmd1 = `tcb hosting deploy "${adminHtmlPath}" index.html -e ${envId}`;
    execSync(cmd1, { stdio: "inherit", cwd: projectRoot });

    console.log("\n🚀 正在同步发布到 /admin/index.html 备用路由...");
    const cmd2 = `tcb hosting deploy "${adminHtmlPath}" admin/index.html -e ${envId}`;
    execSync(cmd2, { stdio: "inherit", cwd: projectRoot });

    console.log(colorize("\n🎉 部署成功！", "green"));
    console.log(`访问地址：${colorize(`https://${envId}-1451689651.tcloudbaseapp.com/`, "cyan")}`);
    console.log(`管理路由：${colorize(`https://${envId}-1451689651.tcloudbaseapp.com/admin/`, "cyan")}`);
  } catch (err) {
    console.error(colorize(`❌ 部署失败: ${err.message}`, "red"));
    process.exit(1);
  }
}

if (require.main === module) {
  deployAdmin();
}

module.exports = { deployAdmin };
