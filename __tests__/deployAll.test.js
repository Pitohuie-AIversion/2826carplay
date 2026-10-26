const fs = require("fs");
const path = require("path");
const os = require("os");
const {
  computeFunctionFingerprint,
  readDeployCache,
  writeDeployCache,
  planDeployment,
  preflightCheck,
  deploySingleFunction,
  syncSecurityRules,
  deployWebAdminHosting
} = require("../scripts/deployAll");

describe("CloudBase Automated Deploy & Orchestration (scripts/deployAll.js)", () => {
  const tmpDir = path.join(os.tmpdir(), "deploy-test-" + Date.now());

  beforeAll(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterAll(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe("computeFunctionFingerprint", () => {
    test("calculates a deterministic 16-character SHA-256 fingerprint", () => {
      const hash1 = computeFunctionFingerprint("adminImageUpload");
      const hash2 = computeFunctionFingerprint("adminImageUpload");
      expect(hash1).toBeDefined();
      expect(typeof hash1).toBe("string");
      expect(hash1.length).toBe(16);
      expect(hash1).toBe(hash2);
    });

    test("returns null if the function directory does not exist", () => {
      const hash = computeFunctionFingerprint("non_existent_function_xyz");
      expect(hash).toBeNull();
    });

    test("fingerprint changes when function cloudbaserc config changes", () => {
      const baseConfig = { timeout: 15, memorySize: 256, runtime: "Nodejs24.11" };
      const modifiedConfig = { timeout: 60, memorySize: 512, runtime: "Nodejs24.11" };

      const hashBase = computeFunctionFingerprint("adminImageUpload", undefined, baseConfig);
      const hashMod = computeFunctionFingerprint("adminImageUpload", undefined, modifiedConfig);

      expect(hashBase).not.toBe(hashMod);
    });

    test("fingerprint changes when function code file content changes in a sandbox directory", () => {
      const fnDir = path.join(tmpDir, "testFn");
      fs.mkdirSync(fnDir, { recursive: true });
      fs.writeFileSync(path.join(fnDir, "index.js"), 'exports.main = async () => "v1";');
      fs.writeFileSync(path.join(fnDir, "package.json"), '{"name": "testFn", "version": "1.0.0"}');

      const hashV1 = computeFunctionFingerprint("testFn", tmpDir, { timeout: 15 });

      // Modify code
      fs.writeFileSync(path.join(fnDir, "index.js"), 'exports.main = async () => "v2";');
      const hashV2 = computeFunctionFingerprint("testFn", tmpDir, { timeout: 15 });

      expect(hashV1).not.toBe(hashV2);
    });
  });

  describe("readDeployCache and writeDeployCache", () => {
    test("returns empty defaults when cache file does not exist", () => {
      const dummyPath = path.join(tmpDir, "missing-cache.json");
      const cache = readDeployCache(dummyPath);
      expect(cache).toEqual({ version: "1.0.0", environments: {} });
    });

    test("writes and reads back cache faithfully", () => {
      const dummyPath = path.join(tmpDir, "test-cache.json");
      const sample = {
        version: "1.0.0",
        environments: {
          "env-test": {
            functions: {
              adminImageUpload: { hash: "1234567890abcdef", deployedAt: "2026-10-26T00:00:00.000Z" }
            }
          }
        }
      };

      const writeOk = writeDeployCache(sample, dummyPath);
      expect(writeOk).toBe(true);

      const readBack = readDeployCache(dummyPath);
      expect(readBack).toEqual(sample);
    });
  });

  describe("planDeployment", () => {
    test("identifies NEW functions when cache is empty", () => {
      const emptyCache = { version: "1.0.0", environments: {} };
      const planRes = planDeployment({
        envId: "test-env",
        targetFunctions: ["adminImageUpload", "bookingCreate"],
        cache: emptyCache
      });

      expect(planRes.envId).toBe("test-env");
      expect(planRes.selected).toBe(2);
      expect(planRes.toDeploy.length).toBe(2);
      expect(planRes.toDeploy.every((p) => p.status === "NEW")).toBe(true);
    });

    test("identifies UNCHANGED functions when current hash matches cached hash", () => {
      const currentHash = computeFunctionFingerprint("adminImageUpload");
      const mockCache = {
        version: "1.0.0",
        environments: {
          "test-env": {
            functions: {
              adminImageUpload: { hash: currentHash, deployedAt: "2026-10-26T00:00:00.000Z" }
            }
          }
        }
      };

      const planRes = planDeployment({
        envId: "test-env",
        targetFunctions: ["adminImageUpload"],
        cache: mockCache
      });

      expect(planRes.toDeploy.length).toBe(0);
      expect(planRes.unchanged.length).toBe(1);
      expect(planRes.unchanged[0].status).toBe("UNCHANGED");
    });

    test("identifies MODIFIED functions when current hash differs from cached hash", () => {
      const mockCache = {
        version: "1.0.0",
        environments: {
          "test-env": {
            functions: {
              adminImageUpload: { hash: "old_outdated_hash", deployedAt: "2026-10-25T00:00:00.000Z" }
            }
          }
        }
      };

      const planRes = planDeployment({
        envId: "test-env",
        targetFunctions: ["adminImageUpload"],
        cache: mockCache
      });

      expect(planRes.toDeploy.length).toBe(1);
      expect(planRes.toDeploy[0].status).toBe("MODIFIED");
    });

    test("marks functions as FORCED when force: true even if hash matches", () => {
      const currentHash = computeFunctionFingerprint("adminImageUpload");
      const mockCache = {
        version: "1.0.0",
        environments: {
          "test-env": {
            functions: {
              adminImageUpload: { hash: currentHash, deployedAt: "2026-10-26T00:00:00.000Z" }
            }
          }
        }
      };

      const planRes = planDeployment({
        envId: "test-env",
        targetFunctions: ["adminImageUpload"],
        force: true,
        cache: mockCache
      });

      expect(planRes.toDeploy.length).toBe(1);
      expect(planRes.toDeploy[0].status).toBe("FORCED");
    });
  });

  describe("preflightCheck", () => {
    test("verifies project configuration files and manifests", () => {
      const res = preflightCheck("cloud1-d8gtmns36320e045e");
      // Since repo has all required files, issues array should not contain file-missing errors
      expect(res.issues.some((i) => i.includes("文件不存在"))).toBe(false);
    });
  });

  describe("deploySingleFunction dry-run", () => {
    test("returns simulated success in dry-run mode without spawning child process", () => {
      const res = deploySingleFunction("adminImageUpload", "test-env", true);
      expect(res.ok).toBe(true);
      expect(res.dryRun).toBe(true);
      expect(res.name).toBe("adminImageUpload");
    });
  });

  describe("syncSecurityRules", () => {
    test("correctly parses security manifest and reads 17 collections", () => {
      const res = syncSecurityRules("cloud1-d8gtmns36320e045e", true);
      expect(res.collectionsCount).toBe(17);
      expect(res.storageRule).toBeDefined();
      expect(res.dbRule).toBeDefined();
      expect(res.dbRule.read).toBe(false);
      expect(res.dbRule.write).toBe(false);
    });
  });

  describe("deployWebAdminHosting dry-run", () => {
    test("returns ok in dry-run mode", () => {
      const res = deployWebAdminHosting("cloud1-d8gtmns36320e045e", true);
      expect(res.ok).toBe(true);
      expect(res.dryRun).toBe(true);
    });
  });
});
