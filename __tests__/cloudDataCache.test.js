const {
  fetchWithCache,
  getCached,
  setCache,
  invalidateCache
} = require("../shared/cloudDataCache")

describe("shared/cloudDataCache", () => {
  beforeEach(() => {
    invalidateCache()
  })

  test("首次请求执行 fetcher 并写入缓存", async () => {
    const fetcher = jest.fn().mockResolvedValue({ status: "ok" })
    const result = await fetchWithCache("test_key", fetcher, 1000)

    expect(result).toEqual({ status: "ok" })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(getCached("test_key", 1000)).toEqual({ status: "ok" })
  })

  test("TTL 内复用缓存数据，不重复执行 fetcher", async () => {
    const fetcher = jest.fn().mockResolvedValue("data_1")
    await fetchWithCache("test_key", fetcher, 5000)
    const secondResult = await fetchWithCache("test_key", fetcher, 5000)

    expect(secondResult).toBe("data_1")
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  test("超过 TTL 缓存过期并重新触发 fetcher", async () => {
    jest.useFakeTimers()
    const fetcher = jest.fn()
      .mockResolvedValueOnce("data_old")
      .mockResolvedValueOnce("data_new")

    await fetchWithCache("test_key", fetcher, 1000)
    jest.advanceTimersByTime(1001)

    const refreshed = await fetchWithCache("test_key", fetcher, 1000)
    expect(refreshed).toBe("data_new")
    expect(fetcher).toHaveBeenCalledTimes(2)
    jest.useRealTimers()
  })

  test("并发请求时 single-flight 合并，仅调用一次 fetcher", async () => {
    let resolvePromise
    const fetcher = jest.fn().mockReturnValue(
      new Promise((resolve) => {
        resolvePromise = resolve
      })
    )

    const p1 = fetchWithCache("flight_key", fetcher, 5000)
    const p2 = fetchWithCache("flight_key", fetcher, 5000)

    resolvePromise("flight_result")
    const [r1, r2] = await Promise.all([p1, p2])

    expect(r1).toBe("flight_result")
    expect(r2).toBe("flight_result")
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  test("fetcher 抛错时清除 pending 状态，后续调用能重新发起", async () => {
    const fetcher = jest.fn()
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce("recovered")

    await expect(fetchWithCache("error_key", fetcher, 5000)).rejects.toThrow("network error")
    const retryResult = await fetchWithCache("error_key", fetcher, 5000)

    expect(retryResult).toBe("recovered")
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  test("invalidateCache 支持按 key 清除和全局全量清除", () => {
    setCache("k1", "v1")
    setCache("k2", "v2")

    invalidateCache("k1")
    expect(getCached("k1", 5000)).toBeUndefined()
    expect(getCached("k2", 5000)).toBe("v2")

    invalidateCache()
    expect(getCached("k2", 5000)).toBeUndefined()
  })
})
