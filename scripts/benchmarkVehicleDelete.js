const { performance } = require("perf_hooks");

async function writeClaimMock(transaction, vehicleId, fileId, source, action) {
  // Simulate some async DB delay
  return new Promise(resolve => setTimeout(() => resolve(true), 20));
}

async function runBenchmark(n) {
  const fileList = Array.from({ length: n }, (_, i) => `cloud://file_${i}`);
  const claimedFiles = [];

  const start = performance.now();
  for (const fileId of fileList) {
    if (await writeClaimMock({}, "car_1", fileId, "vehicleDelete", "deleteVehicle")) claimedFiles.push(fileId)
  }
  const end = performance.now();
  console.log(`Sequential N+1 (${n} items): ${end - start}ms`);
}

async function runOptimizedBenchmark(n) {
  const fileList = Array.from({ length: n }, (_, i) => `cloud://file_${i}`);
  const claimedFiles = [];

  const start = performance.now();

  const claimResults = await Promise.all(
    fileList.map(async (fileId) => {
      const claimed = await writeClaimMock({}, "car_1", fileId, "vehicleDelete", "deleteVehicle");
      return { fileId, claimed };
    })
  );

  for (const res of claimResults) {
    if (res.claimed) claimedFiles.push(res.fileId);
  }

  const end = performance.now();
  console.log(`Concurrent Promise.all (${n} items): ${end - start}ms`);
}

async function run() {
  await runBenchmark(10);
  await runOptimizedBenchmark(10);
  await runBenchmark(50);
  await runOptimizedBenchmark(50);
}
run();
