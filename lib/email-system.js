const { google } = require('googleapis');
const nodemailer = require('nodemailer');
require('dotenv').config();

// Helper to convert 0-based index to Google Sheets column letter (e.g. 0 -> A, 27 -> AB)
function getColumnLetter(colIndex) {
  let temp = colIndex;
  let letter = '';
  while (temp >= 0) {
    letter = String.fromCharCode((temp % 26) + 65) + letter;
    temp = Math.floor(temp / 26) - 1;
  }
  return letter;
}

// Get current time details in IST (Asia/Kolkata)
function getISTTime() {
  const date = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  
  const parts = formatter.formatToParts(date);
  const temp = {};
  parts.forEach(({ type, value }) => {
    temp[type] = value;
  });
  
  return {
    year: parseInt(temp.year, 10),
    month: parseInt(temp.month, 10),
    day: parseInt(temp.day, 10),
    hour: parseInt(temp.hour, 10),
    minute: parseInt(temp.minute, 10),
    second: parseInt(temp.second, 10),
    dateString: `${temp.year}-${temp.month}-${temp.day}`,
    fullIST: `${temp.year}-${temp.month}-${temp.day} ${temp.hour}:${temp.minute}:${temp.second} IST`
  };
}

async function processCronJob(bypassTimeCheck = false) {
  const ist = getISTTime();
  
  // 1. Time Window Check (8:30 PM - 10:30 PM IST)
  const minutesSinceMidnight = ist.hour * 60 + ist.minute;
  const startWindow = 20 * 60 + 30; // 8:30 PM = 1230 minutes
  const endWindow = 22 * 60 + 30;   // 10:30 PM = 1350 minutes
  const isWithinWindow = minutesSinceMidnight >= startWindow && minutesSinceMidnight <= endWindow;

  if (!isWithinWindow && !bypassTimeCheck) {
    const message = `Skipped: Outside sending window (8:30 PM - 10:30 PM IST). Current IST: ${ist.fullIST}`;
    console.log(message);
    return { status: 'skipped', reason: 'outside_time_window', timestamp: ist.fullIST };
  }

  // 2. Validate environment variables
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  let privateKey = process.env.GOOGLE_PRIVATE_KEY;
  const zohoEmail = process.env.ZOHO_EMAIL;
  const zohoPassword = process.env.ZOHO_PASSWORD;

  if (!spreadsheetId || !clientEmail || !privateKey) {
    throw new Error('Google Sheets API credentials (GOOGLE_SHEET_ID, GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY) are missing in environment.');
  }
  if (!zohoEmail || !zohoPassword) {
    throw new Error('Zoho SMTP credentials (ZOHO_EMAIL, ZOHO_PASSWORD) are missing in environment.');
  }

  // Format private key (handle Vercel and local newline issues)
  privateKey = privateKey.replace(/\\n/g, '\n');

  // 3. Authenticate with Google Sheets API
  const auth = new google.auth.JWT(
    clientEmail,
    null,
    privateKey,
    ['https://www.googleapis.com/auth/spreadsheets']
  );

  const sheets = google.sheets({ version: 'v4', auth });

  // 4. Retrieve Spreadsheet Metadata to get sheets/tabs and dynamically locate names
  console.log('Retrieving spreadsheet metadata...');
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetNames = spreadsheet.data.sheets.map(s => s.properties.title);
  const mainSheetName = spreadsheet.data.sheets[0].properties.title;
  const logSheetName = 'Send Log';

  // 5. Ensure "Send Log" tab exists
  if (!sheetNames.includes(logSheetName)) {
    console.log(`Creating sheet tab "${logSheetName}"...`);
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: {
        requests: [{
          addSheet: {
            properties: { title: logSheetName }
          }
        }]
      }
    });
    // Append header row
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `'${logSheetName}'!A1`,
      valueInputOption: 'RAW',
      resource: {
        values: [['Timestamp', 'Date (IST)', 'Recipient', 'Subject', 'Status', 'Message ID / Error']]
      }
    });
  }

  // 6. Check Daily Limit (Max 30 emails successfully sent today)
  console.log('Checking daily limit from log sheet...');
  const logResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${logSheetName}'!A:F`
  });

  const logRows = logResponse.data.values || [];
  let sentTodayCount = 0;
  const todayDateStr = ist.dateString;

  for (let i = 1; i < logRows.length; i++) {
    const rowDate = logRows[i][1]; // Column B is Date (IST)
    const rowStatus = logRows[i][4]; // Column E is Status
    if (rowDate === todayDateStr && rowStatus === 'success') {
      sentTodayCount++;
    }
  }

  console.log(`Daily Send Count for ${todayDateStr}: ${sentTodayCount} / 30`);
  if (sentTodayCount >= 30) {
    const message = `Skipped: Daily limit of 30 emails reached for today (${todayDateStr}).`;
    console.log(message);
    return { status: 'skipped', reason: 'daily_limit_reached', count: sentTodayCount, date: todayDateStr };
  }

  // 7. Read Main Sheets Contacts
  console.log(`Reading contacts from "${mainSheetName}"...`);
  const contactsResponse = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${mainSheetName}'!A:Z`
  });

  const contactRows = contactsResponse.data.values;
  if (!contactRows || contactRows.length <= 1) {
    console.log('No contact rows found in the sheet.');
    return { status: 'skipped', reason: 'no_contacts_found' };
  }

  // Locate column headers
  const headers = contactRows[0].map(h => h.trim().toLowerCase());
  const emailIndex = headers.indexOf('email');
  const subjectIndex = headers.indexOf('subject');
  const bodyIndex = headers.indexOf('body');
  const sentIndex = headers.indexOf('sent');

  if (emailIndex === -1 || subjectIndex === -1 || bodyIndex === -1 || sentIndex === -1) {
    throw new Error(`Required columns missing in "${mainSheetName}". Found: ${contactRows[0].join(', ')}. Required (case-insensitive): Email, Subject, Body, Sent`);
  }

  // 8. Find the first row that is ready to be sent
  let targetRow = null;
  let targetRowIndex = -1;

  for (let i = 1; i < contactRows.length; i++) {
    const row = contactRows[i];
    const email = row[emailIndex] ? row[emailIndex].trim() : '';
    const subject = row[subjectIndex] ? row[subjectIndex].trim() : '';
    const body = row[bodyIndex] ? row[bodyIndex].trim() : '';
    const sent = row[sentIndex] ? row[sentIndex].trim() : '';

    if (email && subject && body && !sent) {
      targetRow = { email, subject, body };
      targetRowIndex = i;
      break; // Send exactly one email per cron execution
    }
  }

  if (!targetRow) {
    console.log('No unsent email rows found.');
    return { status: 'skipped', reason: 'no_unsent_rows_found' };
  }

  // 9. Send Email via Nodemailer
  console.log(`Sending email to ${targetRow.email}...`);
  const transporter = nodemailer.createTransport({
    host: process.env.ZOHO_HOST || 'smtp.zoho.com',
    port: parseInt(process.env.ZOHO_PORT || '465', 10),
    secure: process.env.ZOHO_SECURE !== 'false',
    auth: {
      user: zohoEmail,
      pass: zohoPassword
    }
  });

  let success = false;
  let messageIdOrError = '';

  try {
    const info = await transporter.sendMail({
      from: zohoEmail,
      to: targetRow.email,
      subject: targetRow.subject,
      text: targetRow.body,
      html: targetRow.body.replace(/\n/g, '<br>')
    });
    success = true;
    messageIdOrError = info.messageId;
    console.log(`Email sent successfully. Message ID: ${info.messageId}`);
  } catch (error) {
    success = false;
    messageIdOrError = error.message;
    console.error(`Error sending email to ${targetRow.email}:`, error);
  }

  // 10. Update Google Sheet immediately
  const rowNumber = targetRowIndex + 1; // 1-based index in sheets
  const colLetter = getColumnLetter(sentIndex);
  const cellRange = `'${mainSheetName}'!${colLetter}${rowNumber}`;
  const sentValue = success ? ist.fullIST : `FAILED: ${messageIdOrError}`;

  console.log(`Updating "Sent" column for row ${rowNumber} with: ${sentValue}`);
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: cellRange,
    valueInputOption: 'USER_ENTERED',
    resource: {
      values: [[sentValue]]
    }
  });

  // 11. Log to "Send Log"
  console.log('Logging send attempt...');
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${logSheetName}'!A1`,
    valueInputOption: 'RAW',
    resource: {
      values: [[
        ist.fullIST,
        ist.dateString,
        targetRow.email,
        targetRow.subject,
        success ? 'success' : 'fail',
        messageIdOrError
      ]]
    }
  });

  return {
    status: success ? 'success' : 'failed',
    recipient: targetRow.email,
    subject: targetRow.subject,
    messageIdOrError,
    timestamp: ist.fullIST
  };
}

module.exports = {
  processCronJob,
  getISTTime
};
