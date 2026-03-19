export default async function handler(req, res) {
  // Setup CORS to allow any front-end to access this proxy
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const targetUrl = req.query.url;
  
  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing target url parameter' });
  }

  try {
    const fetchResponse = await fetch(targetUrl, {
      method: req.method,
      headers: {
        // Mock a browser user-agent to bypass Yahoo blocking
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*'
      }
    });

    const isJson = (fetchResponse.headers.get('content-type') || '').includes('application/json');
    const data = isJson ? await fetchResponse.json() : await fetchResponse.text();

    // Pass the response code back exactly as received
    if (!fetchResponse.ok) {
      return res.status(fetchResponse.status).send(data);
    }

    if (isJson) {
      res.status(200).json(data);
    } else {
      res.status(200).send(data);
    }
  } catch (error) {
    console.error('Vercel Proxy Error:', error);
    res.status(500).json({ error: 'Failed to fetch from Yahoo API via Vercel Proxy.', details: error.message });
  }
}
