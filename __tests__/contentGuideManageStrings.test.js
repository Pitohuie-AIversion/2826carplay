describe("contentGuideManage utility functions", () => {
  let mod;
  let text, strings, isAdmin;

  beforeEach(() => {
    jest.resetModules();
    const freshCloud = require("wx-server-sdk");
    freshCloud.__reset();

    jest.isolateModules(() => {
      mod = require("../cloudfunctions/contentGuideManage/index.js");
    });

    text = mod.text;
    strings = mod.strings;
    isAdmin = mod.isAdmin;
  });

  describe("text", () => {
    it("handles null, undefined gracefully", () => {
      expect(text(null, 5)).toBe("");
      expect(text(undefined, 5)).toBe("");
    });

    it("handles numbers and booleans by casting to string", () => {
      expect(text(12345, 5)).toBe("12345");
      expect(text(true, 5)).toBe("true");
    });

    it("trims whitespace from beginning and end", () => {
      expect(text("  hello  ", 5)).toBe("hello");
      expect(text("\t test \n", 4)).toBe("test");
    });

    it("slices correctly up to max characters", () => {
      expect(text("1234567890", 5)).toBe("12345");
      expect(text("  1234567890  ", 5)).toBe("12345");
    });
  });

  describe("strings", () => {
    it("handles non-array inputs", () => {
      expect(strings("not array", 5, 5)).toEqual([]);
      expect(strings(null, 5, 5)).toEqual([]);
      expect(strings(undefined, 5, 5)).toEqual([]);
      expect(strings({}, 5, 5)).toEqual([]);
    });

    it("applies text formatting to elements", () => {
      expect(strings(["  abc  ", "defghi"], 5, 3)).toEqual(["abc", "def"]);
      expect(strings([1234, true], 5, 4)).toEqual(["1234", "true"]);
    });

    it("filters out empty strings", () => {
      expect(strings(["", "  ", null, undefined, "valid"], 5, 5)).toEqual(["valid"]);
    });

    it("deduplicates identical strings after processing", () => {
      // "  a" and "a " both become "a" after trim, so only one should be kept
      expect(strings(["  a", "a ", "a"], 5, 5)).toEqual(["a"]);

      // "1234" and "123456" become "1234" after slicing to max 4, so deduplicate
      expect(strings(["1234", "123456"], 5, 4)).toEqual(["1234"]);
    });

    it("respects maxItems limit", () => {
      expect(strings(["a", "b", "c", "d", "e"], 3, 5)).toEqual(["a", "b", "c"]);
    });
  });

  describe("isAdmin", () => {
    it("handles null and undefined records gracefully", () => {
      expect(isAdmin(null)).toBe(false);
      expect(isAdmin(undefined)).toBe(false);
      expect(isAdmin({})).toBe(false);
    });

    it("evaluates true conditions: role, isAdmin, admin", () => {
      expect(isAdmin({ role: "admin" })).toBe(true);
      expect(isAdmin({ isAdmin: true })).toBe(true);
      expect(isAdmin({ admin: true })).toBe(true);
    });

    it("evaluates true conditions for arrays: roles, permissions", () => {
      expect(isAdmin({ roles: ["admin", "editor"] })).toBe(true);
      expect(isAdmin({ permissions: ["reader", "admin"] })).toBe(true);
    });

    it("evaluates false conditions correctly", () => {
      expect(isAdmin({ role: "user" })).toBe(false);
      expect(isAdmin({ isAdmin: false })).toBe(false);
      expect(isAdmin({ admin: false })).toBe(false);
      expect(isAdmin({ roles: ["editor", "viewer"] })).toBe(false);
      expect(isAdmin({ permissions: [] })).toBe(false);
      expect(isAdmin({ roles: "admin" })).toBe(false); // roles is string, not array
      expect(isAdmin({ permissions: "admin" })).toBe(false); // permissions is string, not array
    });
  });
});
