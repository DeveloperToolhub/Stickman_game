const { get } = require('@vercel/blob');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const pathname = String(req.query?.pathname || '');
  if (!pathname.startsWith('chat-images/')) return res.status(400).json({ error: 'Invalid image path.' });
  try {
    const result = await get(pathname, { access: 'private', ifNoneMatch: req.headers['if-none-match'] });
    if (!result) return res.status(404).end();
    if (result.statusCode === 304) { res.statusCode = 304; res.setHeader('ETag', result.blob.etag); return res.end(); }
    res.setHeader('Content-Type', result.blob.contentType || 'application/octet-stream');
    res.setHeader('ETag', result.blob.etag);
    res.setHeader('Cache-Control', 'private, no-cache');
    result.stream.pipe(res);
  } catch (error) {
    console.error('[chat-image] delivery failed:', error);
    res.status(404).end();
  }
};
