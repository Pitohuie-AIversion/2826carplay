const fs = require("fs")
const path = require("path")

const CLOUD_FUNCTION_ROOT = path.join(__dirname, "..", "cloudfunctions")

function readCloudFunctionSources() {
  return fs
    .readdirSync(CLOUD_FUNCTION_ROOT)
    .map((name) => ({
      name,
      filePath: path.join(CLOUD_FUNCTION_ROOT, name, "index.js")
    }))
    .filter((item) => fs.existsSync(item.filePath))
    .map((item) => ({
      name: item.name,
      source: fs.readFileSync(item.filePath, "utf8")
    }))
}

describe("role query privacy", () => {
  test("every current-user role lookup applies the authentication field allowlist", () => {
    const roleSources = readCloudFunctionSources().filter((item) =>
      item.source.includes('.collection("roles")') && item.source.includes(".where({ openid })")
    )

    expect(roleSources.length).toBeGreaterThanOrEqual(32)
    roleSources.forEach((item) => {
      const compact = item.source.replace(/\s+/g, " ")
      expect(compact).toContain(
        '.collection("roles") .where({ openid }) .field(AUTH_ROLE_FIELDS) .limit(20) .get()'
      )
    })
  })

  test("authentication field allowlists exclude identity and audit metadata", () => {
    const roleSources = readCloudFunctionSources().filter((item) =>
      item.source.includes("const AUTH_ROLE_FIELDS")
    )

    expect(roleSources.length).toBeGreaterThanOrEqual(32)
    roleSources.forEach((item) => {
      const fieldBlock = item.source.match(/const AUTH_ROLE_FIELDS = \{([\s\S]*?)\n\}/)
      expect(fieldBlock).not.toBeNull()
      expect(fieldBlock[1]).not.toMatch(/openid|createdByOpenid|updatedByOpenid|createdAt|updatedAt/)
      expect(fieldBlock[1]).toMatch(/role:\s*true/)
      expect(fieldBlock[1]).toMatch(/permissions:\s*true/)
    })
  })
})
