// Pass a fixed operation label only; raw errors can contain customer or request data.
function reportDiagnostic(label) {
  try {
    if (typeof console !== "undefined" && typeof console.error === "function") {
      console.error(label)
    }
  } catch (error) {
    // Diagnostics must never interrupt the caller's recovery or cleanup.
  }
}

module.exports = { reportDiagnostic }
