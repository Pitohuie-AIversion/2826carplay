## 2023-11-09 - [Optimize DB Read Bottlenecks in Transaction]
**Learning:** Found N+1 sequential database reads inside transactions in `bookingCancel` where it queries `vehicle_calendar_days` using a loop.
**Action:** Use `Promise.all` with `transaction.collection().doc(id).get()` to fetch the documents concurrently inside the transaction, optimizing the performance. Ensure that the IDs are properly mapped to documents. We can apply this pattern using `Promise.all` inside cloud functions for transactions and lists.
