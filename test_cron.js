const { processCronJob } = require('./lib/email-system');
require('dotenv').config();

async function runTest() {
  console.log('--- Simulating Cron Email Sending System ---');
  
  // Parse command line arguments
  const bypassTimeCheck = process.argv.includes('--bypass-time-check') || process.argv.includes('-b');
  
  if (bypassTimeCheck) {
    console.log('Option: Bypassing time window check (--bypass-time-check is set).');
  }

  try {
    const result = await processCronJob(bypassTimeCheck);
    console.log('Result:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Error executing test:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
  }
  console.log('--------------------------------------------');
}

runTest();
