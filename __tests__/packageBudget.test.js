const fs = require("fs")
const path = require("path")
const {
  HARD_LIMIT_BYTES,
  WARNING_LIMIT_BYTES,
  calculatePackageFootprint
} = require("../scripts/checkMiniProgramPackage")

const PROJECT_ROOT = path.resolve(__dirname, "..")

describe("mini program package budget", () => {
  test("当前估算主包低于预警线并保留发布余量", () => {
    const result = calculatePackageFootprint(PROJECT_ROOT)

    expect(result.status).toBe("pass")
    expect(result.totalBytes).toBeLessThan(WARNING_LIMIT_BYTES)
    expect(result.totalBytes).toBeLessThan(HARD_LIMIT_BYTES)
    expect(result.remainingBytes).toBeGreaterThan(0)
    expect(result.fileCount).toBeGreaterThan(0)
  })

  test("云函数、测试、规则和开发工具不计入小程序主包", () => {
    const result = calculatePackageFootprint(PROJECT_ROOT)
    const includedPaths = result.files.map((item) => item.path)

    expect(includedPaths.some((item) => item.startsWith("cloudfunctions/"))).toBe(false)
    expect(includedPaths.some((item) => item.startsWith("__tests__/"))).toBe(false)
    expect(includedPaths.some((item) => item.startsWith("security-rules/"))).toBe(false)
    expect(includedPaths.some((item) => item.startsWith("scripts/"))).toBe(false)
    expect(includedPaths).not.toContain("package-lock.json")
    expect(includedPaths).not.toContain("DEPLOY_CHECKLIST.md")
    expect(includedPaths).not.toContain(".trae_preview.txt")
    expect(includedPaths).not.toContain(".trae_preview.jpg")
    expect(includedPaths).not.toContain("data/cars.js")
    expect(includedPaths.some((item) => item.startsWith("assets/cars/"))).toBe(false)
    expect(includedPaths).not.toContain("ganlan_garage_project_docs_v2.zip")
    expect(includedPaths).not.toContain("vehicleImageUpdate.zip")
  })

  test("运行时代码不依赖已排除的本地示例车辆数据", () => {
    const runtimeRoots = ["app.js", "pages", "pages-admin", "components", "shared"]
    const sourceFiles = []
    const collect = (target) => {
      const absolutePath = path.join(PROJECT_ROOT, target)
      const stat = fs.statSync(absolutePath)
      if (stat.isFile()) {
        sourceFiles.push(absolutePath)
        return
      }
      fs.readdirSync(absolutePath, { withFileTypes: true })
        .forEach((entry) => {
          if (entry.isDirectory()) {
            collect(path.join(target, entry.name))
          } else if (entry.isFile() && /\.(?:js|json|wxml|wxss)$/.test(entry.name)) {
            sourceFiles.push(path.join(absolutePath, entry.name))
          }
        })
    }
    runtimeRoots.forEach(collect)
    const violations = sourceFiles
      .filter((filePath) => {
        const source = fs.readFileSync(filePath, "utf8")
        return /data[\\/]cars|assets[\\/]cars/.test(source)
      })
      .map((filePath) => path.relative(PROJECT_ROOT, filePath).replace(/\\/g, "/"))

    expect(violations).toEqual([])
  })

  test("容量报告按文件大小列出主要占用项", () => {
    const result = calculatePackageFootprint(PROJECT_ROOT)

    expect(result.largestFiles.length).toBeGreaterThan(0)
    expect(result.largestFiles.length).toBeLessThanOrEqual(10)
    result.largestFiles.forEach((item, index) => {
      expect(item.bytes).toBeGreaterThan(0)
      if (index > 0) {
        expect(item.bytes).toBeLessThanOrEqual(result.largestFiles[index - 1].bytes)
      }
    })
  })

  test("极境车库品牌徽标兼顾清晰度与主包体积", () => {
    const emblemPath = path.join(PROJECT_ROOT, "assets", "icons", "jijing-garage-emblem.png")
    const emblem = fs.readFileSync(emblemPath)

    expect(emblem.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a")
    expect(emblem.readUInt32BE(16)).toBe(384)
    expect(emblem.readUInt32BE(20)).toBe(384)
    expect(emblem[24]).toBe(8)
    expect(emblem[25]).toBe(3)
    expect(emblem.length).toBeGreaterThan(80 * 1024)
    expect(emblem.length).toBeLessThanOrEqual(100 * 1024)
  })
})
