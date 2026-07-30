Component({
  properties: {
    car: {
      type: Object,
      value: null
    }
  },

  data: {
    imageLoading: false,
    imageFailed: false
  },

  observers: {
    "car.cover"(cover) {
      this.setData({
        imageLoading: Boolean(cover),
        imageFailed: false
      })
    }
  },

  methods: {
    handleImageLoad() {
      this.setData({
        imageLoading: false,
        imageFailed: false
      })
    },

    handleImageError() {
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
  }
})
