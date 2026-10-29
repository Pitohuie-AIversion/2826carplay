const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { createRequire } = require("module");

const modulePath = path.join(__dirname, "../pages/car-detail/car-detail.js");
const sandbox = {
  require: createRequire(modulePath),
  module: { exports: {} },
  Page: jest.fn()
};
vm.runInNewContext(`${fs.readFileSync(modulePath, "utf8")}\nmodule.exports = { drawPosterTextEllipsis };`, sandbox, { filename: modulePath });
const { drawPosterTextEllipsis } = sandbox.module.exports;

describe("drawPosterTextEllipsis", () => {
  let ctx;

  beforeEach(() => {
    ctx = {
      measureText: jest.fn(),
      fillText: jest.fn()
    };
  });

  test("returns early for empty or undefined text", () => {
    drawPosterTextEllipsis(ctx, undefined, 0, 0, 100);
    expect(ctx.fillText).not.toHaveBeenCalled();

    drawPosterTextEllipsis(ctx, "", 0, 0, 100);
    expect(ctx.fillText).not.toHaveBeenCalled();

    drawPosterTextEllipsis(ctx, "   ", 0, 0, 100);
    expect(ctx.fillText).not.toHaveBeenCalled();
  });

  test("happy path: text fits within maxWidth", () => {
    ctx.measureText.mockReturnValue({ width: 50 });
    drawPosterTextEllipsis(ctx, "hello", 10, 20, 100);

    expect(ctx.measureText).toHaveBeenCalledWith("hello");
    expect(ctx.fillText).toHaveBeenCalledWith("hello", 10, 20);
  });

  test("error path 1: first measureText throws error", () => {
    ctx.measureText.mockImplementation(() => {
      throw new Error("measureText not supported");
    });
    drawPosterTextEllipsis(ctx, "hello world", 10, 20, 100);

    expect(ctx.measureText).toHaveBeenCalledWith("hello world");
    expect(ctx.fillText).toHaveBeenCalledWith("hello world", 10, 20);
  });

  test("truncation logic: shortens text that exceeds maxWidth", () => {
    ctx.measureText.mockImplementation((str) => {
      if (str === "long text") return { width: 120 };
      if (str === "long text…") return { width: 115 };
      if (str === "long tex…") return { width: 110 };
      if (str === "long te…") return { width: 90 };
      return { width: 0 };
    });

    drawPosterTextEllipsis(ctx, "long text", 10, 20, 100);

    expect(ctx.measureText).toHaveBeenCalledWith("long text");
    expect(ctx.measureText).toHaveBeenCalledWith("long text…");
    expect(ctx.measureText).toHaveBeenCalledWith("long tex…");
    expect(ctx.measureText).toHaveBeenCalledWith("long te…");
    expect(ctx.fillText).toHaveBeenCalledWith("long te…", 10, 20);
  });

  test("error path 2: measureText throws error inside truncation loop", () => {
    ctx.measureText.mockImplementation((str) => {
      if (str === "long text") return { width: 120 };
      if (str === "long text…") return { width: 115 };
      if (str === "long tex…") throw new Error("measureText failed inside loop");
      return { width: 0 };
    });

    drawPosterTextEllipsis(ctx, "long text", 10, 20, 100);

    expect(ctx.measureText).toHaveBeenCalledWith("long text");
    expect(ctx.measureText).toHaveBeenCalledWith("long text…");
    expect(ctx.measureText).toHaveBeenCalledWith("long tex…");
    // Should break out and output the current truncated string with ...
    expect(ctx.fillText).toHaveBeenCalledWith("long tex…", 10, 20);
  });
});
