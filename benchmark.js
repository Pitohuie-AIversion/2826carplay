const { main } = require('./cloudfunctions/bookingQuoteRespond/index');
const crypto = require("crypto");

// Mock wx-server-sdk
const mockDb = {
  serverDate: () => new Date(),
  collection: (name) => ({
    doc: (id) => ({
      update: async () => {},
      set: async () => {},
      field: () => ({
        get: async () => {
          if (name === 'bookings') return { data: { openid: 'test-openid', status: 'quoted', latestQuoteId: 'quote-1', vehicleId: 'vehicle-1', startDate: '2023-01-01', endDate: '2023-02-16' } };
          if (name === 'booking_quotes') return { data: { bookingId: 'booking-1', status: 'sent', validUntil: '2099-12-31' } };
          if (name === 'vehicles') return { data: { status: 'idle' } };
          if (name === 'vehicle_calendar_days') {
            const error = new Error("document not found");
            error.message = "document not found";
            throw error;
          }
        }
      })
    })
  }),
  runTransaction: async (cb) => {
    return await cb(mockDb);
  }
};

const cloud = require('wx-server-sdk');
cloud.init = () => {};
cloud.getWXContext = () => ({ OPENID: 'test-openid' });
cloud.database = () => mockDb;

async function run() {
  const start = Date.now();
  for (let i = 0; i < 50; i++) {
    await main({ bookingId: 'booking-1', quoteId: 'quote-1', action: 'confirm' });
  }
  const end = Date.now();
  console.log(`Time taken: ${end - start} ms`);
}

run();
