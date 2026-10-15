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
    this._sharedOperationAlerts = require("./shared/operationAlerts")
    this._sharedVehicleMaintenance = require("./shared/vehicleMaintenance")

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

    // 微信数据预拉取 (WeChat Background Fetch / Pre-fetch)
    try {
      if (typeof wx !== "undefined" && typeof wx.getBackgroundFetchData === "function") {
        wx.getBackgroundFetchData({
          fetchType: "pre",
          success: (res) => {
            if (res && res.fetchedData) {
              try {
                const parsed = typeof res.fetchedData === "string" ? JSON.parse(res.fetchedData) : res.fetchedData
                if (parsed && (Array.isArray(parsed.list) || Array.isArray(parsed))) {
                  this.globalData._prefetchedGarageList = parsed
                  if (typeof this.onPrefetchGarageReady === "function") {
                    this.onPrefetchGarageReady(parsed)
                  }
                }
              } catch (e) {}
            }
          },
          fail: () => {}
        })
      }
      if (typeof wx !== "undefined" && typeof wx.onBackgroundFetchData === "function") {
        wx.onBackgroundFetchData((res) => {
          if (res && res.fetchedData) {
            try {
              const parsed = typeof res.fetchedData === "string" ? JSON.parse(res.fetchedData) : res.fetchedData
              if (parsed && (Array.isArray(parsed.list) || Array.isArray(parsed))) {
                this.globalData._prefetchedGarageList = parsed
                if (typeof this.onPrefetchGarageReady === "function") {
                  this.onPrefetchGarageReady(parsed)
                }
              }
            } catch (e) {}
          }
        })
      }
    } catch (error) {}
  },

  globalData: {
    cloudEnvId: "cloud1-d8gtmns36320e045e",
    nativeActionAppVisible: true,
    _prefetchedGarageList: null
  }
})
