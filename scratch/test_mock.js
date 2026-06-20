const mockSheets = {
  spreadsheets: {
    get: async () => ({
      data: {
        sheets: [
          { properties: { title: 'Contacts' } },
          { properties: { title: 'Send Log' } }
        ]
      }
    }),
    batchUpdate: async () => {},
    values: {
      get: async ({ range }) => {
        if (range.includes('Send Log')) {
          // Return some mock logs to test daily limit
          // A1: Timestamp, Date (IST), Recipient, Subject, Status, Message ID / Error
          return {
            data: {
              values: [
                ['Timestamp', 'Date (IST)', 'Recipient', 'Subject', 'Status', 'Message ID / Error'],
                // Let's add 29 successful emails sent today to test limit
                ...Array.from({ length: 29 }, (_, i) => [
                  '2026-06-20 20:30:00 IST',
                  '2026-06-20',
                  `user${i}@example.com`,
                  'Test Subject',
                  'success',
                  'mock-id'
                ])
              ]
            }
          };
        } else {
          // Return contacts list
          // Column headers: Email, Subject, Body, Sent
          return {
            data: {
              values: [
                ['Email', 'Subject', 'Body', 'Sent'],
                ['target1@example.com', 'Subject 1', 'Body 1', ''],
                ['target2@example.com', 'Subject 2', 'Body 2', ''],
                ['target3@example.com', 'Subject 3', 'Body 3', '']
              ]
            }
          };
        }
      },
      update: async ({ range, resource }) => {
        console.log(`[Mock Sheet Update] Range: ${range}, Values:`, resource.values);
      },
      append: async ({ range, resource }) => {
        console.log(`[Mock Sheet Append] Range: ${range}, Values:`, resource.values);
      }
    }
  }
};

const mockTransporter = {
  sendMail: async (mailOptions) => {
    console.log('[Mock Mailer] Sending mail:', mailOptions);
    return { messageId: 'mock-msg-id-12345' };
  }
};

// Patch require cache before loading the email-system
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function(id) {
  if (id === 'googleapis') {
    return {
      google: {
        sheets: () => mockSheets,
        auth: {
          JWT: function() {
            return {};
          }
        }
      }
    };
  }
  if (id === 'nodemailer') {
    return {
      createTransport: () => mockTransporter
    };
  }
  return originalRequire.apply(this, arguments);
};

// Set mock env vars
process.env.GOOGLE_SHEET_ID = 'mock-sheet-id';
process.env.GOOGLE_CLIENT_EMAIL = 'mock-email';
process.env.GOOGLE_PRIVATE_KEY = 'mock-key';
process.env.ZOHO_EMAIL = 'karan@contentripple.in';
process.env.ZOHO_PASSWORD = 'mock-pass';

const { processCronJob } = require('../lib/email-system');

// We will run tests
async function runMockTests() {
  console.log('--- Running Mock Tests ---');
  
  // Test 1: Daily Limit Test (we set up 29 emails sent today in mock, so 1 send should succeed, taking it to 30)
  console.log('\n--- Test 1: Sending email when count is 29 (should succeed) ---');
  let res = await processCronJob(true);
  console.log('Result:', res);

  // Test 2: Daily Limit Reached (now count is 30 in mock, so sending should be skipped)
  console.log('\n--- Test 2: Sending email when count is 30 (should skip) ---');
  // Update mock to return 30 items
  mockSheets.spreadsheets.values.get = async ({ range }) => {
    if (range.includes('Send Log')) {
      return {
        data: {
          values: [
            ['Timestamp', 'Date (IST)', 'Recipient', 'Subject', 'Status', 'Message ID / Error'],
            ...Array.from({ length: 30 }, (_, i) => [
              '2026-06-20 20:30:00 IST',
              '2026-06-20',
              `user${i}@example.com`,
              'Test Subject',
              'success',
              'mock-id'
            ])
          ]
        }
      };
    } else {
      return {
        data: {
          values: [
            ['Email', 'Subject', 'Body', 'Sent'],
            ['target1@example.com', 'Subject 1', 'Body 1', ''],
            ['target2@example.com', 'Subject 2', 'Body 2', '']
          ]
        }
      };
    }
  };
  
  res = await processCronJob(true);
  console.log('Result:', res);

  // Test 3: Time window test
  console.log('\n--- Test 3: Enforcing time window (should skip if outside window) ---');
  res = await processCronJob(false);
  console.log('Result:', res);
}

runMockTests();
