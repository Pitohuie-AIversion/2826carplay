const {
  fetchWithCache,
  getCached,
  setCache,
  invalidateCache
} = require("../shared/cloudDataCache")

function createDeferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

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

  test("失效后旧请求先返回，不回写缓存或移除新请求的并发合并状态", async () => {
    const oldRequest = createDeferred()
    const freshRequest = createDeferred()
    const oldPromise = fetchWithCache("race", () => oldRequest.promise)
    invalidateCache("race")
    const freshPromise = fetchWithCache("race", () => freshRequest.promise)

    oldRequest.resolve("old")
    await expect(oldPromise).resolves.toBe("old")
    expect(getCached("race")).toBeUndefined()
    const extraFetcher = jest.fn()
    expect(fetchWithCache("race", extraFetcher)).toBe(freshPromise)

    freshRequest.resolve("fresh")
    await expect(freshPromise).resolves.toBe("fresh")
    expect(getCached("race")).toBe("fresh")
    expect(extraFetcher).not.toHaveBeenCalled()
  })

  test("失效后新请求先返回，旧响应不能覆盖新缓存", async () => {
    const oldRequest = createDeferred()
    const oldPromise = fetchWithCache("race", () => oldRequest.promise)
    invalidateCache("race")
    await fetchWithCache("race", () => "fresh")

    oldRequest.resolve("old")
    await expect(oldPromise).resolves.toBe("old")
    expect(getCached("race")).toBe("fresh")
  })

  test("失效后旧请求失败，不移除仍在执行的新请求", async () => {
    const oldRequest = createDeferred()
    const freshRequest = createDeferred()
    const oldPromise = fetchWithCache("race", () => oldRequest.promise)
    const failed = expect(oldPromise).rejects.toThrow("old request failed")
    invalidateCache("race")
    const freshPromise = fetchWithCache("race", () => freshRequest.promise)

    oldRequest.reject(new Error("old request failed"))
    await failed
    expect(fetchWithCache("race", jest.fn())).toBe(freshPromise)
    freshRequest.resolve("fresh")
    await freshPromise
    expect(getCached("race")).toBe("fresh")
  })

  test("全量失效阻止所有在途请求重新填入缓存，且保留后来请求", async () => {
    const firstRequest = createDeferred()
    const secondRequest = createDeferred()
    const freshRequest = createDeferred()
    const firstPromise = fetchWithCache("first", () => firstRequest.promise)
    const secondPromise = fetchWithCache("second", () => secondRequest.promise)
    invalidateCache()
    const freshPromise = fetchWithCache("first", () => freshRequest.promise)

    firstRequest.resolve("old first")
    secondRequest.resolve("old second")
    await Promise.all([firstPromise, secondPromise])
    expect(getCached("first")).toBeUndefined()
    expect(getCached("second")).toBeUndefined()
    expect(fetchWithCache("first", jest.fn())).toBe(freshPromise)

    freshRequest.resolve("fresh")
    await freshPromise
    expect(getCached("first")).toBe("fresh")
  })

  test("手动写入缓存后旧响应不会覆盖显式更新", async () => {
    const oldRequest = createDeferred()
    const oldPromise = fetchWithCache("manual", () => oldRequest.promise)
    setCache("manual", "manual update")

    oldRequest.resolve("old")
    await oldPromise
    expect(getCached("manual")).toBe("manual update")
  })

  test("手动缓存过期后重新请求，不再合并到被手动写入废弃的请求", async () => {
    const clock = jest.spyOn(Date, "now").mockReturnValue(1000)
    try {
      const oldRequest = createDeferred()
      const oldPromise = fetchWithCache("manual", () => oldRequest.promise, 100)
      setCache("manual", "manual update")
      clock.mockReturnValue(1101)
      const freshFetcher = jest.fn().mockResolvedValue("fresh")
      const freshPromise = fetchWithCache("manual", freshFetcher, 100)
      expect(freshPromise).not.toBe(oldPromise)

      await expect(freshPromise).resolves.toBe("fresh")
      oldRequest.resolve("old")
      await oldPromise
      expect(getCached("manual", 100)).toBe("fresh")
      expect(freshFetcher).toHaveBeenCalledTimes(1)
    } finally {
      clock.mockRestore()
    }
  })

  test("按 key 失效不会废弃其他 key 的在途请求", async () => {
    const request = createDeferred()
    const promise = fetchWithCache("unaffected", () => request.promise)
    invalidateCache("different")
    expect(fetchWithCache("unaffected", jest.fn())).toBe(promise)
    request.resolve("kept")
    await promise
    expect(getCached("unaffected")).toBe("kept")
  })
})
