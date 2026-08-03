const fs = require("fs")
const path = require("path")

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8")
}

describe("components/car-card 状态样式隔离", () => {
  test("组件内部声明首页核心状态颜色，不依赖 app.wxss 穿透", () => {
    const style = readProjectFile("components/car-card/car-card.wxss")

    expect(style).toMatch(/\.car-status\.status-idle\s*[,{\n]/)
    expect(style).toMatch(/\.car-status\.status-active\s*[,{\n]/)
    expect(style).toMatch(/\.car-status\.status-maintenance\s*\{/)
    expect(style).toMatch(/\.car-status\.status-reserved\s*\{/)
  })

  test("组件状态标签使用页面生成的动态颜色类", () => {
    const template = readProjectFile("components/car-card/car-card.wxml")

    expect(template).toContain("car-status ui-status {{car.statusClass}}")
    expect(template).toContain("{{car.statusText}}")
  })

  test("整张车辆卡提供详情语义并使用原生箭头", () => {
    const template = readProjectFile("components/car-card/car-card.wxml")
    const style = readProjectFile("components/car-card/car-card.wxss")

    expect(template).toContain('aria-role="button"')
    expect(template).toContain('aria-label="查看{{car.name}}详情，{{car.statusText}}，{{car.priceText}}"')
    expect(template).toContain('aria-label="{{car.name}}车辆图片"')
    expect(template).toContain("card-corner-arrow")
    expect(template).toContain("car-cover-placeholder-emblem")
    expect(template).toContain("car-image-loading-ring")
    expect(template.match(/jijing-garage-emblem\.png/g)).toHaveLength(2)
    expect(template).not.toContain("↗")
    expect(style).toContain(".card-corner-arrow::after")
    expect(style).toContain(".car-cover-placeholder-brand")
    expect(style).toContain(".car-image-loading-ring")
  })

  test("车型名称作为主标题，车辆尾号或昵称降为辅助识别", () => {
    const template = readProjectFile("components/car-card/car-card.wxml")

    expect(template).toContain('<view class="car-nickname">{{car.name}}</view>')
    expect(template).toContain('<view class="car-name">{{car.nickname || car.name}}</view>')
    expect(template.indexOf('{{car.name}}</view>')).toBeLessThan(
      template.indexOf('{{car.nickname || car.name}}</view>')
    )
  })
})
