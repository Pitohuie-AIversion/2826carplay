const fs = require("fs")
const path = require("path")
const { spawnSync } = require("child_process")

const PROJECT_ROOT = path.resolve(__dirname, "..")
const NOW = new Date("2026-10-25T00:00:00.000Z")
const configFor = (runtime) => ({ functions: [{ name: "example", runtime }] })
const check = (config, now = NOW) => require("../scripts/cloudRuntimeCheck").checkRuntimeConfiguration(config, now)

describe("offline deployment runtime lifecycle", () => {
  test.each([
    ["Nodejs16.13", "2023-09-11"],
    ["Nodejs18.15", "2025-04-30"],
    ["Nodejs20.19", "2026-04-30"],
    ["Nodejs22.21", "2027-04-30"],
    ["Nodejs24.11", "2028-04-30"]
  ])("%s is rejected from its EOL date (UTC) onward", (runtime, endOfLife) => {
    const boundary = new Date(`${endOfLife}T00:00:00.000Z`)
    expect(check(configFor(runtime), new Date(boundary.getTime() - 1)).exitCode).toBe(0)
    for (const now of [boundary, new Date(boundary.getTime() + 86400000)]) {
      expect(check(configFor(runtime), now)).toMatchObject({
        exitCode: 1,
        issues: [{ name: "example", runtime, code: "RUNTIME_EOL", endOfLife }]
      })
    }
  })

  test.each(["Nodejs16.13", "Nodejs18.15", "Nodejs20.19"])("rejects expired deployment target %s today", (runtime) => {
    expect(check(configFor(runtime)).issues[0].code).toBe("RUNTIME_EOL")
  })

  test.each(["Nodejs22.21", "Nodejs24.11"])("accepts registered and maintained target %s", (runtime) => {
    expect(check(configFor(runtime))).toMatchObject({ exitCode: 0, total: 1, issues: [] })
  })

  test.each(["Nodejs24.99", "Nodejs26.0", "node24", "Python3.11", "toString", 24, ["Nodejs24.11"]])("rejects an unreviewed or malformed runtime %j", (runtime) => {
    expect(check(configFor(runtime)).issues[0].code).toBe("RUNTIME_UNKNOWN")
  })

  test.each([undefined, null, "", "  "])("requires an explicit runtime rather than a provider default: %j", (runtime) => {
    expect(check(configFor(runtime)).issues[0].code).toBe("RUNTIME_MISSING")
  })

  test.each([null, {}, { functions: {} }, { functions: [] }, { functions: [null] }])("does not pass malformed deployment configuration %j", (config) => {
    expect(check(config).exitCode).toBe(1)
  })

  test("compares instants using UTC, independent of the machine timezone", () => {
    const config = configFor("Nodejs20.19")
    expect(check(config, new Date("2026-04-30T07:59:59.999+08:00")).exitCode).toBe(0)
    expect(check(config, new Date("2026-04-30T08:00:00.000+08:00")).issues[0].code).toBe("RUNTIME_EOL")
    expect(check(config, new Date("2026-04-29T17:00:00.000-07:00")).issues[0].code).toBe("RUNTIME_EOL")
  })

  test("an invalid clock cannot produce a passing check", () => {
    expect(check(configFor("Nodejs24.11"), new Date("invalid"))).toMatchObject({
      exitCode: 1, issues: [{ code: "CLOCK_INVALID" }]
    })
  })

  test("reports every affected function without changing deployment configuration", () => {
    const config = { functions: [
      { name: "legacy", runtime: "Nodejs20.19" },
      { name: "implicit" },
      { name: "ready", runtime: "Nodejs24.11" }
    ] }
    const before = JSON.stringify(config)
    expect(check(config)).toMatchObject({ total: 3, issues: [
      { name: "legacy", code: "RUNTIME_EOL" },
      { name: "implicit", code: "RUNTIME_MISSING" }
    ] })
    expect(JSON.stringify(config)).toBe(before)
  })

  test("the checked-in deployment target includes the upload gateway and only Node 24.11", () => {
    const config = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "cloudbaserc.json"), "utf8"))
    expect(check(config).exitCode).toBe(0)
    expect(new Set(config.functions.map((fn) => fn.runtime))).toEqual(new Set(["Nodejs24.11"]))
    expect(config.functions.find((fn) => fn.name === "adminImageUpload")).toMatchObject({
      type: "Event", handler: "index.main", runtime: "Nodejs24.11", timeout: 60, memorySize: 256
    })
  })
})

describe("runtime checks in the actual command paths", () => {
  let fixture
  beforeAll(() => {
    const cache = path.join(PROJECT_ROOT, "node_modules/.cache/development-round4")
    fs.mkdirSync(cache, { recursive: true })
    fixture = fs.mkdtempSync(path.join(cache, "runtime-check-"))
  })
  afterAll(() => {
    const cache = path.join(PROJECT_ROOT, "node_modules/.cache/development-round4") + path.sep
    if (!path.resolve(fixture).startsWith(cache)) throw new Error("Unexpected test fixture path")
    fs.rmSync(fixture, { recursive: true, force: true })
  })

  test.each([
    ["legacy", configFor("Nodejs20.19"), "RUNTIME_EOL"],
    ["unknown", configFor("Nodejs99.1"), "RUNTIME_UNKNOWN"],
    ["implicit", configFor(undefined), "RUNTIME_MISSING"],
    ["invalid JSON", "{", "CONFIG_READ_FAILED"]
  ])("the CLI exits nonzero for %s and leaves the file untouched", (_name, config, code) => {
    const source = typeof config === "string" ? config : JSON.stringify(config)
    const rcPath = path.join(fixture, "cloudbaserc.json")
    fs.writeFileSync(rcPath, source)
    const result = spawnSync(process.execPath, [path.join(PROJECT_ROOT, "scripts/cloudRuntimeCheck.js")], {
      cwd: fixture, encoding: "utf8"
    })
    expect(result.status).toBe(1)
    expect(result.stdout + result.stderr).toContain(code)
    expect(fs.readFileSync(rcPath, "utf8")).toBe(source)
  })

  test("the CLI fails if cloudbaserc is absent", () => {
    fs.rmSync(path.join(fixture, "cloudbaserc.json"), { force: true })
    const result = spawnSync(process.execPath, [path.join(PROJECT_ROOT, "scripts/cloudRuntimeCheck.js")], {
      cwd: fixture, encoding: "utf8"
    })
    expect(result.status).toBe(1)
    expect(result.stdout + result.stderr).toContain("CONFIG_INVALID")
  })
})

describe("sync and aggregate checks", () => {
  let previousRuntime
  beforeEach(() => {
    previousRuntime = process.env.CLOUD_DEFAULT_RUNTIME
    delete process.env.CLOUD_DEFAULT_RUNTIME
    jest.resetModules()
    jest.useFakeTimers().setSystemTime(NOW)
    jest.spyOn(console, "log").mockImplementation(() => {})
  })
  afterEach(() => {
    if (previousRuntime === undefined) delete process.env.CLOUD_DEFAULT_RUNTIME
    else process.env.CLOUD_DEFAULT_RUNTIME = previousRuntime
    jest.useRealTimers()
    jest.dontMock("../scripts/_cloudUtil")
    for (const name of ["cloudSdkCheck", "cloudNmCheck", "cloudRcSync", "cloudAuthAudit", "cloudSpecCheck"]) {
      jest.dontMock(`../scripts/${name}`)
    }
    jest.resetModules()
  })

  test("sync writes new functions using Node 24.11 while preserving existing settings", () => {
    const original = { name: "existing", runtime: "Nodejs24.11", timeout: 33, triggers: [{ name: "nightly" }] }
    const writeCloudbaserc = jest.fn()
    jest.doMock("../scripts/_cloudUtil", () => ({
      ...jest.requireActual("../scripts/_cloudUtil"),
      readCloudbaserc: () => ({ functions: [original] }),
      listCloudfunctions: () => [{ name: "existing" }, { name: "newFunction" }],
      writeCloudbaserc
    }))
    const result = require("../scripts/cloudRcSync").run({ cli: false, flags: { "--write": true } })
    expect(result.exitCode).toBe(0)
    expect(writeCloudbaserc).toHaveBeenCalledWith({ functions: [original, expect.objectContaining({
      name: "newFunction", runtime: "Nodejs24.11", type: "Event"
    })] })
  })

  test.each(["Nodejs16.13", "Nodejs18.15", "Nodejs20.19", "Nodejs99.1"])("sync refuses invalid override %s before writing", (runtime) => {
    process.env.CLOUD_DEFAULT_RUNTIME = runtime
    const writeCloudbaserc = jest.fn()
    jest.doMock("../scripts/_cloudUtil", () => ({
      ...jest.requireActual("../scripts/_cloudUtil"),
      readCloudbaserc: () => ({ functions: [] }),
      listCloudfunctions: () => [{ name: "newFunction" }],
      writeCloudbaserc
    }))
    expect(() => require("../scripts/cloudRcSync").run({ cli: false, flags: { "--write": true } })).toThrow(/RUNTIME_/)
    expect(writeCloudbaserc).not.toHaveBeenCalled()
  })

  test("cloudCheck cannot pass when all other checks pass but a runtime is expired", () => {
    jest.doMock("../scripts/_cloudUtil", () => ({
      ...jest.requireActual("../scripts/_cloudUtil"),
      readCloudbaserc: () => configFor("Nodejs20.19")
    }))
    const passing = { exitCode: 0, missing: [], extra: [], unexpected: [] }
    for (const name of ["cloudSdkCheck", "cloudNmCheck", "cloudRcSync", "cloudAuthAudit", "cloudSpecCheck"]) {
      jest.doMock(`../scripts/${name}`, () => ({ run: () => passing }))
    }
    const result = require("../scripts/cloudCheck").run({ cli: false })
    expect(result).toMatchObject({ exitCode: 1, passed: 5, failed: 1, total: 6 })
    expect(result.rows).toContainEqual(expect.objectContaining({ step: "RUNTIME", exit: 1 }))
  })
})
