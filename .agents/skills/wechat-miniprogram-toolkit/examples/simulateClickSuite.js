/**
 * 微信小程序无头组件交互测试套件脚手架 (Headless Click Test Template)
 * 
 * 可以在纯 Node.js 环境中快速针对任何 Page / Component 进行交互点击与状态验证
 */

function createMockPage(pageDefinition, initialData = {}) {
  const page = Object.assign({}, pageDefinition)
  page.data = JSON.parse(JSON.stringify(Object.assign({}, pageDefinition.data || {}, initialData)))
  
  page.setData = function (patch, callback) {
    Object.assign(page.data, patch)
    if (typeof callback === "function") callback()
  }

  return page
}

function runInteractiveAssertion(testName, fn) {
  try {
    fn()
    console.log(`  ✓ [PASS] ${testName}`)
    return true
  } catch (err) {
    console.error(`  ✗ [FAIL] ${testName}: ${err.message}`)
    throw err
  }
}

// 模拟用例执行示范
function runDemoSuite() {
  console.log("=== 启动小程序无头组件点击测试 ===")

  // 1. 模拟一个包含搜索与 Tab 筛选的典型页面
  const mockPageDef = {
    data: {
      keyword: "",
      status: "all",
      list: [{ id: "item-1", name: "Alpha", status: "active" }, { id: "item-2", name: "Beta", status: "idle" }],
      filteredList: []
    },
    onLoad() {
      this.filterData()
    },
    handleStatusChange(e) {
      const status = e.currentTarget.dataset.status
      this.setData({ status })
      this.filterData()
    },
    handleSearchConfirm(e) {
      const keyword = e.detail.value
      this.setData({ keyword })
      this.filterData()
    },
    filterData() {
      const { status, keyword, list } = this.data
      let res = list.slice()
      if (status !== "all") {
        res = res.filter((item) => item.status === status)
      }
      if (keyword) {
        res = res.filter((item) => item.name.includes(keyword))
      }
      this.setData({ filteredList: res })
    }
  }

  const page = createMockPage(mockPageDef)
  page.onLoad()

  // 2. 断言 1: 点击切换 Tab
  runInteractiveAssertion("点击状态过滤为 active，列表只显示 active 项", () => {
    page.handleStatusChange({
      currentTarget: { dataset: { status: "active" } }
    })
    if (page.data.status !== "active") throw new Error("status 未更新")
    if (page.data.filteredList.length !== 1 || page.data.filteredList[0].id !== "item-1") {
      throw new Error("filteredList 未正确过滤")
    }
  })

  // 3. 断言 2: 回车检索
  runInteractiveAssertion("软键盘确认搜索 Beta，结合当前状态过滤结果为空", () => {
    page.handleSearchConfirm({
      detail: { value: "Beta" }
    })
    if (page.data.keyword !== "Beta") throw new Error("keyword 未更新")
    if (page.data.filteredList.length !== 0) throw new Error("预期过滤结果为空")
  })

  console.log("=== 测试通过 ===")
}

module.exports = {
  createMockPage,
  runInteractiveAssertion,
  runDemoSuite
}
