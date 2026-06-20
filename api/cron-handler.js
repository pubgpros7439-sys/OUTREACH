const { processCronJob } = require('../lib/email-system');

module.exports = async (req, res) => {
  // Enforce method
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // Security Check (Vercel Cron auth header or manual CRON_SECRET token check)
  const authHeader = req.headers.authorization;
  if (process.env.NODE_ENV === 'production' && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Allow bypassing time check via query parameter for testing/manual runs
    const bypassTimeCheck = req.query.bypassTimeCheck === 'true';
    const result = await processCronJob(bypassTimeCheck);
    return res.status(200).json(result);
  } catch (error) {
    console.error('Error running cron job:', error);
    return res.status(500).json({ error: error.message });
  }
};
