let cachedCookie = '';
let cachedCrumb = '';
let lastFetchTime = 0;

async function getYahooAuth() {
  const now = Date.now();
  // Cache for 12 hours
  if (cachedCookie && cachedCrumb && (now - lastFetchTime < 12 * 60 * 60 * 1000)) {
    return { cookie: cachedCookie, crumb: cachedCrumb };
  }
  try {
    const res1 = await fetch('https://finance.yahoo.com', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    const setCookie = res1.headers.get('set-cookie');
    if (!setCookie) throw new Error('No cookie');
    cachedCookie = setCookie.split(';')[0];
    
    const res2 = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
      headers: { 'Cookie': cachedCookie, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    cachedCrumb = await res2.text();
    lastFetchTime = now;
    return { cookie: cachedCookie, crumb: cachedCrumb };
  } catch (err) {
    console.error('Yahoo Auth Error:', err.message);
    return { cookie: '', crumb: '' };
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  let targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).json({ error: 'Missing target url parameter' });

  try {
    const isYahoo = targetUrl.includes('finance.yahoo.com');
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*'
    };

    if (isYahoo) {
      const auth = await getYahooAuth();
      if (auth.crumb) {
        const sep = targetUrl.includes('?') ? '&' : '?';
        targetUrl = targetUrl + sep + 'crumb=' + auth.crumb;
        headers['Cookie'] = auth.cookie;
      }
    }

    const fetchResponse = await fetch(targetUrl, { method: req.method, headers });
    const isJson = (fetchResponse.headers.get('content-type') || '').includes('application/json');
    const data = isJson ? await fetchResponse.json() : await fetchResponse.text();

    if (!fetchResponse.ok) return res.status(fetchResponse.status).send(data);
    
    if (isJson) {
      res.status(200).json(data);
    } else {
      res.status(200).send(data);
    }
  } catch (error) {
    console.error('Vercel Proxy Error:', error);
    res.status(500).json({ error: 'Failed to fetch via Proxy.', details: error.message });
  }
}
