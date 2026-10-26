Component({
  properties: {
    preview: {
      type: Object,
      value: null,
      observer(value) {
        this.setData({ displayRows: (value && value.rows || []).map((row, index) => ({
          index, cells: row.map((text, cellIndex) => ({ index: cellIndex, text }))
        })) })
      }
    }
  },
  data: { displayRows: [] },
  methods: {
    handleClose() { this.triggerEvent("close") },
    handleMaskMove() {}
  }
})
