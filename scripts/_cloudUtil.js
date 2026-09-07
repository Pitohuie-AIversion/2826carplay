const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = process.cwd();
const CF_ROOT = path.join(PROJECT_ROOT, "cloudfunctions");
const RC_PATH = path.join(PROJECT_ROOT, "cloudbaserc.json");

const COLORS = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  gray: "\x1b[90m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
};

const colorize = (text, color) => `${COLORS[color] || ""}${text}${COLORS.reset}`;

function parseArgs(argv) {
  const raw = argv.slice(2);
  const flags = {};
  const positionals = [];
  for (const a of raw) {
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > 0) {
        flags[a.slice(0, eq)] = a.slice(eq + 1);
      } else {
        flags[a] = true;
      }
    } else {
      positionals.push(a);
    }
  }
  return { flags, positionals };
}

function pad(str, width, align = "left") {
  const s = String(str == null ? "" : str);
  const len = s.length;
  if (len >= width) return s;
  const pad = " ".repeat(width - len);
  return align === "right" ? pad + s : s + pad;
}

function printTable(rows, cols) {
  if (!rows || rows.length === 0) {
    console.log(colorize("（无数据）", "gray"));
    return;
  }
  const widths = cols.map((c) => {
    const headerLen = String(c.label || c.key).length;
    let max = headerLen;
    for (const r of rows) {
      const v = String(r[c.key] == null ? "" : r[c.key]);
      if (v.length > max) max = v.length;
    }
    return max + 2;
  });
  const top =
    "┌" + widths.map((w) => "─".repeat(w)).join("┬") + "┐";
  const sep =
    "├" + widths.map((w) => "─".repeat(w)).join("┼") + "┤";
  const bot =
    "└" + widths.map((w) => "─".repeat(w)).join("┴") + "┘";
  const headerRow =
    "│" +
    cols
      .map((c, i) => pad(colorize(c.label || c.key, "cyan"), widths[i]))
      .join("│") +
    "│";
  console.log(top);
  console.log(headerRow);
  console.log(sep);
  for (const r of rows) {
    const line =
      "│" +
      cols
        .map((c, i) => {
          const raw = r[c.key] == null ? "" : String(r[c.key]);
          let v = raw;
          if (c.colorize) v = c.colorize(raw, r);
          return pad(v, widths[i], c.align || "left");
        })
        .join("│") +
      "│";
    console.log(line);
  }
  console.log(bot);
}

function summarize(title, total, passed, failed, extra) {
  const parts = [
    colorize(`【${title}】`, "bold"),
    `共 ${colorize(total, "cyan")} 项`,
    colorize(`通过 ${passed}`, "green"),
  ];
  if (failed > 0) parts.push(colorize(`失败 ${failed}`, "red"));
  if (extra) parts.push(extra);
  console.log("");
  console.log(parts.join("  "));
}

function listCloudfunctions() {
  if (!fs.existsSync(CF_ROOT)) {
    throw new Error(`cloudfunctions 目录不存在：${CF_ROOT}`);
  }
  const names = fs
    .readdirSync(CF_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  const items = [];
  for (const name of names) {
    const dir = path.join(CF_ROOT, name);
    const pkgPath = path.join(dir, "package.json");
    const idxPath = path.join(dir, "index.js");
    const hasPkg = fs.existsSync(pkgPath);
    const hasIdx = fs.existsSync(idxPath);
    let pkgJson = null;
    if (hasPkg) {
      try {
        pkgJson = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      } catch (e) {
        pkgJson = { _parseError: e.message };
      }
    }
    let lines = 0;
    let logs = 0;
    if (hasIdx) {
      const src = fs.readFileSync(idxPath, "utf8");
      lines = src.split(/\r?\n/).length;
      const m = src.match(/console\.(log|warn|error|info|debug)\s*\(/g);
      logs = m ? m.length : 0;
    }
    const hasNm = fs.existsSync(path.join(dir, "node_modules"));
    items.push({
      name,
      dir,
      pkgPath,
      idxPath,
      hasPkg,
      hasIdx,
      pkgJson,
      lines,
      logs,
      hasNm,
    });
  }
  return items;
}

function readCloudbaserc() {
  if (!fs.existsSync(RC_PATH)) return null;
  return JSON.parse(fs.readFileSync(RC_PATH, "utf8"));
}

function writeCloudbaserc(rc) {
  fs.writeFileSync(RC_PATH, JSON.stringify(rc, null, 2) + "\n", "utf8");
}

function delDirIfExists(p) {
  if (fs.existsSync(p)) {
    fs.rmSync(p, { recursive: true, force: true });
    return true;
  }
  return false;
}

async function runInBand(items, fn, concurrency = 1) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    const chunkRes = await Promise.all(chunk.map((it) => fn(it)));
    results.push(...chunkRes);
  }
  return results;
}

module.exports = {
  PROJECT_ROOT,
  CF_ROOT,
  RC_PATH,
  colorize,
  parseArgs,
  printTable,
  summarize,
  listCloudfunctions,
  readCloudbaserc,
  writeCloudbaserc,
  delDirIfExists,
  runInBand,
};
