jest.mock("wx-server-sdk")

describe("contentGuideDetail", () => {
  let db
  let cloud
  let _test
  let main

  beforeEach(() => {
    jest.resetModules()
    db = {
      collection: jest.fn().mockReturnThis(),
      doc: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      field: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      get: jest.fn()
    }
    cloud = require("wx-server-sdk")
    cloud.database = jest.fn(() => db)

    const index = require("../../../cloudfunctions/contentGuideDetail/index")
    _test = index._test
    main = index.main
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe("toTimestamp", () => {
    let toTimestamp

    beforeEach(() => {
      toTimestamp = _test.toTimestamp
    })

    it("should return 0 for falsy values", () => {
      expect(toTimestamp(null)).toBe(0)
      expect(toTimestamp(undefined)).toBe(0)
      expect(toTimestamp("")).toBe(0)
      expect(toTimestamp(0)).toBe(0)
      expect(toTimestamp(false)).toBe(0)
    })

    it("should return correct timestamp for Date instances", () => {
      const now = new Date()
      expect(toTimestamp(now)).toBe(now.getTime())
    })

    it("should return correct timestamp for objects with toDate() method", () => {
      const now = new Date()
      const firebaseTimestampMock = {
        toDate: () => now
      }
      expect(toTimestamp(firebaseTimestampMock)).toBe(now.getTime())
    })

    it("should return correct timestamp for valid date strings", () => {
      const dateString = "2023-01-01T12:00:00Z"
      const expectedTimestamp = new Date(dateString).getTime()
      expect(toTimestamp(dateString)).toBe(expectedTimestamp)
    })

    it("should return correct timestamp for valid numeric values", () => {
      const timestamp = 1672574400000 // 2023-01-01T12:00:00Z
      expect(toTimestamp(timestamp)).toBe(timestamp)
    })

    it("should return 0 for invalid date strings/values", () => {
      expect(toTimestamp("invalid-date-string")).toBe(0)
      expect(toTimestamp({})).toBe(0)
      expect(toTimestamp([])).toBe(0)
    })
  })

  describe("readVehicle", () => {
    let readVehicle

    beforeEach(() => {
      readVehicle = _test.readVehicle
    })

    it("should return formatted vehicle with brandModel and coverImage", async () => {
      db.get.mockResolvedValueOnce({
        data: {
          status: "active",
          brandModel: "Brand Model A",
          coverImage: "cover.jpg",
          imageList: ["other.jpg"]
        }
      })
      const result = await readVehicle("v1")
      expect(result).toEqual({
        id: "v1",
        name: "Brand Model A",
        cover: "cover.jpg",
        status: "active"
      })
      expect(db.collection).toHaveBeenCalledWith("vehicles")
      expect(db.doc).toHaveBeenCalledWith("v1")
      expect(db.field).toHaveBeenCalledWith({ brandModel: true, name: true, coverImage: true, imageList: true, status: true })
    })

    it("should fallback to name and imageList[0]", async () => {
      db.get.mockResolvedValueOnce({
        data: {
          status: "active",
          name: "Name A",
          imageList: [null, "image1.jpg"]
        }
      })
      const result = await readVehicle("v2")
      expect(result).toEqual({
        id: "v2",
        name: "Name A",
        cover: "image1.jpg",
        status: "active"
      })
    })

    it("should fallback to default name and empty cover", async () => {
      db.get.mockResolvedValueOnce({
        data: {
          status: "active"
        }
      })
      const result = await readVehicle("v3")
      expect(result).toEqual({
        id: "v3",
        name: "车辆",
        cover: "",
        status: "active"
      })
    })

    it("should return null if status is retired", async () => {
      db.get.mockResolvedValueOnce({
        data: {
          status: "retired",
          name: "Name"
        }
      })
      const result = await readVehicle("v4")
      expect(result).toBeNull()
    })

    it("should return null if vehicle not found", async () => {
      db.get.mockResolvedValueOnce({ data: null })
      const result = await readVehicle("v5")
      expect(result).toBeNull()
    })

    it("should return null if db throws error", async () => {
      db.get.mockRejectedValueOnce(new Error("DB error"))
      const result = await readVehicle("v6")
      expect(result).toBeNull()
    })
  })

  describe("main", () => {
    let mockConsoleError

    beforeEach(() => {
      mockConsoleError = jest.spyOn(console, "error").mockImplementation(() => {})
    })

    afterEach(() => {
      mockConsoleError.mockRestore()
    })

    it("should return VALIDATION_ERROR for invalid contentId", async () => {
      const res1 = await main({ contentId: "invalid@id" })
      expect(res1).toEqual({ ok: false, code: "VALIDATION_ERROR", message: "内容标识格式不正确" })

      const res2 = await main({ slug: " " })
      expect(res2).toEqual({ ok: false, code: "VALIDATION_ERROR", message: "内容标识格式不正确" })

      const res3 = await main()
      expect(res3).toEqual({ ok: false, code: "VALIDATION_ERROR", message: "内容标识格式不正确" })
    })

    it("should return NOT_FOUND if guide doesn't exist", async () => {
      db.get.mockResolvedValueOnce({ data: [] })
      const res = await main({ contentId: "guide1" })
      expect(res).toEqual({ ok: false, code: "NOT_FOUND", message: "内容不存在或尚未发布" })
      expect(db.collection).toHaveBeenCalledWith("content_guides")
      expect(db.where).toHaveBeenCalledWith({ slug: "guide1" })
    })

    it("should return NOT_FOUND if guide status is not published", async () => {
      db.get.mockResolvedValueOnce({ data: [{ status: "draft", publishedAt: Date.now() }] })
      const res = await main({ contentId: "guide1" })
      expect(res).toEqual({ ok: false, code: "NOT_FOUND", message: "内容不存在或尚未发布" })
    })

    it("should return NOT_FOUND if publishedAt is invalid or future", async () => {
      db.get.mockResolvedValueOnce({ data: [{ status: "published", publishedAt: null }] })
      const res1 = await main({ contentId: "guide1" })
      expect(res1).toEqual({ ok: false, code: "NOT_FOUND", message: "内容不存在或尚未发布" })

      db.get.mockResolvedValueOnce({ data: [{ status: "published", publishedAt: Date.now() + 100000 }] })
      const res2 = await main({ contentId: "guide1" })
      expect(res2).toEqual({ ok: false, code: "NOT_FOUND", message: "内容不存在或尚未发布" })
    })

    it("should return guide and vehicles on success", async () => {
      const publishedAt = Date.now() - 10000
      db.get.mockImplementation(function() {
        if (this.collectionName === "content_guides") {
          return Promise.resolve({
            data: [{
              _id: "guide-id",
              slug: "guide1",
              status: "published",
              publishedAt,
              vehicleIds: ["v1", "v2", "invalid-id"]
            }]
          })
        }
        if (this.collectionName === "vehicles") {
          if (this.docId === "v1") {
            return Promise.resolve({ data: { status: "active", name: "Vehicle 1" } })
          }
          if (this.docId === "v2") {
            return Promise.resolve({ data: { status: "retired", name: "Vehicle 2" } })
          }
        }
        return Promise.resolve({ data: null })
      })

      // Capture calls properly
      db.collection = jest.fn((name) => {
        const chain = { collectionName: name }
        chain.doc = jest.fn((id) => { chain.docId = id; return chain })
        chain.where = jest.fn(() => chain)
        chain.field = jest.fn(() => chain)
        chain.limit = jest.fn(() => chain)
        chain.get = jest.fn(() => db.get.call(chain))
        return chain
      })

      const res = await main({ contentId: "guide1" })
      expect(res.ok).toBe(true)
      expect(res.guide).toEqual({
        _id: "guide-id",
        slug: "guide1",
        id: "guide1",
        publishedAt,
        vehicleIds: ["v1", "v2", "invalid-id"]
      })
      expect(res.vehicles).toEqual([
        { id: "v1", name: "Vehicle 1", cover: "", status: "active" }
      ])
    })

    it("should return INTERNAL_ERROR if db throws", async () => {
      db.get.mockRejectedValueOnce(new Error("DB connection failed"))
      const res = await main({ contentId: "guide1" })
      expect(res).toEqual({ ok: false, code: "INTERNAL_ERROR", message: "内容详情加载失败" })
      expect(mockConsoleError).toHaveBeenCalled()
    })
  })
})
