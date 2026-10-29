const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');

describe("Booking Manage Error Utils", () => {
  let env;
  let sandbox;

  beforeAll(() => {
    const modulePath = path.join(__dirname, '../pages/booking-manage/booking-manage.js');
    const code = fs.readFileSync(modulePath, 'utf8');
    sandbox = {
      require: createRequire(modulePath),
      module: { exports: {} },
      Page: jest.fn()
    };
    vm.runInNewContext(`${code}\n
      module.exports = {
        getErrorMessage,
        isTapGestureShareError,
        isDevtoolsEnv,
        isDevtoolsNotSupportedShareError
      };
    `, sandbox, { filename: modulePath });
    env = sandbox.module.exports;
  });

  describe("getErrorMessage", () => {
    it("should handle null or undefined", () => {
      expect(env.getErrorMessage(null)).toBe("");
      expect(env.getErrorMessage(undefined)).toBe("");
    });

    it("should extract from errMsg", () => {
      expect(env.getErrorMessage({ errMsg: "test error msg" })).toBe("test error msg");
    });

    it("should extract from message", () => {
      expect(env.getErrorMessage({ message: "test error message" })).toBe("test error message");
    });

    it("should extract from errMsg preferring it over message", () => {
      expect(env.getErrorMessage({ errMsg: "primary", message: "secondary" })).toBe("primary");
    });

    it("should stringify other errors", () => {
      expect(env.getErrorMessage("string error")).toBe("string error");
      expect(env.getErrorMessage(123)).toBe("123");
    });
  });

  describe("isTapGestureShareError", () => {
    it("should return true when error message contains 'tap gesture'", () => {
      expect(env.isTapGestureShareError({ message: "Can only be invoked by user TAP gesture" })).toBe(true);
      expect(env.isTapGestureShareError({ errMsg: "tap gesture required" })).toBe(true);
    });

    it("should return false when error message does not contain 'tap gesture'", () => {
      expect(env.isTapGestureShareError({ message: "Network error" })).toBe(false);
      expect(env.isTapGestureShareError(new Error("Something went wrong"))).toBe(false);
      expect(env.isTapGestureShareError(null)).toBe(false);
    });
  });

  describe("isDevtoolsEnv", () => {
    beforeEach(() => {
      sandbox.wx = {
        getSystemInfoSync: jest.fn()
      };
    });

    afterEach(() => {
      delete sandbox.wx;
    });

    it("should return true when platform is 'devtools'", () => {
      sandbox.wx.getSystemInfoSync.mockReturnValue({ platform: "devtools" });
      expect(env.isDevtoolsEnv()).toBe(true);
    });

    it("should return false when platform is not 'devtools'", () => {
      sandbox.wx.getSystemInfoSync.mockReturnValue({ platform: "ios" });
      expect(env.isDevtoolsEnv()).toBe(false);
    });

    it("should return false when getSystemInfoSync returns null/undefined", () => {
      sandbox.wx.getSystemInfoSync.mockReturnValue(null);
      expect(env.isDevtoolsEnv()).toBe(false);
    });

    it("should return false when wx is undefined", () => {
      delete sandbox.wx;
      expect(env.isDevtoolsEnv()).toBe(false);
    });

    it("should return false when wx.getSystemInfoSync is not a function", () => {
      sandbox.wx = { getSystemInfoSync: "not a function" };
      expect(env.isDevtoolsEnv()).toBe(false);
    });

    it("should return false when getSystemInfoSync throws an error", () => {
      sandbox.wx.getSystemInfoSync.mockImplementation(() => {
        throw new Error("API not available");
      });
      expect(env.isDevtoolsEnv()).toBe(false);
    });
  });

  describe("isDevtoolsNotSupportedShareError", () => {
    it("should return true when error message contains '开发者工具'", () => {
      expect(env.isDevtoolsNotSupportedShareError({ message: "开发者工具不支持分享" })).toBe(true);
    });

    it("should return true when error message contains '不支持'", () => {
      expect(env.isDevtoolsNotSupportedShareError({ errMsg: "当前环境不支持此功能" })).toBe(true);
    });

    it("should return false when error message does not match", () => {
      expect(env.isDevtoolsNotSupportedShareError({ message: "Network error" })).toBe(false);
    });

    it("should return false when error is null/undefined", () => {
      expect(env.isDevtoolsNotSupportedShareError(null)).toBe(false);
    });
  });
});
