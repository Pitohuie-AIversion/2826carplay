jest.mock("child_process", () => ({ spawnSync: jest.fn(), execSync: jest.fn() }))

const fs = require("fs")
const path = require("path")
const { spawnSync } = require("child_process")
const { runDeployment, planDeployment } = require("../scripts/deployAll")
const cachePath = path.join(process.cwd(), ".cloudbase_deploy_cache.json")

describe("deployment command scope and invalid arguments", () => {
  let cacheExists
  beforeEach(() => {
    cacheExists = false
    spawnSync.mockReset().mockReturnValue({ status: 0, stdout: "mock CLI", stderr: "" })
    const exists = fs.existsSync.bind(fs)
    const read = fs.readFileSync.bind(fs)
    jest.spyOn(fs, "existsSync").mockImplementation((file) => file === cachePath ? cacheExists : exists(file))
    jest.spyOn(fs, "readFileSync").mockImplementation((file, ...args) => file === cachePath ? '{"version":"1.0.0","environments":{}}' : read(file, ...args))
    jest.spyOn(fs, "writeFileSync").mockImplementation(() => {})
    jest.spyOn(fs, "unlinkSync").mockImplementation(() => {})
    jest.spyOn(console, "log").mockImplementation(() => {})
    jest.spyOn(process.stdout, "write").mockImplementation(() => true)
  })
  afterEach(() => jest.restoreAllMocks())

  const run = (...args) => runDeployment(["node", "deployAll.js", ...args])

  test.each([
    ["--fn"], ["--fn="], ["--fn=adminImageUpload,unknownFunction"],
    ["--env"], ["--env="], ["--env", "sandbox"], ["--env=sandbox&whoami"],
    ["--functions-only", "--admin-only"], ["--fn=adminImageUpload", "--rules-only"],
    ["--apply=false"], ["--dry", "--apply"], ["--function-only"]
  ])("invalid selection %j fails before any subprocess or cache mutation", async (...args) => {
    cacheExists = true
    const result = await run("--clean-cache", ...args)
    expect(result).toMatchObject({ ok: false, exitCode: 1 })
    expect(spawnSync).not.toHaveBeenCalled()
    expect(fs.unlinkSync).not.toHaveBeenCalled()
    expect(fs.writeFileSync).not.toHaveBeenCalled()
  })

  test("selecting one function only deploys that function, with no hosting commands", async () => {
    const result = await run("--apply", "--fn=adminImageUpload", "--env=sandbox")
    expect(result).toMatchObject({ ok: true, exitCode: 0 })
    expect(result.plan.selected).toBe(1)
    const commands = spawnSync.mock.calls.map(([command]) => command)
    expect(commands.filter((command) => command.includes("fn deploy"))).toEqual(['tcb fn deploy "adminImageUpload" -e "sandbox" --force'])
    expect(commands.some((command) => command.includes("hosting deploy"))).toBe(false)
  })

  test("dry-run clean-cache ignores fingerprints without deleting local history", async () => {
    cacheExists = true
    const result = await run("--clean-cache", "--fn=adminImageUpload")
    expect(result).toMatchObject({ ok: true, exitCode: 0 })
    expect(fs.unlinkSync).not.toHaveBeenCalled()
    expect(fs.writeFileSync).not.toHaveBeenCalled()
    expect(result.plan.toDeploy).toHaveLength(1)
    expect(spawnSync.mock.calls.map(([command]) => command)).toEqual(["tcb -v"])
  })

  test("a failed preflight produces a failed dry-run instead of a passing summary", async () => {
    spawnSync.mockReturnValue({ status: 1, stderr: "CLI missing" })
    expect(await run("--fn=adminImageUpload")).toMatchObject({ ok: false, exitCode: 1 })
    expect(fs.writeFileSync).not.toHaveBeenCalled()
  })

  test("dry-run apply instructions retain the reviewed environment and scope", async () => {
    expect(await run("--env=sandbox", "--fn=adminImageUpload", "--force")).toMatchObject({ ok: true })
    const messages = console.log.mock.calls.map(([message]) => String(message))
    const commands = messages.filter((message) => message.includes("node scripts/deployAll.js --apply"))
    expect(commands).toHaveLength(1)
    expect(commands[0]).toContain("--apply --env=sandbox --fn=adminImageUpload --force")
  })

  test.each([[[]], [["unknownFunction"]], [["adminImageUpload", "unknownFunction"]]])("programmatic plan rejects an invalid explicit allowlist %j", (selection) => {
    expect(() => planDeployment({ targetFunctions: selection, cache: { environments: {} } })).toThrow()
  })
})
