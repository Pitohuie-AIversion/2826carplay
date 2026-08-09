const fs = require("fs")
const path = require("path")

function read(relativePath) {
  return fs.readFileSync(path.resolve(__dirname, "..", relativePath), "utf8")
}

function listWxmlFiles(relativeDirectory) {
  const root = path.resolve(__dirname, "..", relativeDirectory)
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.join(relativeDirectory, entry.name)
    if (entry.isDirectory()) {
      return listWxmlFiles(relativePath)
    }
    return entry.isFile() && entry.name.endsWith(".wxml") ? [relativePath] : []
  })
}

function listWxssFiles(relativeDirectory) {
  const root = path.resolve(__dirname, "..", relativeDirectory)
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.join(relativeDirectory, entry.name)
    if (entry.isDirectory()) {
      return listWxssFiles(relativePath)
    }
    return entry.isFile() && entry.name.endsWith(".wxss") ? [relativePath] : []
  })
}

function extractCallHeaders(source, marker) {
  const headers = []
  let cursor = 0

  while (cursor < source.length) {
    const markerIndex = source.indexOf(marker, cursor)
    if (markerIndex < 0) {
      break
    }

    const bodyStart = markerIndex + marker.length
    const tail = source.slice(bodyStart)
    const callbackMatch = /\n\s*(?:success|fail|complete):/.exec(tail)
    const closeMatch = /\n\s*\}\)/.exec(tail)
    const callbackIndex = callbackMatch ? callbackMatch.index : Number.POSITIVE_INFINITY
    const closeIndex = closeMatch ? closeMatch.index : Number.POSITIVE_INFINITY
    const endIndex = Math.min(callbackIndex, closeIndex)

    if (!Number.isFinite(endIndex)) {
      break
    }

    headers.push({
      header: tail.slice(0, endIndex),
      hasCallback: callbackIndex === endIndex
    })
    cursor = bodyStart + endIndex + 1
  }

  return headers
}

function extractModalHeaders(source) {
  return extractCallHeaders(source, "wx.showModal({")
}

function extractBalancedCallBodies(source, marker) {
  const bodies = []
  let cursor = 0

  while (cursor < source.length) {
    const markerIndex = source.indexOf(marker, cursor)
    if (markerIndex < 0) {
      break
    }

    const objectStart = markerIndex + marker.length - 1
    let depth = 1
    let quote = ""
    let escaped = false
    let endIndex = -1

    for (let index = objectStart + 1; index < source.length; index += 1) {
      const char = source[index]
      if (quote) {
        if (escaped) {
          escaped = false
        } else if (char === "\\") {
          escaped = true
        } else if (char === quote) {
          quote = ""
        }
        continue
      }

      if (char === '"' || char === "'" || char === "`") {
        quote = char
      } else if (char === "{") {
        depth += 1
      } else if (char === "}") {
        depth -= 1
        if (depth === 0) {
          endIndex = index
          break
        }
      }
    }

    if (endIndex < 0) {
      break
    }

    bodies.push(source.slice(objectStart + 1, endIndex))
    cursor = markerIndex + marker.length
  }

  return bodies
}

describe("用户主流程原生图标", () => {
  test("全站极境车库徽标均作为文字内容旁的装饰图形", () => {
    const wxmlFiles = [...listWxmlFiles("pages"), ...listWxmlFiles("components")]
    let emblemCount = 0

    wxmlFiles.forEach((relativePath) => {
      const matches = read(relativePath).match(/<image[^>]+jijing-garage-emblem\.png[^>]*\/>/g) || []
      matches.forEach((markup) => {
        emblemCount += 1
        expect(markup).toContain('aria-hidden="true"')
      })
    })

    expect(emblemCount).toBeGreaterThanOrEqual(40)
  })

  test("全站首屏加载骨架均作为装饰结构隐藏", () => {
    const wxmlFiles = listWxmlFiles("pages")
    let loadingSkeletonCount = 0

    wxmlFiles.forEach((relativePath) => {
      const tags = read(relativePath).match(/<view\b[^>]*>/g) || []
      tags
        .filter(
          (markup) =>
            /wx:(?:if|elif)="[^"]*(?:loading|Loading)[^"]*"/i.test(markup) &&
            /class="[^"]*(?:skeleton|loading)[^"]*"/i.test(markup)
        )
        .forEach((markup) => {
          loadingSkeletonCount += 1
          expect(markup).toContain('aria-hidden="true"')
        })
    })

    expect(loadingSkeletonCount).toBe(24)
  })

  test("全站输入控件均提供字段说明与输入边界", () => {
    const wxmlFiles = listWxmlFiles("pages")
    const textareaCounterExpressions = {
      "pages/booking/booking.wxml": ["form.note.length"],
      "pages/booking-detail/booking-detail.wxml": ["editForm.note.length"],
      "pages/booking-manage/booking-manage.wxml": ["item.adminRemarkDraft.length"],
      "pages/booking-manage-detail/booking-manage-detail.wxml": ["booking.adminRemarkDraft.length"],
      "pages/booking-workbench/booking-workbench.wxml": ["remarkDraft.length"],
      "pages/config-manage/config-manage.wxml": [
        "form.mineUserDesc.length",
        "form.garagePageSubtitle.length",
        "form.cityOptionsText.length",
        "form.faqContent.length",
        "form.rulesContent.length",
        "form.bookingPrivacyTip.length",
        "form.rentalIncludedText.length",
        "form.rentalProtectionText.length",
        "form.rentalServiceFeeText.length",
        "form.rentalDeliveryFeeText.length",
        "form.rentalDepositText.length",
        "form.rentalCancellationText.length",
        "form.rentalOvertimeText.length",
        "form.rentalEnergyText.length",
        "form.rentalEstimateDisclaimer.length"
      ],
      "pages/privacy-request/privacy-request.wxml": ["descriptionLength"],
      "pages/vehicle-create/vehicle-create.wxml": ["publicDescriptionLength", "noteLength"],
      "pages/vehicle-edit/vehicle-edit.wxml": ["publicDescriptionLength", "noteLength"]
    }
    let inputControlCount = 0
    let singleLineInputCount = 0
    let textareaCount = 0

    wxmlFiles.forEach((relativePath) => {
      const controls = read(relativePath).match(/<(?:input|textarea)\b[^>]*\/?\s*>/g) || []
      controls.forEach((markup) => {
        inputControlCount += 1
        expect(markup).toMatch(/aria-label="[^"]+"/)
        expect(markup).toMatch(/placeholder="[^"]+"/)

        if (markup.startsWith("<input")) {
          singleLineInputCount += 1
          expect(markup).toMatch(/maxlength="\d+"/)
          expect(markup).toMatch(/confirm-type="(?:send|search|next|go|done)"/)

          const typeMatch = /(?:^|\s)type="([^"]+)"/.exec(markup)
          if (typeMatch) {
            expect(["text", "number", "idcard", "digit", "safe-password", "nickname"]).toContain(typeMatch[1])
          }

          if (/aria-label="[^"]*手机号[^"]*"/.test(markup)) {
            expect(markup).toContain('type="number"')
            expect(markup).toContain('maxlength="11"')
          }
        } else {
          textareaCount += 1
          expect(markup).toMatch(/maxlength="\d+"/)
        }
      })
    })

    expect(inputControlCount).toBe(57)
    expect(singleLineInputCount).toBe(32)
    expect(textareaCount).toBe(25)
    expect(Object.values(textareaCounterExpressions).flat()).toHaveLength(textareaCount)
    Object.entries(textareaCounterExpressions).forEach(([relativePath, expressions]) => {
      const source = read(relativePath)
      expressions.forEach((expression) => expect(source).toContain(expression))
    })
  })

  test("全站原生选择器与隐私勾选提供一致状态反馈", () => {
    const wxmlFiles = listWxmlFiles("pages")
    let pickerCount = 0

    wxmlFiles.forEach((relativePath) => {
      const pickerBlocks = read(relativePath).match(/<picker\b[^>]*>[\s\S]*?<\/picker>/g) || []
      pickerBlocks.forEach((markup) => {
        pickerCount += 1
        const openingTag = markup.match(/<picker\b[^>]*>/)[0]
        expect(openingTag).toMatch(/aria-label="[^"]+"/)
        expect(openingTag).toMatch(/bindchange="[^"]+"/)
        expect(markup).toMatch(/hover-class="[^"]+"/)
        expect(markup).toMatch(/(?:picker-arrow|picker-chevron)/)
      })
    })

    const bookingMarkup = read("pages/booking/booking.wxml")
    const privacyGroup = bookingMarkup.match(/<checkbox-group\b[^>]*>/)[0]
    const privacyCheckbox = bookingMarkup.match(/<checkbox\b[^>]*\/>/)[0]
    const bookingStyle = read("pages/booking/booking.wxss")

    expect(pickerCount).toBe(13)
    expect(privacyGroup).toContain("privacy-agreement-complete")
    expect(privacyGroup).toContain('aria-required="{{true}}"')
    expect(privacyCheckbox).toContain('aria-label="同意隐私政策"')
    expect(privacyCheckbox).toContain('aria-checked="{{privacyAgreed}}"')
    expect(bookingStyle).toMatch(/\.privacy-agreement-complete\s*\{[\s\S]*?border-color:/)
    expect(bookingStyle).toMatch(/\.privacy-policy-link\s*\{[\s\S]*?min-height:\s*56rpx/)
  })

  test("全站关键进度组件集中说明状态并平滑更新", () => {
    const progressGroups = [
      ["pages/booking/booking.wxml", "form-progress", "预约信息完成度", "form-progress-track"],
      ["pages/vehicle-create/vehicle-create.wxml", "vehicle-form-progress", "车辆必填信息完成度", "vehicle-form-progress-track"],
      ["pages/vehicle-edit/vehicle-edit.wxml", "vehicle-form-progress", "车辆必填信息完成度", "vehicle-form-progress-track"],
      ["pages/system-health/system-health.wxml", "completion-card", "上线准备完成度", "completion-track"],
      ["pages/privacy-data-inventory/privacy-data-inventory.wxml", "inventory-progress-card", "数据核验覆盖", "inventory-progress-track"],
      ["pages/operations-overview/operations-overview.wxml", "hero-sync", "运营数据同步进度", "hero-sync-track"],
      ["pages/bookings/bookings.wxml", "booking-progress", "预约进度", "booking-progress-track"],
      ["pages/booking-detail/booking-detail.wxml", "progress-track", "预约进度", "progress-visual"],
      ["pages/privacy-request-manage/privacy-request-manage.wxml", "request-journey", "申请处理进度", "request-journey-track"]
    ]
    const animatedBars = [
      ["pages/booking/booking.wxss", "form-progress-bar"],
      ["shared/vehicle-form.wxss", "vehicle-form-progress-fill"],
      ["pages/system-health/system-health.wxss", "completion-bar"],
      ["pages/bookings/bookings.wxss", "booking-progress-fill"],
      ["pages/operations-overview/operations-overview.wxss", "hero-sync-progress"],
      ["pages/privacy-data-inventory/privacy-data-inventory.wxss", "inventory-progress-value"],
      ["pages/privacy-request-manage/privacy-request-manage.wxss", "request-journey-progress"]
    ]

    progressGroups.forEach(([relativePath, groupClass, labelText, trackClass]) => {
      const source = read(relativePath)
      const groupTag = (source.match(new RegExp(`<view\\b[^>]*class="[^"]*${groupClass}[^"]*"[^>]*>`)) || [])[0]
      const trackTag = (source.match(new RegExp(`<view\\b[^>]*class="[^"]*${trackClass}[^"]*"[^>]*>`)) || [])[0]

      expect(groupTag).toContain('aria-role="group"')
      expect(groupTag).toContain(`aria-label="${labelText}`)
      expect(trackTag).toContain('aria-hidden="true"')
    })

    animatedBars.forEach(([relativePath, className]) => {
      expect(read(relativePath)).toMatch(new RegExp(`\\.${className}\\s*\\{[\\s\\S]*?transition:\\s*width`))
    })
  })

  test("全站微文案保持可读的最小字号", () => {
    const styleFiles = [
      ...listWxssFiles("pages"),
      ...listWxssFiles("components"),
      ...listWxssFiles("shared"),
      "app.wxss"
    ]
    const undersizedDeclarations = []
    let fontSizeDeclarationCount = 0

    styleFiles.forEach((relativePath) => {
      const matches = read(relativePath).matchAll(/font-size:\s*(\d+)rpx/g)
      for (const match of matches) {
        const size = Number(match[1])
        fontSizeDeclarationCount += 1
        if (size < 14) {
          undersizedDeclarations.push(`${relativePath}: ${size}rpx`)
        }
      }
    })

    expect(styleFiles).toHaveLength(31)
    expect(fontSizeDeclarationCount).toBeGreaterThanOrEqual(700)
    expect(undersizedDeclarations).toEqual([])
  })

  test("动态车辆图片统一使用懒加载、淡入与失败兜底", () => {
    const wxmlFiles = [...listWxmlFiles("pages"), ...listWxmlFiles("components")]
    let dynamicImageCount = 0

    wxmlFiles.forEach((relativePath) => {
      const dynamicImages = (read(relativePath).match(/<image\b[^>]*\/?\s*>/g) || [])
        .filter((markup) => /\ssrc="\{\{/.test(markup))

      dynamicImages.forEach((markup) => {
        dynamicImageCount += 1
        expect(markup).toContain('mode="aspectFill"')
        expect(markup).toContain('lazy-load="{{true}}"')
        expect(markup).toMatch(/fade-in="\{\{(?:true|false)\}\}"/)
        expect(markup).toMatch(/binderror="[^"]+"/)

        if (markup.includes('fade-in="{{false}}"')) {
          expect(markup).toMatch(/bindload="[^"]+"/)
        }
      })
    })

    expect(dynamicImageCount).toBe(4)
  })

  test("高频文字链接与图标操作保留最小点击热区", () => {
    const touchTargetRules = [
      ["pages/booking/booking.wxss", /\.privacy-policy-link\s*\{/, 1],
      ["pages/booking/booking.wxss", /\.availability-retry\s*\{/, 1],
      ["pages/booking-workbench/booking-workbench.wxss", /\.refresh-control\s*\{/, 1],
      ["pages/booking-workbench/booking-workbench.wxss", /\.search-clear\s*\{/, 1],
      ["pages/booking-workbench/booking-workbench.wxss", /\.reset-view\s*\{/, 1],
      ["pages/garage/garage.wxss", /\.search-clear\s*\{/, 1],
      ["shared/management-shell.wxss", /\.management-page\s+\.management-search-clear\s*\{/, 1],
      ["pages/operations-overview/operations-overview.wxss", /\.refresh-link,\s*\.section-link\s*\{/, 2],
      ["pages/privacy-data-inventory/privacy-data-inventory.wxss", /\.refresh-link\s*\{/, 1],
      ["pages/system-health/system-health.wxss", /\.refresh-link\s*\{/, 1]
    ]
    let protectedControlCount = 0

    touchTargetRules.forEach(([relativePath, selectorPattern, controlCount]) => {
      const source = read(relativePath)
      const selectorMatch = selectorPattern.exec(source)
      expect(selectorMatch).not.toBeNull()
      const blockEnd = source.indexOf("}", selectorMatch.index)
      const ruleBlock = source.slice(selectorMatch.index, blockEnd + 1)
      const sizeMatch = /(?:min-height|height):\s*(\d+)rpx/.exec(ruleBlock)

      expect(sizeMatch).not.toBeNull()
      expect(Number(sizeMatch[1])).toBeGreaterThanOrEqual(56)
      protectedControlCount += controlCount
    })

    expect(protectedControlCount).toBe(11)
  })

  test("关键微文案在深色卡片上保持清晰对比度", () => {
    const microcopyRules = [
      ["pages/booking-calendar/booking-calendar.wxss", /\.date-count\s*\{/],
      ["pages/booking-manage/booking-manage.wxss", /\.booking-journey-kicker\s*\{/],
      ["pages/booking-workbench/booking-workbench.wxss", /\.phone-copy-label\s*\{/],
      ["pages/bookings/bookings.wxss", /\.booking-progress-kicker\s*\{/],
      ["pages/content-page/content-page.wxss", /\.content-tab-kicker\s*\{/],
      ["pages/mine/mine.wxss", /\.member-shortcut-kicker\s*\{/],
      ["pages/mine/mine.wxss", /\.section-count\s*\{/],
      ["pages/mine/mine.wxss", /\.menu-group-kicker\s*\{/],
      ["pages/privacy-request/privacy-request.wxss", /\.summary-kicker\s*\{/],
      ["pages/system-health/system-health.wxss", /\.completion-stat-label\s*\{/],
      ["shared/management-shell.wxss", /\.management-page\s+\.log-kind\s*\{/]
    ]
    const luminance = (hexColor) => {
      const channels = hexColor.slice(1).match(/../g).map((value) => {
        const channel = Number.parseInt(value, 16) / 255
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
    }
    const contrastRatio = (foreground, background) => {
      const foregroundLuminance = luminance(foreground)
      const backgroundLuminance = luminance(background)
      return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
        (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
    }

    microcopyRules.forEach(([relativePath, selectorPattern]) => {
      const source = read(relativePath)
      const selectorMatch = selectorPattern.exec(source)
      expect(selectorMatch).not.toBeNull()
      const blockEnd = source.indexOf("}", selectorMatch.index)
      const ruleBlock = source.slice(selectorMatch.index, blockEnd + 1)
      const colorMatch = /(?:^|\s)color:\s*(#[0-9a-f]{6})/i.exec(ruleBlock)

      expect(colorMatch).not.toBeNull()
      expect(contrastRatio(colorMatch[1], "#151a22")).toBeGreaterThanOrEqual(4.5)
    })

    expect(microcopyRules).toHaveLength(11)
  })

  test("全站自定义点击区域均提供按压反馈与交互语义", () => {
    const wxmlFiles = [...listWxmlFiles("pages"), ...listWxmlFiles("components")]
    let tapTargetCount = 0

    wxmlFiles.forEach((relativePath) => {
      const matches = read(relativePath).match(/<(?:view|scroll-view|image|text)\b[^>]*\bbindtap="[^"]+"[^>]*>/g) || []
      matches.forEach((markup) => {
        tapTargetCount += 1
        expect(markup).toContain('hover-class="')
        expect(markup).toContain('aria-role="')
      })
    })

    expect(tapTargetCount).toBeGreaterThanOrEqual(40)
  })

  test("全站横向滚动区域统一提供增强滚动与小屏提示", () => {
    const wxmlFiles = [...listWxmlFiles("pages"), ...listWxmlFiles("components")]
    let horizontalScrollCount = 0

    wxmlFiles.forEach((relativePath) => {
      const source = read(relativePath)
      const matches = source.match(/<scroll-view\b[^>]*\bscroll-x(?:="[^"]*")?[^>]*>/g) || []
      matches.forEach((markup) => {
        horizontalScrollCount += 1
        expect(markup).toMatch(/\senhanced(?:=|\s|>)/)
        expect(markup).toContain('show-scrollbar="{{false}}"')
        expect(markup).toContain('aria-label="')
        expect(source).toMatch(/(?:ui-scroll-cue|horizontal-scroll-cue|section-scroll-cue)/)

        if (!markup.includes('class="trend-scroll"')) {
          expect(markup).toContain("scroll-with-animation")
          expect(markup).toContain('scroll-into-view="')
        }
      })
    })

    expect(horizontalScrollCount).toBe(9)
  })

  test("全站用户可见缺省值不使用技术双短横或 N/A", () => {
    const appConfig = JSON.parse(read("app.json"))
    const pageFiles = appConfig.pages.flatMap((route) => [
      `${route}.wxml`,
      `${route}.js`
    ])

    pageFiles.forEach((relativePath) => {
      const source = read(relativePath)
      expect(source).not.toMatch(/["']--["']/)
      expect(source).not.toMatch(/\bN\/A\b/)
    })
  })

  test("进行中的按钮和系统加载提示统一使用中文省略号", () => {
    const appConfig = JSON.parse(read("app.json"))
    const pageTemplates = appConfig.pages.map((route) => read(`${route}.wxml`))
    const loadingScripts = [
      "pages/config-manage/config-manage.js",
      "pages/role-manage/role-manage.js",
      "pages/vehicle-detail-manage/vehicle-detail-manage.js",
      "pages/vehicle-manage/vehicle-manage.js"
    ].map(read)

    pageTemplates.forEach((source) => {
      expect(source).not.toMatch(/\?\s*["'](?:同步中|保存中|更新中|上传中|设置中|处理中)["']/)
    })
    loadingScripts.forEach((source) => {
      expect(source).not.toMatch(/title:\s*["'](?:保存中|更新中|上传中|设置中|处理中)["']/)
    })
    expect(read("pages/error-log-manage/error-log-manage.js")).not.toContain(')}...`')
  })

  test("原生确认弹窗统一使用明确动词和品牌层级颜色", () => {
    const appConfig = JSON.parse(read("app.json"))
    const allowedColors = new Set(["#528fff", "#d46868"])
    let confirmationCount = 0

    appConfig.pages.forEach((route) => {
      const source = read(`${route}.js`)
      extractModalHeaders(source).forEach(({ header, hasCallback }) => {
        if (/showCancel:\s*false/.test(header)) {
          return
        }

        confirmationCount += 1
        expect(hasCallback).toBe(true)
        expect(header).toMatch(/confirmText:/)
        expect(header).toMatch(/confirmColor:/)

        const colors = header.match(/#[0-9a-f]{6}/gi) || []
        expect(colors.length).toBeGreaterThan(0)
        colors.forEach((color) => {
          expect(allowedColors.has(color.toLowerCase())).toBe(true)
        })
      })
    })

    expect(confirmationCount).toBe(28)
  })

  test("原生操作菜单统一使用品牌色与顶部说明", () => {
    const actionSheetSources = [
      read("pages/booking-workbench/booking-workbench.js"),
      read("pages/privacy-request-manage/privacy-request-manage.js")
    ]
    let actionSheetCount = 0

    actionSheetSources.forEach((source) => {
      extractBalancedCallBodies(source, "wx.showActionSheet({").forEach((body) => {
        actionSheetCount += 1
        expect(body).toMatch(/alertText:\s*"[^"]+"/)
        expect(body).toContain('itemColor: "#528fff"')
        expect(body).toMatch(/isPageNativeActionActive\(this, (?:action|nativeAction)\)/)
      })
    })

    expect(actionSheetCount).toBe(2)
  })

  test("全站原生轻提示均显式声明语义图标", () => {
    const appConfig = JSON.parse(read("app.json"))
    const toastSources = [
      ...appConfig.pages.map((route) => read(`${route}.js`)),
      read("shared/pageAuth.js")
    ]
    let toastCount = 0

    toastSources.forEach((source) => {
      extractCallHeaders(source, "wx.showToast({").forEach(({ header }) => {
        toastCount += 1
        expect(header).toMatch(/icon:/)
      })
    })

    expect(toastCount).toBeGreaterThanOrEqual(273)
  })

  test("全站原生轻提示使用短业务文案且不展示技术错误原文", () => {
    const appConfig = JSON.parse(read("app.json"))
    const toastSources = [
      ...appConfig.pages.map((route) => read(`${route}.js`)),
      read("components/core-nav/core-nav.js"),
      read("shared/pageAuth.js")
    ]
    let toastCount = 0
    let literalTitleCount = 0

    toastSources.forEach((source) => {
      extractBalancedCallBodies(source, "wx.showToast({").forEach((body) => {
        toastCount += 1
        expect(body).not.toMatch(/error\.errMsg|error\.message|getErrorMessage\(error\)/)
        const literalTitle = body.match(/title\s*:\s*(["'])(.*?)\1/s)
        if (literalTitle) {
          literalTitleCount += 1
          expect(Array.from(literalTitle[2]).length).toBeLessThanOrEqual(10)
        }
      })
    })

    expect(toastCount).toBeGreaterThanOrEqual(275)
    expect(literalTitleCount).toBeGreaterThan(0)
  })

  test("全站纯信息弹窗统一使用知道了与品牌蓝按钮", () => {
    const appConfig = JSON.parse(read("app.json"))
    let infoModalCount = 0

    appConfig.pages.forEach((route) => {
      const source = read(`${route}.js`)
      extractBalancedCallBodies(source, "wx.showModal({").forEach((body) => {
        if (!/showCancel\s*:\s*false/.test(body)) {
          return
        }
        infoModalCount += 1
        expect(body).toContain('confirmText: "知道了"')
        expect(body).toContain('confirmColor: "#528fff"')
        const title = body.match(/title\s*:\s*(["'])(.*?)\1/s)
        if (title) {
          expect(Array.from(title[2]).length).toBeLessThanOrEqual(10)
        }
      })
    })

    expect(infoModalCount).toBe(20)
  })

  test("动态轻提示保留短消息并为长消息使用业务回退", () => {
    const { formatToastTitle } = require("../shared/uiFeedback")
    const appConfig = JSON.parse(read("app.json"))
    const toastSources = appConfig.pages.map((route) => read(`${route}.js`))

    expect(formatToastTitle("档期已更新", "更新失败")).toBe("档期已更新")
    expect(formatToastTitle("云函数返回了一段过长的内部错误说明", "更新失败")).toBe("更新失败")
    expect(formatToastTitle("", "这是一个超过十个字符的备用提示文案")).toBe(
      "这是一个超过十个字…"
    )

    toastSources.forEach((source) => {
      extractBalancedCallBodies(source, "wx.showToast({").forEach((body) => {
        const titleSection =
          (body.match(/title\s*:\s*([\s\S]*?)(?:,\s*\n\s*icon:)/) || [])[1] || ""
        if (
          /result\.message|errorMessage|validationMessage|getValidationMessage|successTitle/.test(
            titleSection
          )
        ) {
          expect(titleSection).toContain("formatToastTitle(")
        }
      })
    })
  })

  test("复制入口统一使用单次自定义反馈且不传入非微信参数", () => {
    const appConfig = JSON.parse(read("app.json"))
    let clipboardCount = 0

    appConfig.pages.forEach((route) => {
      const source = read(`${route}.js`)
      extractBalancedCallBodies(source, "wx.setClipboardData({").forEach((body) => {
        clipboardCount += 1
        expect(body).toMatch(/success:/)
        expect(body).toMatch(/fail:/)
        expect(body).toContain("wx.showToast({")
        expect(body).toMatch(/isPageNativeActionActive\(this, action\)|this\.isBookingDetailActive\(\)/)
        expect(body).not.toMatch(/^\s*showToast:/m)
      })
    })

    expect(clipboardCount).toBe(6)
  })

  test("轻量系统反馈只在操作来源仍是当前页面时展示", () => {
    const appConfig = JSON.parse(read("app.json"))
    const pageSources = appConfig.pages.map((route) => read(`${route}.js`))
    const currentOnlyActionCount = pageSources.reduce(
      (count, source) =>
        count +
        (source.match(/beginPageNativeAction\(this, \{ requireCurrent: true \}\)/g) || [])
          .length,
      0
    )
    const bookingDetailSource = read("pages/booking-detail/booking-detail.js")

    expect(currentOnlyActionCount).toBe(15)
    expect(bookingDetailSource).toContain("isPageCurrent(this)")
    expect(read("app.js")).toContain("nativeActionAppVisible = false")
    expect(read("app.js")).toContain("nativeActionAppVisible = true")
  })

  test("全站拨号入口仅在真实失败时提示并静默处理用户取消", () => {
    const appConfig = JSON.parse(read("app.json"))
    const servicePhoneRoutes = [
      "pages/garage/garage.js",
      "pages/car-detail/car-detail.js",
      "pages/content-page/content-page.js",
      "pages/mine/mine.js"
    ]
    let phoneCallCount = 0

    appConfig.pages.forEach((route) => {
      const source = read(`${route}.js`)
      extractBalancedCallBodies(source, "wx.makePhoneCall({").forEach((body) => {
        phoneCallCount += 1
        expect(body).toMatch(/fail:/)
        expect(body).toContain("cancel")
        expect(body).toContain("isPageNativeActionActive(this, action)")
        expect(body).not.toMatch(/\bsuccess\s*:/)
      })
    })

    servicePhoneRoutes.forEach((relativePath) => {
      const source = read(relativePath)
      expect(source).toContain("客服电话暂不可用")
      expect(source).toContain('String(this.data.servicePhone || "").trim()')
      expect(source).toContain("content: `请联系客服：${phone}`")
      expect(source).toContain('title: "拨号失败"')
    })

    expect(phoneCallCount).toBe(7)
  })

  test("全站页面跳转、返回兜底、滚动定位和图片预览入口均提供失败反馈", () => {
    const appConfig = JSON.parse(read("app.json"))
    const componentScripts = ["components/core-nav/core-nav.js"]
    const scripts = appConfig.pages.map((route) => `${route}.js`).concat(componentScripts)
    const expectedCounts = {
      navigateTo: 25,
      redirectTo: 19,
      reLaunch: 17,
      navigateBack: 9,
      pageScrollTo: 1,
      previewImage: 2
    }
    const actualCounts = {}

    scripts.forEach((relativePath) => {
      const source = read(relativePath)
      const usesNativeLifecycle = source.includes("activatePageNativeActions(this)")
      Object.keys(expectedCounts).forEach((method) => {
        extractBalancedCallBodies(source, `wx.${method}({`).forEach((body) => {
          actualCounts[method] = (actualCounts[method] || 0) + 1
          expect(body).toMatch(/fail:/)
          if (usesNativeLifecycle) {
            expect(body).toMatch(
              /isPageNativeActionActive\(this, action\)|isCurrent\(\)|isVehicleEditActive\(\)|fail:\s*fallback/
            )
          }
          if (method === "previewImage") {
            expect(body).toContain("isPageNativeActionActive(this, action)")
          }
        })
      })
    })

    expect(actualCounts).toEqual(expectedCounts)
  })

  test("接入原生生命周期守卫的确认弹窗不会在离页后启动操作", () => {
    const appConfig = JSON.parse(read("app.json"))
    let guardedCallbackCount = 0

    appConfig.pages.forEach((route) => {
      const source = read(`${route}.js`)
      if (!source.includes("activatePageNativeActions(this)")) {
        return
      }
      extractBalancedCallBodies(source, "wx.showModal({").forEach((body) => {
        if (!/success:/.test(body)) {
          return
        }
        guardedCallbackCount += 1
        expect(body).toMatch(
          /isPageNativeActionActive\(|isPageCsvFileActionActive\(|isBookingDetailActive\(|isVehicleDetailActive\(|isVehicleCreateActive\(|isVehicleEditActive\(|isCurrent\(\)/
        )
      })
    })

    expect(guardedCallbackCount).toBeGreaterThanOrEqual(20)
  })

  test("图片选择与文件分享会静默处理用户主动取消", () => {
    const vehicleSource = read("pages/vehicle-detail-manage/vehicle-detail-manage.js")
    const chooseImageCalls = extractBalancedCallBodies(vehicleSource, "wx.chooseImage({")
    const csvSharePages = [
      "pages/booking-manage/booking-manage.js",
      "pages/audit-log-manage/audit-log-manage.js",
      "pages/error-log-manage/error-log-manage.js",
      "pages/privacy-data-inventory/privacy-data-inventory.js"
    ]

    expect(chooseImageCalls).toHaveLength(1)
    expect(chooseImageCalls[0]).toMatch(/fail:/)
    expect(chooseImageCalls[0]).toContain("isUserCancelError(error)")
    expect(chooseImageCalls[0]).toContain("选择图片失败，请重试")
    csvSharePages.forEach((relativePath) => {
      expect(read(relativePath)).toContain("isUserCancelError(error)")
    })
  })

  test("全站系统加载层统一遮罩底层操作并使用进行中文案", () => {
    const appConfig = JSON.parse(read("app.json"))
    let loadingCount = 0

    appConfig.pages.forEach((route) => {
      const source = read(`${route}.js`)
      const matches = source.match(/wx\.showLoading\(\{[\s\S]*?\}\)/g) || []
      matches.forEach((markup) => {
        loadingCount += 1
        expect(markup).toMatch(/mask:\s*true/)
        expect(markup).toMatch(/title:/)
        expect(markup).toContain("中…")
        expect(markup).not.toMatch(/中["']/)
      })
    })

    expect(loadingCount).toBeGreaterThanOrEqual(7)
    const vehicleManageSource = read("pages/vehicle-manage/vehicle-manage.js")
    const mutationLoadingTitles = ["更新中…", "停用中…", "恢复中…", "删除中…"]
    expect(vehicleManageSource).toContain("runVehicleMutation(options)")
    mutationLoadingTitles.forEach((title) => {
      expect(vehicleManageSource).toContain(`loadingTitle: "${title}"`)
    })
    const mineSource = read("pages/mine/mine.js")
    const mineLoadingTitles = ["清理中…", "初始化中…", "查询中…"]
    expect(mineSource).toContain("runMineTool(options)")
    mineLoadingTitles.forEach((title) => {
      expect(mineSource).toContain(`loadingTitle: "${title}"`)
    })
    const vehicleDetailSource = read("pages/vehicle-detail-manage/vehicle-detail-manage.js")
    const vehicleDetailLoadingTitles = ["更新中…", "停用中…", "恢复中…"]
    expect(vehicleDetailSource).toContain("runVehicleStatusOperation(input)")
    vehicleDetailLoadingTitles.forEach((title) => {
      expect(vehicleDetailSource).toContain(`loadingTitle: "${title}"`)
    })
    expect(read("pages/vehicle-detail-manage/vehicle-detail-manage.wxml")).toContain("upload-progress-panel")
  })

  test("车辆详情使用放大预览、收藏与转化操作图标", () => {
    const wxml = read("pages/car-detail/car-detail.wxml")
    const wxss = read("pages/car-detail/car-detail.wxss")

    expect(wxml).toContain("hero-preview-corner-top-left")
    expect(wxml).toContain("favorite-heart-shape")
    expect(wxml).toContain("booking-action-native-icon")
    expect(wxml).toContain("phone-action-native-icon")
    expect(wxml).toContain("retry-action-native-icon")
    expect(wxml).toContain("back-action-native-icon")
    expect(wxml).toContain("empty-emblem")
    expect(wxml).toContain("favoriteLoading ? '正在更新收藏状态'")
    expect(wxml).toContain('wx:if="{{!favoriteLoading}}" class="favorite-button-icon"')
    expect(wxml).toContain("aria-label=\"{{car.primaryActionText}}，{{car.actionHintText}}\"")
    expect(wxml).not.toContain("⌗")
    expect(wxml).not.toContain("♥ 已收藏")
    expect(wxml).not.toContain("♡ 收藏")
    expect(wxml).not.toContain('bindtap="handlePhoneCall">电话咨询</button>')
    expect(wxss).toContain(".detail-action-content")
    expect(wxss).toContain(".booking-action-native-icon")
  })

  test.each([
    "pages/favorites/favorites.wxml",
    "pages/bookings/bookings.wxml"
  ])("%s 的筛选空状态使用调节器图标", (relativePath) => {
    const wxml = read(relativePath)

    expect(wxml).toContain("filter-empty-line-top")
    expect(wxml).toContain("filter-empty-line-bottom")
    expect(wxml).not.toContain("◇")
  })

  test("预约档期默认态使用日历图标", () => {
    const wxml = read("pages/booking/booking.wxml")

    expect(wxml).toContain("availability-calendar-icon")
    expect(wxml).not.toContain("◇")
  })

  test("预约提交按钮使用原生前进箭头", () => {
    const wxml = read("pages/booking/booking.wxml")

    expect(wxml).toContain("submit-arrow-line")
    expect(wxml).toContain('aria-label="{{submitButtonText}}"')
    expect(wxml).not.toContain('<text class="submit-arrow">→</text>')
  })

  test.each([
    "pages/bookings/bookings.wxml",
    "pages/booking-detail/booking-detail.wxml"
  ])("%s 的日期路线使用原生箭头", (relativePath) => {
    const wxml = read(relativePath)

    expect(wxml).toContain("route-chevron")
    expect(wxml).not.toContain('<view class="route-arrow">›</view>')
  })

  test("运营概览行动项使用原生箭头", () => {
    const wxml = read("pages/operations-overview/operations-overview.wxml")

    expect(wxml).toContain("alert-chevron")
    expect(wxml).toContain('aria-label="{{item.title}}，{{item.desc}}"')
    expect(wxml).not.toContain('<view class="alert-arrow">›</view>')
  })

  test("预约日历的月份切换和详情入口使用原生箭头", () => {
    const wxml = read("pages/booking-calendar/booking-calendar.wxml")

    expect(wxml).toContain("month-chevron-left")
    expect(wxml).toContain("month-chevron-right")
    expect(wxml).toContain("booking-chevron")
    expect(wxml).not.toContain(">‹</view>")
    expect(wxml).not.toContain(">›</view>")
  })

  test("待协调工作台的可操作状态使用原生箭头", () => {
    const wxml = read("pages/booking-workbench/booking-workbench.wxml")

    expect(wxml).toContain("status-action-chevron")
    expect(wxml).toContain("将预约标记为已联系")
    expect(wxml).toContain("item.status === 'pending' ? 'button' : ''")
    expect(wxml).not.toContain("' ›'")
  })

  test.each([
    "pages/booking/booking.wxml",
    "pages/vehicle-create/vehicle-create.wxml",
    "pages/vehicle-edit/vehicle-edit.wxml"
  ])("%s 的选择控件使用原生下拉箭头", (relativePath) => {
    const wxml = read(relativePath)

    expect(wxml).toContain("picker-chevron")
    expect(wxml).toContain("aria-label=\"选择")
    expect(wxml).not.toContain("⌄")
  })

  test("服务指南使用资料权益和客服支持原生图标", () => {
    const wxml = read("pages/content-page/content-page.wxml")

    expect(wxml).toContain("rights-document-icon")
    expect(wxml).toContain("support-headset-icon")
    expect(wxml).not.toContain('<view class="rights-icon">申</view>')
    expect(wxml).not.toContain('<view class="support-mark">?</view>')
  })

  test("车辆录入提示使用原生信息图标", () => {
    const wxml = read("pages/vehicle-create/vehicle-create.wxml")

    expect(wxml).toContain("tip-info-icon")
    expect(wxml).not.toContain('<view class="tip-mark">i</view>')
  })

  test("预约页面使用原生成功、警告和待确认状态图标", () => {
    const wxml = read("pages/booking/booking.wxml")

    expect(wxml).toContain("success-check-icon")
    expect(wxml).toContain("selection-check-icon")
    expect(wxml).toContain("state-alert-icon")
    expect(wxml).toContain("state-question-icon")
    expect(wxml).not.toContain('<view class="success-mark">✓</view>')
  })

  test("管理端冲突与空状态使用对应原生图标", () => {
    const calendar = read("pages/booking-calendar/booking-calendar.wxml")
    const detail = read("pages/booking-manage-detail/booking-manage-detail.wxml")
    const workbench = read("pages/booking-workbench/booking-workbench.wxml")

    expect(calendar).toContain("conflict-alert-icon")
    expect(detail).toContain("conflict-check-icon")
    expect(workbench).toContain("queue-empty-search-icon")
    expect(workbench).toContain("queue-empty-check-icon")
    expect(workbench).toContain("stage-finished-check-icon")
    expect(workbench).not.toContain("{{keyword ? '0' : '✓'}}")
    expect(workbench).not.toContain('<view class="stage-value stage-value-finished">✓</view>')
  })

  test("车库和工作台搜索框使用图形清除按钮", () => {
    const garage = read("pages/garage/garage.wxml")
    const workbench = read("pages/booking-workbench/booking-workbench.wxml")

    expect(garage).toContain("search-clear-icon")
    expect(garage).toContain('aria-label="清空车辆搜索关键词"')
    expect(garage).not.toContain('class="search-clear" bindtap="handleClearSearch">清除</button>')
    expect(workbench).toContain("search-clear-icon")
    expect(workbench).toContain('aria-label="清空待协调预约搜索关键词"')
    expect(workbench).not.toContain('class="search-clear" bindtap="handleClearKeyword">清除</view>')
  })
})
