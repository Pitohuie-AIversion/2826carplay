const { resolveImage, getCachedPath } = require("../../shared/imageCache")

Component({
  properties: {
    car: {
      type: Object,
      value: null
    }
  },

  data: {
    imageLoading: false,
    imageFailed: false,
    displayCover: ""
  },

  observers: {
    "car.cover"(cover) {
      this.cancelPendingCoverResolve()
      this.setData({
        imageLoading: Boolean(cover),
        imageFailed: false,
        displayCover: cover ? getCachedPath(cover) : ""
      })
      if (cover) {
        this.scheduleCoverResolve(cover)
      }
    }
  },

  methods: {
    scheduleCoverResolve(cover) {
      const serial = Number(this._coverSerial || 0) + 1
      this._coverSerial = serial
      const priority = 10
      resolveImage(cover, { priority })
        .then((result) => {
          if (this._coverSerial !== serial || !result || !result.localPath) {
            return
          }
          if (result.localPath !== this.data.displayCover) {
            this.setData({ displayCover: result.localPath })
          }
        })
        .catch(() => {})
    },

    cancelPendingCoverResolve() {
      this._coverSerial = Number(this._coverSerial || 0) + 1
    },

    handleImageLoad() {
      this.setData({
        imageLoading: false,
        imageFailed: false
      })
    },

    handleImageError() {
      const car = this.data.car || {}
      const originalCover = car.cover || ""
      const current = this.data.displayCover
      if (originalCover && current && current !== originalCover) {
        this.setData({ displayCover: originalCover })
        return
      }
      this.setData({
        imageLoading: false,
        imageFailed: true
      })
    },

    handleTap() {
      const car = this.data.car || {}

      if (!car.id) {
        return
      }

      this.triggerEvent("cardtap", {
        carId: car.id
      })
    }
  },

  detached() {
    this.cancelPendingCoverResolve()
  }
})
