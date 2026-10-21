module.exports = (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID || '' });
};
