const fs = require("fs")
const path = require("path")

// Cloud functions are deployed independently and cannot import shared/ at runtime.
const root = path.resolve(__dirname, "..")
const modelTargets = ["vehicleCreate", "vehicleUpdate", "vehicleList"]
const pricingTargets = modelTargets.concat(["vehicleAvailabilityCheck", "vehiclePublicDetail", "bookingDetail"])
for (const name of pricingTargets) {
  fs.copyFileSync(path.join(root, "shared/rentalPricing.js"), path.join(root, "cloudfunctions", name, "rentalPricing.js"))
}
for (const name of modelTargets) {
  fs.copyFileSync(path.join(root, "shared/vehicle.js"), path.join(root, "cloudfunctions", name, "vehicle.js"))
}
