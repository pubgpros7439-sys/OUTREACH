const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Validate environment variables
const email = process.env.ZOHO_EMAIL;
const password = process.env.ZOHO_PASSWORD;
const host = process.env.ZOHO_HOST || 'smtp.zoho.com';
const port = parseInt(process.env.ZOHO_PORT || '465', 10);
const secure = process.env.ZOHO_SECURE !== 'false'; // true by default

if (!email || email.includes('your_email@zoho.com')) {
  console.error('Error: ZOHO_EMAIL is not configured in .env file.');
  process.exit(1);
}
if (!password || password.includes('your_app_password_here')) {
  console.error('Error: ZOHO_PASSWORD is not configured in .env file.');
  process.exit(1);
}

// Function to send email
async function sendMail(to, subject, text, html) {
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user: email,
      pass: password
    }
  });

  const mailOptions = {
    from: email,
    to,
    subject,
    text,
    html
  };

  console.log(`Attempting to send email to ${to}...`);
  const info = await transporter.sendMail(mailOptions);
  console.log('Email sent successfully!');
  console.log('Message ID:', info.messageId);
  return info;
}

// Main execution
async function main() {
  let to, subject, text, html;

  // 1. Try to read from command line arguments
  if (process.argv.length >= 5) {
    to = process.argv[2];
    subject = process.argv[3];
    text = process.argv[4];
    html = process.argv[5]; // Optional HTML body
  } else {
    // 2. Try to read from email_payload.json
    const payloadPath = path.join(__dirname, 'email_payload.json');
    if (fs.existsSync(payloadPath)) {
      try {
        const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
        to = payload.to;
        subject = payload.subject;
        text = payload.text;
        html = payload.html;
      } catch (err) {
        console.error('Error parsing email_payload.json:', err.message);
        process.exit(1);
      }
    }
  }

  if (!to || !subject || (!text && !html)) {
    console.error('Usage:');
    console.error('  node send_email.js <to> <subject> <body> [html_body]');
    console.error('Or create an email_payload.json file in this folder with:');
    console.error('  { "to": "...", "subject": "...", "text": "...", "html": "..." }');
    process.exit(1);
  }

  try {
    await sendMail(to, subject, text, html);
  } catch (error) {
    console.error('Failed to send email:', error);
    process.exit(1);
  }
}

main();
