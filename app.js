App({
  onShow() {
    this.globalData.nativeActionAppVisible = true
  },

  onHide() {
    this.globalData.nativeActionAppVisible = false
  },

  onError(err) {
    try {
      console.error("[App Error]", err)
    } catch (e) {}
  },

  onUnhandledRejection(res) {
    try {
      console.warn("[App UnhandledRejection]", res)
    } catch (e) {}
  },

  onLaunch() {
    this._sharedUnsavedChanges = require("./shared/unsavedChanges")
    this._sharedVehicleFormProgress = require("./shared/vehicleFormProgress")

    const { setupUpdateManager, runVersionMigration } = require("./shared/versionMigration")
    this._versionMigrationResult = runVersionMigration()
    this._updateManager = setupUpdateManager()

    if (!wx.cloud || typeof wx.cloud.init !== "function") {
      return
    }

    try {
      const startCloudInit = () => {
        try {
          wx.cloud.init({
            env: this.globalData.cloudEnvId,
            traceUser: true
          })
        } catch (error) {
          // cloud init failure is non-fatal for first paint
        }
      }
      if (typeof wx.nextTick === "function") {
        wx.nextTick(startCloudInit)
      } else {
        setTimeout(startCloudInit, 0)
      }
    } catch (error) {
      return
    }
  },

  globalData: {
    cloudEnvId: "cloud1-d8gtmns36320e045e",
    nativeActionAppVisible: true
  }
})
