const { readCloudbaserc, colorize } = require("./_cloudUtil");

const DEFAULT_RUNTIME = "Nodejs24.11";

// Offline policy reviewed 2026-10-25. Provider availability is not upstream support.
// Runtime identifiers: https://docs.cloudbase.net/cloud-function/runtime-support
// Node.js EOL dates: https://github.com/nodejs/Release/blob/main/schedule.json
// New runtimes require a deliberate review here; never infer support from a major number.
const RUNTIME_END_OF_LIFE = Object.freeze({
  "Nodejs16.13": "2023-09-11",
  "Nodejs18.15": "2025-04-30",
  "Nodejs20.19": "2026-04-30",
  "Nodejs22.21": "2027-04-30",
  "Nodejs24.11": "2028-04-30",
});

function checkRuntimeConfiguration(rc, now = new Date()) {
  const issues = [];
  const functions = rc && Array.isArray(rc.functions) ? rc.functions : [];
  const validClock = now instanceof Date && Number.isFinite(now.getTime());
  const checkedOn = validClock ? now.toISOString().slice(0, 10) : "";
  if (!validClock) {
    issues.push({ code: "CLOCK_INVALID", message: "检查时间无效，不能确认运行时维护状态" });
  } else if (!functions.length) {
    issues.push({ code: "CONFIG_INVALID", message: "cloudbaserc.json 必须包含非空 functions 数组" });
  } else {
    functions.forEach((fn, index) => {
      const name = fn && typeof fn.name === "string" ? fn.name : `functions[${index}]`;
      const runtime = fn && fn.runtime;
      if (runtime == null || (typeof runtime === "string" && !runtime.trim())) {
        issues.push({ name, runtime, code: "RUNTIME_MISSING", message: "必须显式配置 runtime，不能依赖平台默认版本" });
        return;
      }
      if (typeof runtime !== "string" || !Object.prototype.hasOwnProperty.call(RUNTIME_END_OF_LIFE, runtime)) {
        issues.push({ name, runtime, code: "RUNTIME_UNKNOWN", message: "运行时尚未登记，请核对官方支持及维护期限后更新策略" });
        return;
      }
      const endOfLife = RUNTIME_END_OF_LIFE[runtime];
      // Conservative project policy: block from 00:00 UTC on the published EOL date.
      if (checkedOn >= endOfLife) {
        issues.push({ name, runtime, code: "RUNTIME_EOL", endOfLife, message: `Node.js 已到维护截止日期 ${endOfLife}` });
      }
    });
  }
  return { exitCode: issues.length ? 1 : 0, total: functions.length, checkedOn, issues };
}

function run(opts = {}) {
  let result;
  try {
    result = checkRuntimeConfiguration(readCloudbaserc(), opts.now);
  } catch (error) {
    result = { exitCode: 1, total: 0, checkedOn: "", issues: [{
      code: "CONFIG_READ_FAILED", message: `无法读取部署配置：${error && error.message || error}`,
    }] };
  }
  console.log(colorize("【本地部署目标·运行时生命周期检查】", "bold"));
  console.log(`UTC 日期=${result.checkedOn || "不可用"} 函数=${result.total} 问题=${result.issues.length}`);
  for (const issue of result.issues) {
    console.log(colorize(`  ${issue.code} ${issue.name || "cloudbaserc.json"}: ${issue.message}`, "red"));
  }
  if (!result.issues.length) console.log(colorize("所有部署目标均已登记且未到 Node.js 维护截止日期", "green"));
  if (opts.cli !== false) process.exit(result.exitCode);
  return result;
}

if (require.main === module) run();
module.exports = { run, checkRuntimeConfiguration, DEFAULT_RUNTIME };
