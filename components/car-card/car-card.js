Component({
  properties: {
    car: {
      type: Object,
      value: null
    }
  },

  methods: {
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
