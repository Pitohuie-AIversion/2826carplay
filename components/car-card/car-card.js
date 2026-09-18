const { resolveImage, getCachedPath } = require("../../shared/imageCache")

const loadedCoversCache = new Set()

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
      const currentDisplay = this.data.displayCover
      const nextDisplay = cover ? getCachedPath(cover) : ""
      const isSameCover = cover && cover === this._lastCover
      const isAlreadyLoaded =
        (isSameCover && Boolean(this._imageLoaded)) ||
        loadedCoversCache.has(cover) ||
        loadedCoversCache.has(nextDisplay)

      this._lastCover = cover
      this.setData({
        imageLoading: Boolean(cover) && !isAlreadyLoaded,
        imageFailed: false,
        displayCover: isAlreadyLoaded && currentDisplay ? currentDisplay : nextDisplay
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
      this._imageLoaded = true
      const car = this.data.car || {}
      if (car.cover) {
        loadedCoversCache.add(car.cover)
      }
      if (this.data.displayCover) {
        loadedCoversCache.add(this.data.displayCover)
      }
      this.setData({
        imageLoading: false,
        imageFailed: false
      })
    },

    handleImageError() {
      this._imageLoaded = false
      const car = this.data.car || {}
      const originalCover = car.cover || ""
      if (originalCover) {
        loadedCoversCache.delete(originalCover)
      }
      const current = this.data.displayCover
      if (current) {
        loadedCoversCache.delete(current)
      }
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
