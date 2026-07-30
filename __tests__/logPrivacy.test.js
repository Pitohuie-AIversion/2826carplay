const fs = require("fs")
const path = require("path")

function readCloudFunction(name) {
  return fs.readFileSync(
    path.join(__dirname, "..", "cloudfunctions", name, "index.js"),
    "utf8"
  )
}

describe("cloud function log privacy", () => {
  test("booking status errors do not persist the normalized request object", () => {
    const source = readCloudFunction("bookingUpdateStatus")

    expect(source).not.toMatch(/\n\s*input,\s*\n/)
  })

  test("vehicle deletion errors do not persist the raw event", () => {
    const source = readCloudFunction("vehicleDelete")

    expect(source).not.toMatch(/\binput:\s*event\b/)
  })

  test.each(["vehicleDelete", "vehicleImageUpdate"])(
    "%s does not print full file IDs when cloud deletion fails",
    (functionName) => {
      const source = readCloudFunction(functionName)

      expect(source).not.toMatch(/fileCount:\s*list\.length,\s*fileList:\s*list,/)
    }
  )
})
