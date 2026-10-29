const { enumerateDates, dayDocumentId } = require('./cloudfunctions/vehicleCalendarManage/index.js')._test;

function createError(code, message, payload) {
  return { code, message, ...payload };
}

async function runBench() {
  const dates = enumerateDates('2023-01-01', '2023-01-31');
  const block = { vehicleId: 'v123', id: 'b123', kind: 'maintenance', bookingId: 'booking123' };

  // mock transaction
  let callCount = 0;
  const setMock = async () => {
    callCount++;
    return new Promise(resolve => setTimeout(resolve, 10)); // simulate 10ms network/db delay
  };
  const getMock = async () => {
    return new Promise(resolve => setTimeout(() => resolve({ data: { blockId: 'b123' } }), 10)); // simulate 10ms
  };
  const removeMock = async () => {
    return new Promise(resolve => setTimeout(resolve, 10));
  };

  const transaction = {
    collection: () => ({
      doc: () => ({
        set: setMock,
        get: getMock,
        remove: removeMock
      })
    })
  };

  const dbMock = { serverDate: () => new Date() };
  global.db = dbMock;
  global.getDocOrNull = async function getDocOrNull(collection, id, fields) {
    const res = await collection.doc(id).get();
    return res && res.data ? res.data : null;
  }

  const seqSaveDays = async (transaction, block, dates) => {
    for (const date of dates) {
      await transaction.collection("vehicle_calendar_days").doc(dayDocumentId(block.vehicleId, date)).set({
        data: {
          vehicleId: block.vehicleId,
          date,
          blockId: block.id,
          kind: block.kind,
          bookingId: block.bookingId || "",
          createdAt: dbMock.serverDate(),
          updatedAt: dbMock.serverDate()
        }
      })
    }
  }

  const concSaveDays = async (transaction, block, dates) => {
    await Promise.all(dates.map(date =>
      transaction.collection("vehicle_calendar_days").doc(dayDocumentId(block.vehicleId, date)).set({
        data: {
          vehicleId: block.vehicleId,
          date,
          blockId: block.id,
          kind: block.kind,
          bookingId: block.bookingId || "",
          createdAt: dbMock.serverDate(),
          updatedAt: dbMock.serverDate()
        }
      })
    ))
  }

  let start = Date.now();
  await seqSaveDays(transaction, block, dates);
  console.log(`Sequential saveDays: ${Date.now() - start}ms`);

  start = Date.now();
  await concSaveDays(transaction, block, dates);
  console.log(`Concurrent saveDays: ${Date.now() - start}ms`);

  const seqEnsureDatesFree = async (transaction, vehicleId, dates, ignoredBlockId, dayCache = new Map()) => {
    for (const date of dates) {
      const id = dayDocumentId(vehicleId, date)
      const occupied = dayCache.has(id) ? dayCache.get(id) : await getDocOrNull(transaction.collection("vehicle_calendar_days"), id, { blockId: true, kind: true, date: true })
      if (occupied && String(occupied.blockId || "") !== ignoredBlockId) {
        return createError("AVAILABILITY_CONFLICT", `${date} 已被占用，请调整区间`, { date, kind: occupied.kind || "unavailable" })
      }
    }
    return null
  }

  const concEnsureDatesFree = async (transaction, vehicleId, dates, ignoredBlockId, dayCache = new Map()) => {
    const results = await Promise.all(dates.map(async (date) => {
      const id = dayDocumentId(vehicleId, date)
      const occupied = dayCache.has(id) ? dayCache.get(id) : await getDocOrNull(transaction.collection("vehicle_calendar_days"), id, { blockId: true, kind: true, date: true })
      if (occupied && String(occupied.blockId || "") !== ignoredBlockId) {
        return createError("AVAILABILITY_CONFLICT", `${date} 已被占用，请调整区间`, { date, kind: occupied.kind || "unavailable" })
      }
      return null
    }))
    return results.find(err => err) || null
  }

  start = Date.now();
  await seqEnsureDatesFree(transaction, block.vehicleId, dates, 'b123');
  console.log(`Sequential ensureDatesFree: ${Date.now() - start}ms`);

  start = Date.now();
  await concEnsureDatesFree(transaction, block.vehicleId, dates, 'b123');
  console.log(`Concurrent ensureDatesFree: ${Date.now() - start}ms`);
}

runBench();
