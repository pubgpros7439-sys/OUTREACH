const { google } = require('googleapis');
require('dotenv').config();

async function initSheet() {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  let privateKey = process.env.GOOGLE_PRIVATE_KEY;

  if (!spreadsheetId || !clientEmail || !privateKey) {
    console.error('Credentials missing.');
    process.exit(1);
  }

  privateKey = privateKey.replace(/\\n/g, '\n');

  const auth = new google.auth.JWT(
    clientEmail,
    null,
    privateKey,
    ['https://www.googleapis.com/auth/spreadsheets']
  );

  const sheets = google.sheets({ version: 'v4', auth });

  console.log('Retrieving spreadsheet info...');
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const mainSheetName = spreadsheet.data.sheets[0].properties.title;

  console.log(`Initializing headers and test row on tab "${mainSheetName}"...`);
  
  // Set headers in row 1
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${mainSheetName}'!A1:D1`,
    valueInputOption: 'USER_ENTERED',
    resource: {
      values: [['Email', 'Subject', 'Body', 'Sent']]
    }
  });

  // Add test row in row 2
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${mainSheetName}'!A2:D2`,
    valueInputOption: 'USER_ENTERED',
    resource: {
      values: [['teamdeployiq@gmail.com', 'Test Subject', 'This is a test body sent from the rate-limited outreach system.\n\nBest,\nKaran', '']]
    }
  });

  console.log('Sheet initialized successfully with headers and 1 test row!');
}

initSheet().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
