# 微信小程序无头全组件交互自动化仿真体系 (Headless Simulation QA)

## 1. 为什么需要无头仿真测试？

传统微信小程序 UI 自动化测试面临巨大挑战：
1. **强依赖微信开发者工具或真机**：启动缓慢、无法在 Linux CI/CD 中顺畅运行，调试耗时以分钟计。
2. **事件流失与时序盲区**：真机点击容易因为网络抖动、页面加载延迟产生误判。
3. **回归成本高昂**：页面稍有改动，需要人工在手机上逐个点击几十个页面的按钮、输入框与筛选标签。

---

## 2. 纯 Node.js 无头仿真架构

本技能沉淀了极境车库中的全组件无界面仿真方案（`scripts/simulateAllComponentClicks.js`）：
在没有任何浏览器或微信 IDE 的情况下，在纯 Node.js 环境中秒级模拟 26 个页面与 320+ 项用户交互点击，断言状态机流转。

### 核心实现原理解密：
```text
┌─────────────────────────────────────────────────────────────┐
│                      Node.js 仿真执行器                      │
├─────────────────────────────────────────────────────────────┤
│ 1. Mock 宿主环境:                                           │
│    - global.Page = (options) => { ... }                     │
│    - global.Component = (options) => { ... }                │
│    - global.wx = { cloud, showToast, makePhoneCall, ... }   │
│                                                             │
│ 2. 模拟生命周期:                                             │
│    - page.onLoad(options) -> page.onShow()                  │
│                                                             │
│ 3. 构造伪事件并触发 (Synthetic Event Dispatch):               │
│    - 触发点击: page.handleSortChange({ currentTarget: ...}) │
│    - 触发输入: page.handleSearchInput({ detail: ...})       │
│    - 触发回车: page.handleSearchConfirm({ detail: ...})     │
│                                                             │
│ 4. 验证状态机与渲染:                                         │
│    - 断言 page.data.sortBy === "price_desc"                 │
│    - 断言 page.data.filteredCars 顺序符合升降序规则          │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. 标准仿真用例编写示范

```javascript
function simulateClick(desc, actionFn) {
  try {
    actionFn()
    console.log(`  ✓ [PASS] ${desc}`)
  } catch (error) {
    console.error(`  ✗ [FAIL] ${desc}:`, error.message)
    throw error
  }
}

// 模拟车库页面的价格排序点击动作
simulateClick("点击价格由低到高排序，并断言列表按日租升序重排", () => {
  const pageDef = require("../pages/garage/garage.js")
  // 创建虚拟 Page 实例
  const page = Object.assign({}, pageDef)
  page.data = JSON.parse(JSON.stringify(pageDef.data))
  page.setData = (patch) => Object.assign(page.data, patch)

  // 1. 模拟生命周期启动
  page.onLoad({})
  page.applyCars([
    { id: "car-1", brandModel: "保时捷 911", priceDay: 3500 },
    { id: "car-2", brandModel: "宝马 M3", priceDay: 1800 }
  ])

  // 2. 模拟用户点击排序 Tab
  page.handleSortChange({
    currentTarget: { dataset: { sort: "price_asc" } }
  })

  // 3. 断言状态与排序正确性
  if (page.data.sortBy !== "price_asc") {
    throw new Error(`预期 sortBy 为 price_asc，实际为 ${page.data.sortBy}`)
  }
  if (page.data.filteredCars[0].id !== "car-2") {
    throw new Error("列表未按日租从低到高排列")
  }
})
```

---

## 4. 落地检查清单 (Checklist)

- [ ] 新增或重构核心业务页面时，在测试脚本中补全该页面的所有按钮（`bindtap`）仿真用例。
- [ ] 确保测试覆盖：初始加载、空数据兜底、分页触底、异常重试、表单输入与回车检索。
- [ ] 将仿真脚本配置入 `package.json` 的预发流水线：`npm run check:release`。
