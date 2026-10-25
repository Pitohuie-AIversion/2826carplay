const fs = require("fs")
const os = require("os")
const path = require("path")
const { spawnSync } = require("child_process")
const { WARNING_LIMIT_BYTES, HARD_LIMIT_BYTES } = require("../scripts/checkMiniProgramPackage")

describe("standalone package gate", () => {
  test.each([
    [WARNING_LIMIT_BYTES - 1, 0],
    [WARNING_LIMIT_BYTES, 1],
    [WARNING_LIMIT_BYTES + 1024, 1],
    [HARD_LIMIT_BYTES, 1]
  ])("main package at %i bytes exits with %i", (bytes, exitCode) => {
    const tempRoot = path.resolve(os.tmpdir())
    const fixture = fs.mkdtempSync(path.join(tempRoot, "2826-package-budget-"))
    try {
      fs.mkdirSync(path.join(fixture, "scripts"))
      const script = path.join(fixture, "scripts", "checkMiniProgramPackage.js")
      fs.copyFileSync(path.resolve(__dirname, "../scripts/checkMiniProgramPackage.js"), script)
      fs.writeFileSync(path.join(fixture, "project.config.json"), JSON.stringify({
        packOptions: { ignore: [{ type: "folder", value: "scripts" }] }
      }))
      fs.writeFileSync(path.join(fixture, "app.json"), "{}")
      fs.writeFileSync(path.join(fixture, "bundle.js"), Buffer.alloc(bytes - 2, 32))
      const result = spawnSync(process.execPath, [script], { encoding: "utf8" })

      expect(result.error).toBeUndefined()
      expect(result.status).toBe(exitCode)
      if (exitCode) expect(result.stderr).toMatch(/1\.75 MiB|2 MiB/)
    } finally {
      const resolvedFixture = path.resolve(fixture)
      if (path.dirname(resolvedFixture) !== tempRoot || !path.basename(resolvedFixture).startsWith("2826-package-budget-")) {
        throw new Error("Unexpected package test fixture path")
      }
      fs.rmSync(resolvedFixture, { recursive: true, force: true })
    }
  })
})
