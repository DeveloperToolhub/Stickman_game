const { put } = require('@vercel/blob');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const contentType = String(req.headers['content-type'] || '');
    if (!contentType.startsWith('multipart/form-data')) return res.status(400).json({ error: 'Use multipart form data.' });
    const chunks = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    if (body.length > 5 * 1024 * 1024) return res.status(413).json({ error: 'Images must be 5 MB or smaller.' });
    const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    if (!match) return res.status(400).json({ error: 'Missing upload boundary.' });
    const boundary = Buffer.from(`--${match[1] || match[2]}`);
    const start = body.indexOf(Buffer.from('\r\n\r\n'));
    const end = body.lastIndexOf(Buffer.concat([Buffer.from('\r\n'), boundary]));
    const header = start >= 0 ? body.subarray(0, start).toString() : '';
    const file = start >= 0 && end > start ? body.subarray(start + 4, end) : null;
    const type = header.match(/Content-Type:\s*([^\r\n]+)/i)?.[1]?.trim() || '';
    const filename = header.match(/filename="([^"]*)"/i)?.[1] || 'chat-image';
    if (!file || !type.startsWith('image/')) return res.status(400).json({ error: 'Choose a valid image.' });
    const blob = await put(`chat-images/${Date.now()}-${filename.replace(/[^a-z0-9._-]/gi, '_')}`, file, { access: 'private', contentType: type, addRandomSuffix: true });
    return res.json({ pathname: blob.pathname, contentType: type });
  } catch (error) {
    console.error('[chat-image] upload failed:', error);
    return res.status(500).json({ error: 'Image upload failed.' });
  }
};
