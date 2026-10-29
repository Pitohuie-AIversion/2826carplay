1. **Analyze the Issue**:
   The code at `pages/booking-manage/booking-manage.js:506-510` has a `try-catch` block around `wx.cloud.callFunction(requestOptions)`. We need to add a test in the relevant test file (`__tests__/csvExportLifecycle.page.test.js`) to cover the case where `wx.cloud.callFunction` throws an error synchronously (not a late transport error as already covered, but an immediate one) which will hit the `catch` block and invoke `handlePreparationFailure`.

2. **Review `__tests__/csvExportLifecycle.page.test.js`**:
   The current test file covers several asynchronous operations but lacks a test specifically for when `wx.cloud.callFunction` throws immediately inside the `try` block for the `bookingExportCsv` request in `handleExport()`.

3. **Implement the Test**:
   Add a test case in `__tests__/csvExportLifecycle.page.test.js` (inside the `describe` block) that mocks `wx.cloud.callFunction` to throw an error immediately and verifies that the error is handled gracefully. We need to check that `handlePreparationFailure` (which calls `handleFailure` and resets states like `this.setData({ loading: false })` and shows a toast) is executed.

4. **Pre-commit Checks**: Run pre-commit instructions.
5. **Submit**: Create PR.
