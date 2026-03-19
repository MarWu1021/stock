/**
 * 臺股 AI 分析 — script.js
 * Features: K-line chart, candlestick pattern recognition,
 *           RSI/MACD/MA/BB/Volume, auto .TW suffix, TW stock names
 */

// ===== BACKGROUND PARTICLES =====
(function createParticles() {
  const container = document.getElementById('bgParticles');
  const colors = ['#3b82f6', '#a855f7', '#06b6d4', '#22c55e'];
  for (let i = 0; i < 18; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    const size = 2 + Math.random() * 4;
    const dur = 4 + Math.random() * 8;
    p.style.cssText = `width:${size}px;height:${size}px;left:${Math.random()*100}%;top:${Math.random()*100}%;background:${colors[Math.floor(Math.random()*colors.length)]};--dur:${dur}s;animation-delay:${Math.random()*dur}s;`;
    container.appendChild(p);
  }
})();

// ===== CHART MODE STATE =====
let currentChartMode = 'candle';
let lastChartData = null;
let lastSentiment = 'neutral';
let currentRange = '3mo';
let currentInterval = '1d';
let watchlist = [];

// ===== DOM REFS =====
const stockInput    = document.getElementById('stockInput');
const analyzeBtn    = document.getElementById('analyzeBtn');
const loadingSection  = document.getElementById('loadingSection');
const loadingStatus   = document.getElementById('loadingStatus');
const errorBox      = document.getElementById('errorBox');
const errorMsg      = document.getElementById('errorMsg');
const resultsSection  = document.getElementById('resultsSection');
const starBtn       = document.getElementById('starBtn');
const exportBtn     = document.getElementById('exportBtn');
const watchlistSection = document.getElementById('watchlistSection');
const watchlistContent = document.getElementById('watchlistContent');

// ===== TAIWAN STOCK NAME MAP =====
const TW_NAMES = {
  '2330': '台積電 TSMC', '2317': '鴻海精密', '2454': '聯發科', '2303': '聯華電子',
  '2412': '中華電信', '2308': '台達電子', '2382': '廣達電腦', '2357': '華碩',
  '2881': '富邦金控', '2882': '國泰金控', '2886': '兆豐金控', '2891': '中信金控',
  '2884': '玉山金控', '2892': '第一金控', '5880': '合庫金控', '2880': '華南金控',
  '2002': '中國鋼鐵', '1303': '南亞塑膠', '1301': '台灣塑膠', '1326': '台化',
  '2207': '和泰車', '2395': '研華', '3711': '日月光投控', '2379': '瑞昱半導體',
  '2408': '南亞科技', '2344': '華邦電子', '2376': '技嘉科技', '2356': '英業達',
  '3045': '台灣大哥大', '4904': '遠傳電信', '2915': '潤泰全球',
  '0050': '元大台灣50', '0056': '元大高股息', '00878': '國泰永續高股息',
  '00881': '國泰台灣5G+', '006208': '富邦台50', '00919': '群益台灣精選高息',
  '00929': '復華台灣科技優息', '00940': '元大台灣價值高息', '00713': '元大台灣高息低波',
  '00733': '富邦台灣中小', '00692': '富邦公司治理', '0051': '元大中型100',
};

// ===== AUTO-DETECT & NORMALIZE TAIWAN STOCK CODE =====
function normalizeSymbol(input) {
  const s = input.trim().toUpperCase();
  // Already has .TW or .TWO suffix
  if (s.endsWith('.TW') || s.endsWith('.TWO')) return s;
  
  // Taiwan Stock/ETF pattern:
  // Starts with digits, followed by digits or letters, length 4-7
  // e.g., 2330, 0050, 00981A, 006208
  if (/^\d+[A-Z0-9]*$/.test(s) && s.length >= 4 && s.length <= 7) {
    return s + '.TW';
  }

  // Fallback: Pure number that is shorter than 4 (less common but possible)
  if (/^\d+$/.test(s)) return s + '.TW';
  
  return s;
}

// ===== QUICK PICKS =====
document.querySelectorAll('.qp-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    // Strip .TW from display for cleaner input experience
    const sym = btn.dataset.symbol.replace('.TW', '').replace('.TWO', '');
    stockInput.value = sym;
    runAnalysis();
  });
});

stockInput.addEventListener('keydown', e => { if (e.key === 'Enter') runAnalysis(); });
analyzeBtn.addEventListener('click', runAnalysis);

// Chart mode & timeframe toggle
document.addEventListener('click', e => {
  if (e.target.classList.contains('chart-tab')) {
    const isTimeframe = e.target.classList.contains('timeframe');
    
    // Deactivate others in the same group or all if not grouped (safety)
    const container = e.target.closest('.control-group') || document;
    container.querySelectorAll('.chart-tab').forEach(t => t.classList.remove('active'));
    e.target.classList.add('active');

    if (isTimeframe) {
      currentRange = e.target.dataset.range;
      currentInterval = e.target.dataset.interval;
      runAnalysis(); // Re-fetch for new timeframe
    } else {
      currentChartMode = e.target.dataset.mode;
      if (lastChartData) {
        const canvas = document.getElementById('priceChart');
        requestAnimationFrame(() => renderChart(canvas, lastChartData, lastSentiment, currentChartMode));
      }
    }
  }
});

// ===== WATCHLIST LOGIC =====
function loadWatchlist() {
  const stored = localStorage.getItem('tw_stock_watchlist');
  watchlist = stored ? JSON.parse(stored) : [];
  renderWatchlist();
}

function saveWatchlist() {
  localStorage.setItem('tw_stock_watchlist', JSON.stringify(watchlist));
  renderWatchlist();
}

function toggleWatchlist(symbol, name) {
  const idx = watchlist.findIndex(item => item.symbol === symbol);
  if (idx > -1) {
    watchlist.splice(idx, 1);
  } else {
    watchlist.push({ symbol, name });
  }
  saveWatchlist();
  updateStarBtn(symbol);
}

function renderWatchlist() {
  if (watchlist.length === 0) {
    watchlistSection.classList.add('hidden');
    return;
  }
  watchlistSection.classList.remove('hidden');
  watchlistContent.innerHTML = '';
  watchlist.forEach(item => {
    const btn = document.createElement('button');
    btn.className = 'qp-btn';
    btn.textContent = item.name.split(' ')[0]; // Just use first part of name
    btn.title = `${item.name} (${item.symbol})`;
    btn.addEventListener('click', () => {
      stockInput.value = item.symbol.replace('.TW', '').replace('.TWO', '');
      runAnalysis();
    });
    watchlistContent.appendChild(btn);
  });
}

function updateStarBtn(symbol) {
  const isWatched = watchlist.some(item => item.symbol === symbol);
  if (isWatched) {
    starBtn.classList.add('active');
    starBtn.textContent = '★';
  } else {
    starBtn.classList.remove('active');
    starBtn.textContent = '☆';
  }
}

starBtn.addEventListener('click', () => {
  if (lastChartData) {
    toggleWatchlist(lastChartData.symbol, lastChartData.name);
  }
});

// Initialize watchlist
loadWatchlist();

// ===== EXPORT LOGIC =====
exportBtn.addEventListener('click', async () => {
  if (!lastChartData) return;
  
  exportBtn.disabled = true;
  exportBtn.textContent = '⌛ 處理中...';
  
  try {
    const canvas = await html2canvas(resultsSection, {
      backgroundColor: '#050d1a',
      scale: 2, // Higher quality
      useCORS: true,
      logging: false
    });
    
    const link = document.createElement('a');
    link.download = `AI分析報告_${lastChartData.bareCode}_${new Date().toISOString().slice(0,10)}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  } catch (err) {
    console.error('Export failed:', err);
    alert('匯出失敗，請稍後再試。');
  } finally {
    exportBtn.disabled = false;
    exportBtn.textContent = '📸 匯出';
  }
});

// ===== PROXY FETCH UTILITY (Multi-proxy fallback) =====
async function fetchWithProxy(targetUrl) {
  const proxies = [
    url => `/api/proxy?url=${encodeURIComponent(url)}`, // [Vercel] 專屬後台代理伺服器 (若部署在 Vercel 則會自動生效)
    url => url, // 嘗試直接連線 (若使用者有安裝 Allow CORS 外掛，這行就會直接成功，不被 Yahoo 代理黑名單阻擋)
    url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    url => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
    url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
    url => `https://thingproxy.freeboard.io/fetch/${url}`,
  ];

  let lastError;
  for (const proxyGen of proxies) {
    try {
      const finalUrl = proxyGen(targetUrl);
      const res = await fetch(finalUrl);
      if (res.ok) {
        // Validation: Some proxies return 200 OK but with an HTML/Text error message (e.g., "Edge: Too Many Requests")
        const clone = res.clone();
        await clone.json(); // Throws if not valid JSON
        return res;
      }
      if (res.status === 403) console.warn(`Proxy 403: ${finalUrl}`);
    } catch (e) {
      lastError = e;
      console.warn(`Proxy failed: ${proxyGen(targetUrl)} - ${e.message}`);
    }
  }
  throw lastError || new Error('所有代理伺服器均無法連線，請檢查網路或稍後再試。');
}

// ===== FETCH YAHOO FINANCE =====
async function fetchStockData(symbol) {
  const range = currentRange;
  const interval = currentInterval;
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includeAdjustedClose=true`;

  updateLoadingStatus('連線至數據中心...');
  const res = await fetchWithProxy(url);

  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) {
    const errMsg = json?.chart?.error?.description || '找不到股票代碼，請確認後重試。';
    throw new Error(errMsg);
  }

  const timestamps = result.timestamp;
  const q = result.indicators.quote[0];
  const adjClose = result.indicators.adjclose?.[0]?.adjclose || q.close;
  const meta = result.meta;

  const opens = [], closes = [], highs = [], lows = [], volumes = [], dates = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (q.open[i] != null && q.close[i] != null) {
      opens.push(q.open[i]);
      closes.push(adjClose[i] ?? q.close[i]);
      highs.push(q.high[i]);
      lows.push(q.low[i]);
      volumes.push(q.volume[i] ?? 0);
      dates.push(new Date(timestamps[i] * 1000));
    }
  }

  if (closes.length < 20) throw new Error('歷史資料不足（需至少20個交易日），請嘗試其他代碼。');

  // Extract bare code (e.g. "2330" from "2330.TW")
  const bareCode = symbol.replace(/\.(TW|TWO)$/i, '');
  const knownName = TW_NAMES[bareCode];
  const displayName = knownName || meta.longName || meta.shortName || symbol;

  return {
    symbol: meta.symbol || symbol,
    bareCode,
    name: displayName,
    currency: meta.currency || 'TWD',
    currentPrice: meta.regularMarketPrice || closes[closes.length - 1],
    previousClose: meta.chartPreviousClose || meta.previousClose || closes[closes.length - 2],
    opens, closes, highs, lows, volumes, dates,
  };
}

// ===== TECHNICAL INDICATORS =====

function sma(arr, period) {
  const result = [];
  for (let i = 0; i < arr.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    result.push(arr.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period);
  }
  return result;
}

function ema(arr, period) {
  const k = 2 / (period + 1);
  const result = [arr[0]];
  for (let i = 1; i < arr.length; i++) {
    result.push(arr[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

function calcRSI(closes, period = 14) {
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  let avgG = gains / period, avgL = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgG = (avgG * (period - 1) + Math.max(d, 0)) / period;
    avgL = (avgL * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (avgL === 0) return 100;
  return 100 - 100 / (1 + avgG / avgL);
}

function calcMACD(closes, fast = 12, slow = 26, signal = 9) {
  const ef = ema(closes, fast);
  const es = ema(closes, slow);
  const line = ef.map((v, i) => v - es[i]);
  const sig = ema(line.slice(slow - 1), signal);
  const hist = sig.map((s, i) => line[slow - 1 + i] - s);
  return {
    line, signal: sig, histogram: hist,
    current: line[line.length - 1],
    currentSignal: sig[sig.length - 1],
    currentHistogram: hist[hist.length - 1],
    prevHistogram: hist[hist.length - 2] || 0,
  };
}

function calcBB(closes, period = 20, mult = 2) {
  const ma = sma(closes, period);
  const last = ma[ma.length - 1];
  const slice = closes.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const std = Math.sqrt(slice.reduce((acc, v) => acc + (v - mean) ** 2, 0) / period);
  return { upper: last + mult * std, middle: last, lower: last - mult * std, std };
}

function calcStoch(closes, highs, lows, k = 14) {
  const rc = closes.slice(-k), rh = highs.slice(-k), rl = lows.slice(-k);
  const hh = Math.max(...rh), ll = Math.min(...rl);
  if (hh === ll) return 50;
  return ((rc[rc.length - 1] - ll) / (hh - ll)) * 100;
}

function calcATR(highs, lows, closes, period = 14) {
  const tr = [highs[0] - lows[0]];
  for (let i = 1; i < closes.length; i++) {
    const hl = highs[i] - lows[i];
    const hpc = Math.abs(highs[i] - closes[i - 1]);
    const lpc = Math.abs(lows[i] - closes[i - 1]);
    tr.push(Math.max(hl, hpc, lpc));
  }
  let atr = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < tr.length; i++) {
    atr = (atr * (period - 1) + tr[i]) / period;
  }
  return atr;
}

function calcFibLevels(high, low) {
  const diff = high - low;
  return {
    h: high,
    l: low,
    '0.236': high - diff * 0.236,
    '0.382': high - diff * 0.382,
    '0.5': high - diff * 0.5,
    '0.618': high - diff * 0.618,
    '0.786': high - diff * 0.786,
    '1.272': high + diff * 0.272,
    '1.618': high + diff * 0.618,
  };
}

// ===== FUNDAMENTAL DATA ENGINE =====
async function fetchFundamentalData(symbol) {
  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=financialData,defaultKeyStatistics,summaryDetail`;
  try {
    const res = await fetchWithProxy(url);
    const json = await res.json();
    const result = json?.quoteSummary?.result?.[0];
    if (!result) return null;
    return {
      financialData: result.financialData || {},
      defaultKeyStatistics: result.defaultKeyStatistics || {},
      summaryDetail: result.summaryDetail || {}
    };
  } catch(e) {
    console.warn("Fundamental fetch error:", e);
    return null;
  }
}

// ===== NEWS & SENTIMENT ENGINE =====

async function fetchNews(symbol) {
  // Use query2 for news search as well
  const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&newsCount=5`;
  
  try {
    const res = await fetchWithProxy(url);
    const json = await res.json();
    return json.news || [];
  } catch (e) {
    console.error('News fetch error:', e);
    return [];
  }
}

function analyzeSentiment(news) {
  const bullishWords = ['營收', '新高', '成長', '突破', '利多', '優於預期', '上調', '合作', '擴建', '進步', '強勁', '買進', '漲', '獲利'];
  const bearishWords = ['下滑', '利空', '衰退', '跌', '低於預期', '下調', '裁員', '虧損', '壓力', '警訊', '賣出', '縮減', '延期', '風險'];
  
  let score = 0;
  const analyzedNews = news.map(item => {
    let itemScore = 0;
    const title = item.title || '';
    bullishWords.forEach(w => { if (title.includes(w)) itemScore += 1; });
    bearishWords.forEach(w => { if (title.includes(w)) itemScore -= 1; });
    
    score += itemScore;
    return {
      title,
      link: item.link,
      publisher: item.publisher,
      sentiment: itemScore > 0 ? 'bull' : itemScore < 0 ? 'bear' : 'neut'
    };
  });
  
  return {
    score: Math.max(-10, Math.min(10, score * 2)), // Scale to -10 ~ 10
    news: analyzedNews.slice(0, 5)
  };
}

// ===== K-LINE (CANDLESTICK) PATTERN RECOGNITION =====
function detectCandlePatterns(opens, closes, highs, lows) {
  const n = opens.length;
  const patterns = [];

  // Helper: body size, upper/lower shadow
  const body  = i => Math.abs(closes[i] - opens[i]);
  const range = i => highs[i] - lows[i];
  const upper = i => highs[i] - Math.max(opens[i], closes[i]);
  const lower = i => Math.min(opens[i], closes[i]) - lows[i];
  const isGreen = i => closes[i] >= opens[i];

  // Use last 5 candles for pattern detection
  const L = n - 1; // last index

  // 1. 十字星 Doji (body < 15% of range, has shadows)
  if (body(L) < range(L) * 0.15 && range(L) > 0) {
    patterns.push({ name: '十字星', icon: '✚', signal: 'neut',
      desc: '開收盤價幾乎相同，多空力道均衡，趨勢反轉前兆，需觀察確認。' });
  }

  // 2. 鎚子線 Hammer (bullish reversal: long lower shadow, small body at top, downtrend)
  if (lower(L) >= body(L) * 2 && upper(L) <= body(L) * 0.5 && range(L) > 0 &&
      closes[L - 1] < closes[L - 3]) { // in downtrend
    patterns.push({ name: '鎚子線', icon: '🔨', signal: 'bull',
      desc: '下影線長，實體小且位於上方，出現在下跌後暗示底部反彈。' });
  }

  // 3. 倒鎚子 Inverted Hammer
  if (upper(L) >= body(L) * 2 && lower(L) <= body(L) * 0.5 && range(L) > 0 &&
      closes[L - 1] < closes[L - 3] && isGreen(L)) {
    patterns.push({ name: '倒鎚子', icon: '🔼', signal: 'bull',
      desc: '上影線長，實體在下，出現後隔日需確認是否放量上漲。' });
  }

  // 4. 流星線 Shooting Star (bearish: long upper shadow, small body, uptrend)
  if (upper(L) >= body(L) * 2 && lower(L) <= body(L) * 0.5 && range(L) > 0 &&
      closes[L - 1] > closes[L - 3]) { // in uptrend
    patterns.push({ name: '流星線', icon: '🌠', signal: 'bear',
      desc: '上影線長，出現在上漲後，表示盤中拉高遭賣壓壓回，轉弱訊號。' });
  }

  // 5. 多頭吞噬 Bullish Engulfing
  if (n >= 2 && !isGreen(L - 1) && isGreen(L) &&
      opens[L] <= closes[L - 1] && closes[L] >= opens[L - 1] &&
      body(L) > body(L - 1)) {
    patterns.push({ name: '多頭吞噬', icon: '📈', signal: 'bull',
      desc: '今日陽線完全吞噬昨日陰線，強烈看漲反轉訊號，適合觀察是否放量。' });
  }

  // 6. 空頭吞噬 Bearish Engulfing
  if (n >= 2 && isGreen(L - 1) && !isGreen(L) &&
      opens[L] >= closes[L - 1] && closes[L] <= opens[L - 1] &&
      body(L) > body(L - 1)) {
    patterns.push({ name: '空頭吞噬', icon: '📉', signal: 'bear',
      desc: '今日陰線完全吞噬昨日陽線，強烈看跌反轉訊號，注意止損位置。' });
  }

  // 7. 晨星 Morning Star (3-candle bullish reversal)
  if (n >= 3 && !isGreen(L - 2) && body(L - 1) < body(L - 2) * 0.5 &&
      isGreen(L) && closes[L] > (opens[L - 2] + closes[L - 2]) / 2) {
    patterns.push({ name: '晨星', icon: '🌅', signal: 'bull',
      desc: '三根K線組合：大陰線→小實體→大陽線，底部反轉力道強，多方訊號。' });
  }

  // 8. 夕星 Evening Star (3-candle bearish reversal)
  if (n >= 3 && isGreen(L - 2) && body(L - 1) < body(L - 2) * 0.5 &&
      !isGreen(L) && closes[L] < (opens[L - 2] + closes[L - 2]) / 2) {
    patterns.push({ name: '夕星', icon: '🌆', signal: 'bear',
      desc: '三根K線組合：大陽線→小實體→大陰線，頂部反轉訊號，警惕回調。' });
  }

  // 9. 三白兵 Three White Soldiers
  if (n >= 3 && isGreen(L) && isGreen(L - 1) && isGreen(L - 2) &&
      closes[L] > closes[L - 1] && closes[L - 1] > closes[L - 2] &&
      body(L) > range(L) * 0.5 && body(L - 1) > range(L - 1) * 0.5) {
    patterns.push({ name: '三白兵', icon: '⬆️', signal: 'bull',
      desc: '連續三根強勢陽線，每日收盤創新高，多方強力佔優，突破訊號確立。' });
  }

  // 10. 三烏鴉 Three Black Crows
  if (n >= 3 && !isGreen(L) && !isGreen(L - 1) && !isGreen(L - 2) &&
      closes[L] < closes[L - 1] && closes[L - 1] < closes[L - 2] &&
      body(L) > range(L) * 0.5 && body(L - 1) > range(L - 1) * 0.5) {
    patterns.push({ name: '三烏鴉', icon: '⬇️', signal: 'bear',
      desc: '連續三根強勢陰線，空方持續換手，賣壓沉重，謹慎持有多單。' });
  }

  // 11. 紡錘線 Spinning Top (small body, both shadows)
  if (body(L) < range(L) * 0.2 && upper(L) > range(L) * 0.2 &&
      lower(L) > range(L) * 0.2 && range(L) > 0 && patterns.length === 0) {
    patterns.push({ name: '紡錘線', icon: '🌀', signal: 'neut',
      desc: '上下影線相當，實體小，多空猶豫不決，通常為整理型態。' });
  }

  // 12. 長紅線 / 長黑線
  if (patterns.length === 0) {
    if (isGreen(L) && body(L) > range(L) * 0.7) {
      patterns.push({ name: '長紅線', icon: '🕯️', signal: 'bull',
        desc: '強勢大陽線，幾乎無上下影線，多方完全掌控，短線動能強。' });
    } else if (!isGreen(L) && body(L) > range(L) * 0.7) {
      patterns.push({ name: '長黑線', icon: '🕯️', signal: 'bear',
        desc: '強勢大陰線，幾乎無上下影線，空方完全掌控，短線下壓動能強。' });
    }
  }

  if (patterns.length === 0) {
    patterns.push({ name: '普通K線', icon: '📊', signal: 'neut',
      desc: '最近K線無明顯型態訊號，需搭配其他指標研判方向。' });
  }

  return patterns;
}

// ===== PREDICTION ENGINE =====
function predict(data) {
  const { closes, highs, lows, opens, volumes, currentPrice } = data;
  const n = closes.length;

  updateLoadingStatus('計算技術指標中...');

  const rsiVal = calcRSI(closes);
  let rsiScore = rsiVal < 30 ? 2 : rsiVal < 40 ? 1 : rsiVal > 70 ? -2 : rsiVal > 60 ? -1 : 0;

  const macdData = calcMACD(closes);
  let macdScore = 0;
  if (macdData.current > macdData.currentSignal) macdScore += 1;
  if (macdData.currentHistogram > 0 && macdData.currentHistogram > macdData.prevHistogram) macdScore += 1;
  if (macdData.current < macdData.currentSignal) macdScore -= 1;
  if (macdData.currentHistogram < 0 && macdData.currentHistogram < macdData.prevHistogram) macdScore -= 1;

  const ma5arr  = sma(closes, 5);
  const ma20arr = sma(closes, 20);
  const ma60arr = sma(closes, Math.min(60, n));
  const curMa5  = ma5arr[n - 1];
  const curMa20 = ma20arr[n - 1];
  const curMa60 = ma60arr[n - 1];
  let maScore = 0;
  if (currentPrice > curMa5)  maScore += 0.5; else maScore -= 0.5;
  if (currentPrice > curMa20) maScore += 1;   else maScore -= 1;
  if (curMa60 && currentPrice > curMa60) maScore += 1; else maScore -= 1;
  if (curMa5 > curMa20) maScore += 0.5;

  const bb = calcBB(closes);
  const bbPos = (currentPrice - bb.lower) / (bb.upper - bb.lower);
  let bbScore = currentPrice < bb.lower ? 2 : bbPos < 0.25 ? 1 : currentPrice > bb.upper ? -2 : bbPos > 0.75 ? -1 : 0;

  const recentVol = volumes.slice(-5);
  const prevVol   = volumes.slice(-10, -5);
  const avgRV = recentVol.reduce((a, b) => a + b, 0) / recentVol.length;
  const avgPV = prevVol.reduce((a, b) => a + b, 0) / prevVol.length;
  const priceUp3 = closes[n - 1] > closes[n - 4];
  let volScore = avgRV > avgPV * 1.2 && priceUp3 ? 1 : avgRV > avgPV * 1.2 && !priceUp3 ? -1 : 0;

  const stochVal = calcStoch(closes, highs, lows);
  let stochScore = stochVal < 20 ? 1 : stochVal > 80 ? -1 : 0;

  const mom3  = (closes[n - 1] / closes[n - 4]  - 1) * 100;
  const mom10 = (closes[n - 1] / closes[n - 11] - 1) * 100;
  let momScore = 0;
  if (mom3 > 2) momScore += 1; else if (mom3 < -2) momScore -= 1;
  if (mom10 > 5) momScore += 1; else if (mom10 < -5) momScore -= 1;

  // K-line patterns score
  const patterns = detectCandlePatterns(opens, closes, highs, lows);
  let klineScore = 0;
  patterns.forEach(p => {
    if (p.signal === 'bull') klineScore += 1.5;
    else if (p.signal === 'bear') klineScore -= 1.5;
  });
  klineScore = Math.max(-3, Math.min(3, klineScore));

  // Create 7-Factor Model (VC Weights)
  const fund = data.fundamentals || {};
  const fd = fund.financialData || {};
  const ks = fund.defaultKeyStatistics || {};
  const sd = fund.summaryDetail || {};

  const safeVal = (obj, key) => obj && obj[key] !== undefined && obj[key] !== null ? (obj[key].raw ?? obj[key]) : null;

  // 1. Momentum (動量) 15%
  let scoreMom = 50;
  if (mom3 > 2) scoreMom += 10; else if (mom3 < -2) scoreMom -= 10;
  if (mom10 > 5) scoreMom += 15; else if (mom10 < -5) scoreMom -= 15;
  if (rsiVal > 40 && rsiVal < 70) scoreMom += 10;
  if (macdScore > 0) scoreMom += 15;
  scoreMom = Math.max(0, Math.min(100, scoreMom));

  // 2. Valuation (估值) 15%
  let scoreVal = 50;
  const pe = safeVal(sd, 'trailingPE') || safeVal(sd, 'forwardPE');
  const pb = safeVal(ks, 'priceToBook');
  const ps = safeVal(sd, 'priceToSalesTrailing12Months');
  const divY = safeVal(sd, 'dividendYield');
  if (pe) { if (pe < 15) scoreVal += 15; else if (pe > 30) scoreVal -= 15; }
  if (pb) { if (pb < 1.5) scoreVal += 15; else if (pb > 3) scoreVal -= 15; }
  if (divY) { if (divY > 0.04) scoreVal += 10; else if (divY < 0.01) scoreVal -= 5; }
  scoreVal = Math.max(0, Math.min(100, scoreVal));

  // 3. Quality (質量) 20%
  let scoreQual = 50;
  const roe = safeVal(fd, 'returnOnEquity');
  const roa = safeVal(fd, 'returnOnAssets');
  const opMargin = safeVal(fd, 'operatingMargins');
  const de = safeVal(fd, 'debtToEquity');
  if (roe) { if (roe > 0.15) scoreQual += 20; else if (roe < 0.05) scoreQual -= 20; }
  if (roa) { if (roa > 0.05) scoreQual += 10; else if (roa < 0) scoreQual -= 10; }
  if (opMargin) { if (opMargin > 0.1) scoreQual += 10; else if (opMargin < 0) scoreQual -= 10; }
  if (de) { if (de < 50) scoreQual += 10; else if (de > 150) scoreQual -= 10; }
  scoreQual = Math.max(0, Math.min(100, scoreQual));

  // 4. Growth (成長) 20%
  let scoreGro = 50;
  const revGrowth = safeVal(fd, 'revenueGrowth');
  const epsGrowth = safeVal(ks, 'earningsQuarterlyGrowth');
  if (revGrowth) { if (revGrowth > 0.1) scoreGro += 20; else if (revGrowth < 0) scoreGro -= 20; }
  if (epsGrowth) { if (epsGrowth > 0.1) scoreGro += 20; else if (epsGrowth < 0) scoreGro -= 20; }
  scoreGro = Math.max(0, Math.min(100, scoreGro));

  const atr = calcATR(highs, lows, closes);
  // 5. Volatility (波動性) 10%
  let scoreVol = 50;
  const beta = safeVal(ks, 'beta');
  const atrRatio = atr / currentPrice;
  if (beta) { if (beta < 1) scoreVol += 15; else if (beta > 1.5) scoreVol -= 15; }
  if (atrRatio) { if (atrRatio < 0.02) scoreVol += 15; else if (atrRatio > 0.04) scoreVol -= 15; }
  scoreVol = Math.max(0, Math.min(100, scoreVol));

  const newsSentiment = data.newsSentiment || { score: 0, news: [] };
  // 6. Sentiment (情緒) 10%
  let scoreSent = 50;
  const targetMean = safeVal(fd, 'targetMeanPrice');
  const recMean = safeVal(fd, 'recommendationMean');
  if (targetMean) { if (targetMean > currentPrice * 1.1) scoreSent += 15; else if (targetMean < currentPrice) scoreSent -= 15; }
  if (recMean) { if (recMean < 2) scoreSent += 15; else if (recMean > 3) scoreSent -= 15; }
  if (newsSentiment.score > 2) scoreSent += 10; else if (newsSentiment.score < -2) scoreSent -= 10;
  scoreSent = Math.max(0, Math.min(100, scoreSent));

  // 7. Macro (宏觀) 10%
  let scoreMac = 50;
  const high52 = safeVal(sd, 'fiftyTwoWeekHigh');
  if (high52) {
    const fromHigh = currentPrice / high52;
    if (fromHigh > 0.9) scoreMac += 15; else if (fromHigh < 0.7) scoreMac -= 15;
  }
  scoreMac = Math.max(0, Math.min(100, scoreMac));

  // Combined VC Setup
  const finalScore = (
    scoreMom * 0.15 +
    scoreVal * 0.15 +
    scoreQual * 0.20 +
    scoreGro * 0.20 +
    scoreVol * 0.10 +
    scoreSent * 0.10 +
    scoreMac * 0.10
  );
  
  const confidence = Math.min(99, 40 + Math.abs(finalScore - 50));

  let verdict, desc, icon, sentiment;
  let tp1, tp2, sl;
  
  const lookback = Math.min(60, n);
  const recentHigh = Math.max(...highs.slice(-lookback));
  const recentLow = Math.min(...lows.slice(-lookback));
  const fib = calcFibLevels(recentHigh, recentLow);

  if (finalScore >= 80) {
    sentiment = 'bullish'; icon = '🔥'; verdict = 'STRONG BUY (強烈買進)';
    desc = '7大因子綜合表現極佳，成長與質量亮眼，強烈建議布局。';
    tp1 = currentPrice + atr * 3; tp2 = currentPrice + atr * 5; sl = currentPrice - atr * 1.5;
  } else if (finalScore >= 60) {
    sentiment = 'bullish'; icon = '🚀'; verdict = 'BUY (買進)';
    desc = '整體基本面與技術面偏多，具備投資價值。';
    tp1 = currentPrice + atr * 2; tp2 = currentPrice + atr * 4; sl = currentPrice - atr * 1.5;
  } else if (finalScore >= 40) {
    sentiment = 'neutral'; icon = '⚖️'; verdict = 'HOLD (持有 / 中立)';
    desc = '多空因子抵銷，建議維持現有部位或等待進一步訊號。';
    tp1 = currentPrice + atr * 2; tp2 = currentPrice - atr * 2; sl = currentPrice - atr * 3;
  } else if (finalScore >= 20) {
    sentiment = 'bearish'; icon = '⚠️'; verdict = 'SELL (賣出)';
    desc = '各項指標轉弱，建議降低持股比例，注意風險。';
    tp1 = currentPrice - atr * 2; tp2 = currentPrice - atr * 4; sl = currentPrice + atr * 1.5;
  } else {
    sentiment = 'bearish'; icon = '💀'; verdict = 'STRONG SELL (強烈賣出)';
    desc = '基本面與技術面全面惡化，強烈建議避開。';
    tp1 = currentPrice - atr * 3; tp2 = currentPrice - atr * 5; sl = currentPrice + atr * 2;
  }

  // Time projections based on ATR and log volatility
  const dailyVol = atr / currentPrice;
  const projectRange = (days) => {
    const std = dailyVol * Math.sqrt(days);
    return {
      low: currentPrice * (1 - std * 1.5),
      high: currentPrice * (1 + std * 1.5)
    };
  };

  return {
    sentiment, verdict, desc, icon, confidence,
    score: finalScore,
    technicalScore: 0, /* unused now */
    newsSentiment,
    patterns,
    targets: { tp1, tp2, sl, fib },
    projections: {
      '1m': projectRange(20),
      '6m': projectRange(120),
      '1y': projectRange(240)
    },
    factorScores: { mom: scoreMom, val: scoreVal, qual: scoreQual, gro: scoreGro, vol: scoreVol, sent: scoreSent, mac: scoreMac },
    indicators: {
      rsi: rsiVal, rsiScore,
      macd: macdData, macdScore,
      ma5: curMa5, ma20: curMa20, ma60: curMa60, maScore,
      bb, bbScore, bbPosition: bbPos,
      volRatio: avgRV / (avgPV || 1), volScore,
      stoch: stochVal, stochScore,
      mom3, mom10, momScore,
      klineScore,
      atr
    },
  };
}

// ===== RENDER CANDLESTICK CHART =====
function renderChart(canvas, data, sentiment, mode = 'candle') {
  const { closes, opens, highs, lows, dates } = data;
  const count = Math.min(60, closes.length);
  const rc = closes.slice(-count), ro = opens.slice(-count);
  const rh = highs.slice(-count),  rl = lows.slice(-count);
  const rd = dates.slice(-count);

  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width  = rect.width  * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  const W = rect.width, H = rect.height;

  const minV = Math.min(...rl) * 0.997;
  const maxV = Math.max(...rh) * 1.003;
  const padL = 60, padR = 14, padT = 14, padB = 32;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const xOf = i => padL + (i + 0.5) / count * plotW;
  const yOf = v => padT + (1 - (v - minV) / (maxV - minV)) * plotH;

  ctx.clearRect(0, 0, W, H);

  // Grid
  for (let g = 0; g <= 4; g++) {
    const y = padT + (g / 4) * plotH;
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
    const val = maxV - (g / 4) * (maxV - minV);
    ctx.fillStyle = '#475569';
    ctx.font = '10px JetBrains Mono, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(val.toFixed(1), padL - 4, y + 4);
  }

  // MA lines on chart
  const ma5arr  = sma(rc, 5);
  const ma20arr = sma(rc, 20);
  const drawMALine = (maArr, color) => {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    let started = false;
    maArr.forEach((v, i) => {
      if (v == null) return;
      const x = xOf(i), y = yOf(v);
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  };
  drawMALine(ma5arr, 'rgba(251,191,36,0.7)');   // MA5 yellow
  drawMALine(ma20arr, 'rgba(99,179,237,0.7)');  // MA20 blue

  // Legend
  ctx.font = '10px Inter, sans-serif';
  ctx.fillStyle = 'rgba(251,191,36,0.9)';
  ctx.fillText('MA5', padL + 4, padT + 14);
  ctx.fillStyle = 'rgba(99,179,237,0.9)';
  ctx.fillText('MA20', padL + 32, padT + 14);

  const accentColor = sentiment === 'bullish' ? '#22c55e' : sentiment === 'bearish' ? '#ef4444' : '#f59e0b';

  if (mode === 'candle') {
    // ---- Candlestick chart ----
    const candleW = Math.max(2, plotW / count * 0.7);
    for (let i = 0; i < count; i++) {
      const x  = xOf(i);
      const isGreen = rc[i] >= ro[i];
      const color = isGreen ? '#22c55e' : '#ef4444';
      const oY = yOf(ro[i]), cY = yOf(rc[i]);
      const hY = yOf(rh[i]), lY = yOf(rl[i]);
      const bodyTop = Math.min(oY, cY), bodyH = Math.max(1, Math.abs(cY - oY));

      // Wick
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, hY); ctx.lineTo(x, lY); ctx.stroke();

      // Body
      ctx.fillStyle = isGreen ? 'rgba(34,197,94,0.85)' : 'rgba(239,68,68,0.85)';
      ctx.fillRect(x - candleW / 2, bodyTop, candleW, bodyH);
      ctx.strokeStyle = color;
      ctx.lineWidth = 0.5;
      ctx.strokeRect(x - candleW / 2, bodyTop, candleW, bodyH);
    }
  } else {
    // ---- Line chart ----
    const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
    grad.addColorStop(0, accentColor + '44');
    grad.addColorStop(1, accentColor + '00');

    ctx.beginPath();
    rc.forEach((v, i) => {
      const x = xOf(i), y = yOf(v);
      if (i === 0) ctx.moveTo(x, y);
      else {
        const px = xOf(i - 1), py = yOf(rc[i - 1]);
        ctx.bezierCurveTo((px + x) / 2, py, (px + x) / 2, y, x, y);
      }
    });
    ctx.lineTo(xOf(count - 1), padT + plotH);
    ctx.lineTo(xOf(0), padT + plotH);
    ctx.fillStyle = grad; ctx.fill();

    ctx.beginPath();
    rc.forEach((v, i) => {
      const x = xOf(i), y = yOf(v);
      if (i === 0) ctx.moveTo(x, y);
      else {
        const px = xOf(i - 1), py = yOf(rc[i - 1]);
        ctx.bezierCurveTo((px + x) / 2, py, (px + x) / 2, y, x, y);
      }
    });
    ctx.strokeStyle = accentColor; ctx.lineWidth = 2; ctx.stroke();
  }

  // Date labels
  ctx.font = '9px Inter, sans-serif';
  ctx.textAlign = 'center';
  const step = Math.ceil(count / 6);
  for (let i = 0; i < rd.length; i += step) {
    const d = rd[i];
    ctx.fillStyle = '#475569';
    ctx.fillText(`${d.getMonth() + 1}/${d.getDate()}`, xOf(i), H - 10);
  }
  const lastD = rd[rd.length - 1];
  ctx.fillStyle = accentColor;
  ctx.fillText(`${lastD.getMonth() + 1}/${lastD.getDate()}`, xOf(count - 1), H - 10);
}

// ===== RENDER HELPERS =====
function renderMacdBars(container, histogram) {
  container.innerHTML = '';
  const recent = histogram.slice(-20);
  const maxAbs = Math.max(...recent.map(Math.abs), 0.001);
  recent.forEach(v => {
    const bar = document.createElement('div');
    bar.className = 'macd-bar ' + (v >= 0 ? 'pos' : 'neg');
    bar.style.cssText = `height:${(Math.abs(v)/maxAbs*100)}%;${v >= 0 ? 'align-self:flex-end' : 'align-self:flex-start;border-radius:0 0 2px 2px;margin-top:auto;'}`;
    container.appendChild(bar);
  });
}

function renderVolBars(container, volumes, closes) {
  container.innerHTML = '';
  const recent = volumes.slice(-20), rc = closes.slice(-20);
  const maxVol = Math.max(...recent);
  recent.forEach((v, i) => {
    const bar = document.createElement('div');
    bar.className = 'vol-bar';
    const isUp = i === 0 || rc[i] >= rc[i - 1];
    bar.style.cssText = `height:${(v/maxVol*100)}%;background:${isUp ? 'rgba(34,197,94,0.5)' : 'rgba(239,68,68,0.5)'};border-radius:2px 2px 0 0;`;
    container.appendChild(bar);
  });
}

function renderKlinePatterns(container, patterns, badgeEl, descEl) {
  container.innerHTML = '';
  patterns.forEach(p => {
    const el = document.createElement('div');
    el.className = 'pattern-item';
    const badgeCls = p.signal === 'bull' ? 'bull' : p.signal === 'bear' ? 'bear' : 'neut';
    el.innerHTML = `
      <div class="pattern-header">
        <span class="pattern-icon">${p.icon}</span>
        <span class="pattern-name">${p.name}</span>
        <span class="ind-badge ${badgeCls}">${p.signal === 'bull' ? '看漲' : p.signal === 'bear' ? '看跌' : '中性'}</span>
      </div>
      <p class="pattern-desc">${p.desc}</p>
    `;
    container.appendChild(el);
  });

  const dominant = patterns[0];
  badgeEl.className = 'ind-badge ' + (dominant.signal === 'bull' ? 'bull' : dominant.signal === 'bear' ? 'bear' : 'neut');
  badgeEl.textContent = patterns.length > 1 ? `${patterns.length} 個型態` : dominant.name;
  descEl.textContent = '';
}

function renderScoreDial(score) {
  const pct = score / 100;
  const angle = -Math.PI + pct * Math.PI;
  const cx = 60, cy = 60, r = 50;
  const nx = cx + r * Math.cos(angle), ny = cy + r * Math.sin(angle);
  const endX = cx + r * Math.cos(-Math.PI + pct * Math.PI);
  const endY = cy + r * Math.sin(-Math.PI + pct * Math.PI);
  const largeArc = pct * Math.PI > Math.PI ? 1 : 0;

  document.getElementById('dialArc').setAttribute('d', `M 10 60 A 50 50 0 ${largeArc} 1 ${endX.toFixed(2)} ${endY.toFixed(2)}`);
  document.getElementById('dialNeedle').setAttribute('x2', nx.toFixed(2));
  document.getElementById('dialNeedle').setAttribute('y2', ny.toFixed(2));
  document.getElementById('dialScore').textContent = Math.round(score);
}

function fmt(n, d = 2) { return n != null ? n.toFixed(d) : '—'; }
function fmtVol(v) {
  if (v >= 1e8) return (v / 1e8).toFixed(2) + '億';
  if (v >= 1e4) return (v / 1e4).toFixed(1) + '萬';
  return v.toLocaleString();
}
function fmtPrice(v, currency) {
  const sym = currency === 'TWD' ? 'NT$' : '$';
  return sym + v.toFixed(2);
}

function setBadge(id, cls, text) {
  const el = document.getElementById(id);
  el.className = 'ind-badge ' + cls;
  el.textContent = text;
}
function setMARow(valId, sigId, maVal, price) {
  document.getElementById(valId).textContent = maVal ? fmt(maVal) : 'N/A';
  const sigEl = document.getElementById(sigId);
  if (!maVal) { sigEl.textContent = '—'; sigEl.className = 'ma-signal'; return; }
  const above = price > maVal;
  sigEl.textContent = above ? '▲ 上方' : '▼ 下方';
  sigEl.className = 'ma-signal ' + (above ? 'above' : 'below');
}
function updateLoadingStatus(text) { if (loadingStatus) loadingStatus.textContent = text; }

// ===== APPLY RESULTS =====
function applyResults(data, prediction) {
  // Stock info bar
  document.getElementById('stockName').textContent = data.name;
  document.getElementById('stockSymbolTag').textContent = data.symbol;
  document.getElementById('currentPrice').textContent = fmtPrice(data.currentPrice, data.currency);
  const change = data.currentPrice - data.previousClose;
  const pct = (change / data.previousClose) * 100;
  const changeEl = document.getElementById('priceChange');
  const sign = change >= 0 ? '+' : '';
  changeEl.textContent = `${sign}${change.toFixed(2)} (${sign}${pct.toFixed(2)}%)`;
  changeEl.className = 'price-change ' + (change >= 0 ? 'up' : 'down');

  // Prediction card
  const card = document.getElementById('predictionCard');
  card.className = 'prediction-card ' + prediction.sentiment;
  document.getElementById('predIcon').textContent = prediction.icon;
  document.getElementById('predictionVerdict').textContent = prediction.verdict;
  document.getElementById('predictionDesc').textContent = prediction.desc;
  document.getElementById('confidenceValue').textContent = Math.round(prediction.confidence) + '%';
  const confBar = document.getElementById('confidenceBar');
  confBar.style.width = '0%';
  setTimeout(() => { confBar.style.width = prediction.confidence + '%'; }, 100);

  // Chart
  lastChartData = data;
  lastSentiment = prediction.sentiment;
  const canvas = document.getElementById('priceChart');
  requestAnimationFrame(() => renderChart(canvas, data, prediction.sentiment, currentChartMode));

  // RSI
  const rsiVal = prediction.indicators.rsi;
  document.getElementById('val-rsi').textContent = fmt(rsiVal);
  document.getElementById('needle-rsi').style.left = rsiVal + '%';
  const rsiBull = rsiVal < 40, rsiBear = rsiVal > 60;
  setBadge('badge-rsi', rsiBull ? 'bull' : rsiBear ? 'bear' : 'neut', rsiVal < 30 ? '超賣' : rsiVal > 70 ? '超買' : rsiVal < 50 ? '偏空' : '偏多');
  document.getElementById('desc-rsi').textContent =
    rsiVal < 30 ? '超賣區（< 30）：恐慌拋售，反彈機率高，等待確認訊號。' :
    rsiVal < 40 ? '接近超賣：賣壓趨緩，多方伺機介入。' :
    rsiVal > 70 ? '超買區（> 70）：漲幅過急，回調風險升高。' :
    rsiVal > 60 ? '偏強但接近超買區，動能尚佳，注意高點壓力。' :
    'RSI 中性區間，多空均衡，持續觀察。';

  // MACD
  const md = prediction.indicators.macd;
  document.getElementById('val-macd').textContent = fmt(md.currentHistogram, 3);
  renderMacdBars(document.getElementById('macdBars'), md.histogram);
  setBadge('badge-macd', md.currentHistogram > 0 ? 'bull' : 'bear', md.currentHistogram > 0 ? '多頭' : '空頭');
  document.getElementById('desc-macd').textContent =
    md.current > md.currentSignal
      ? md.currentHistogram > md.prevHistogram ? 'MACD 多頭交叉後柱狀擴張，動能加速向上。' : 'MACD 在信號線上方但柱狀收斂，多方趨緩。'
      : md.currentHistogram < md.prevHistogram ? 'MACD 死叉後柱狀擴張，空方動能加強。' : 'MACD 在信號線下方但柱狀收縮，跌勢趨緩。';

  // Moving Averages
  const { ma5, ma20, ma60 } = prediction.indicators;
  setMARow('ma5val', 'ma5sig', ma5, data.currentPrice);
  setMARow('ma20val', 'ma20sig', ma20, data.currentPrice);
  setMARow('ma60val', 'ma60sig', ma60, data.currentPrice);
  const bullMAs = [ma5, ma20, ma60].filter(v => v && data.currentPrice > v).length;
  setBadge('badge-ma', bullMAs >= 2 ? 'bull' : bullMAs === 1 ? 'neut' : 'bear',
    bullMAs >= 2 ? '多頭排列' : bullMAs === 1 ? '分歧' : '空頭排列');
  document.getElementById('desc-ma').textContent =
    bullMAs === 3 ? '股價站上三條均線，多頭排列確立，趨勢向好。' :
    bullMAs === 0 ? '股價跌破三條均線，空頭排列，持倉偏保守。' :
    '均線多空分歧，趨勢轉換期，宜謹慎等待方向確認。';

  // Bollinger Bands
  const bb = prediction.indicators.bb;
  const bbPos = prediction.indicators.bbPosition;
  document.getElementById('bbUpper').textContent = fmt(bb.upper);
  document.getElementById('bbMid').textContent = `中 ${fmt(bb.middle)}`;
  document.getElementById('bbLower').textContent = fmt(bb.lower);
  document.getElementById('bbPriceDot').style.left = `${Math.max(2, Math.min(98, bbPos * 100))}%`;
  setBadge('badge-bb', bbPos < 0.25 ? 'bull' : bbPos > 0.75 ? 'bear' : 'neut',
    data.currentPrice < bb.lower ? '破下軌' : data.currentPrice > bb.upper ? '破上軌' : `${(bbPos * 100).toFixed(0)}%位置`);
  document.getElementById('desc-bb').textContent =
    data.currentPrice < bb.lower ? '跌破布林下軌，嚴重超賣，可待反彈但需防趨勢性下跌。' :
    data.currentPrice > bb.upper ? '突破布林上軌，超買，留意回落訊號。' :
    `股價於通道內（${(bbPos * 100).toFixed(0)}%位置），波動正常。`;

  // Volume
  const latestVol = data.volumes[data.volumes.length - 1];
  document.getElementById('val-vol').textContent = fmtVol(latestVol);
  renderVolBars(document.getElementById('volBars'), data.volumes, data.closes);
  const vr = prediction.indicators.volRatio;
  const vs = prediction.indicators.volScore;
  setBadge('badge-vol', vs > 0 ? 'bull' : vs < 0 ? 'bear' : 'neut', `${(vr * 100).toFixed(0)}% 均量`);
  document.getElementById('desc-vol').textContent =
    vr > 1.3 && vs > 0 ? '量增價漲，量價配合良好，多方氣勢強。' :
    vr > 1.3 && vs < 0 ? '量增價跌（量大不漲），空方換手，賣壓重。' :
    vr < 0.8 ? '成交量萎縮，市場觀望，等待突破訊號。' : '成交量中等，無異常訊號。';

  // K-Line Patterns
  renderKlinePatterns(
    document.getElementById('klinePatterns'),
    prediction.patterns,
    document.getElementById('badge-kline'),
    document.getElementById('desc-kline')
  );

  // Score dial
  renderScoreDial(prediction.score);

  // 7 factors breakdown
  const factors = prediction.factorScores;
  const breakdown = document.getElementById('scoreBreakdown');
  breakdown.innerHTML = '';
  [
    { label: '🔥 動量 (Momentum)', score: factors.mom },
    { label: '💰 估值 (Valuation)', score: factors.val },
    { label: '💎 質量 (Quality)', score: factors.qual },
    { label: '📈 成長 (Growth)', score: factors.gro },
    { label: '⚖️ 波動性 (Volatility)', score: factors.vol },
    { label: '🧠 情緒 (Sentiment)', score: factors.sent },
    { label: '🌍 宏觀 (Macro)', score: factors.mac },
  ].forEach(f => {
    const el = document.createElement('div');
    el.className = 'factor-bar-wrapper';
    const color = f.score >= 80 ? '#22c55e' : f.score >= 60 ? '#84cc16' : f.score >= 40 ? '#facc15' : f.score >= 20 ? '#f97316' : '#ef4444';
    el.innerHTML = `
      <div class="factor-label"><span>${f.label}</span><span>${Math.round(f.score)}</span></div>
      <div class="factor-track"><div class="factor-fill" style="width:${f.score}%; background:${color}"></div></div>
    `;
    breakdown.appendChild(el);
  });

  // Price Targets & Projections Rendering
  renderPriceTargets(prediction.targets, data.currentPrice, data.currency, prediction.sentiment);
  renderTimeProjections(prediction.projections, data.currentPrice, data.currency);
  renderNews(prediction.newsSentiment);
}

function renderNews(newsData) {
  const list = document.getElementById('newsList');
  const badge = document.getElementById('badge-news');
  const desc = document.getElementById('desc-news');
  
  list.innerHTML = '';
  if (!newsData.news.length) {
    list.innerHTML = '<p class="loading-sub">近期尚無相關重大新聞</p>';
    badge.textContent = '無資料';
    badge.className = 'ind-badge neut';
    return;
  }

  newsData.news.forEach(item => {
    const el = document.createElement('a');
    el.href = item.link;
    el.target = '_blank';
    el.className = 'news-item';
    el.innerHTML = `
      <div class="news-item-title">${item.title}</div>
      <div class="news-item-meta">
        <span class="news-item-pub">${item.publisher}</span>
        <div class="news-sentiment-dot ${item.sentiment}"></div>
      </div>
    `;
    list.appendChild(el);
  });

  const s = newsData.score;
  badge.textContent = s > 2 ? '正向' : s < -2 ? '偏向負面' : '中性';
  badge.className = 'ind-badge ' + (s > 2 ? 'bull' : s < -2 ? 'bear' : 'neut');
  desc.textContent = s > 2 ? '近期消息面普遍看好，投資人信心積極。' : s < -2 ? '消息面充斥利空訊息，宜謹慎觀察賣盤壓力。' : '消息面情緒穩定，多空交戰均衡。';
}

function renderPriceTargets(targets, currentPrice, currency, sentiment) {
  const badge = document.getElementById('ptSentimentBadge');
  badge.textContent = sentiment === 'bullish' ? '看漲環境' : sentiment === 'bearish' ? '看跌環境' : '盤整環境';
  badge.className = 'pt-badge ' + sentiment;

  const tpLevels = document.getElementById('tpLevels');
  tpLevels.innerHTML = `
    <div class="tp-item">
      <span class="tp-dot"></span>
      <span class="tp-name">首要獲利 (TP1)</span>
      <span class="tp-val">${fmtPrice(targets.tp1, currency)}</span>
    </div>
    <div class="tp-item">
      <span class="tp-dot"></span>
      <span class="tp-name">延伸獲利 (TP2)</span>
      <span class="tp-val">${fmtPrice(targets.tp2, currency)}</span>
    </div>
  `;

  document.getElementById('slPrice').textContent = fmtPrice(targets.sl, currency);
  document.getElementById('slDesc').textContent = targets.sl < currentPrice ? '下行風險防線' : '上行壓力警示';

  const fibBox = document.getElementById('fibLevels');
  fibBox.innerHTML = '';
  const levels = ['0.382', '0.5', '0.618'];
  levels.forEach(lvl => {
    const item = document.createElement('div');
    item.className = 'fib-item';
    item.innerHTML = `<span class="fib-name">${lvl}</span><span class="fib-val">${fmt(targets.fib[lvl])}</span>`;
    fibBox.appendChild(item);
  });
}

function renderTimeProjections(projs, currentPrice, currency) {
  const periods = ['1m', '6m', '1y'];
  periods.forEach(p => {
    const rangeEl = document.getElementById(`range-${p}`);
    const barEl = document.getElementById(`bar-${p}`);
    const scenarioEl = document.getElementById(`scenario-${p}`);
    
    const { low, high } = projs[p];
    rangeEl.textContent = `${fmtPrice(low, currency)} - ${fmtPrice(high, currency)}`;
    
    // Bar visualization: current price position in the range
    const pct = ((currentPrice - low) / (high - low)) * 100;
    barEl.style.left = `${Math.max(0, Math.min(100, pct))}%`;

    const totalMove = ((high / currentPrice) - 1) * 100;
    scenarioEl.textContent = `預估波幅: ±${totalMove.toFixed(1)}%`;
  });
}

// ===== MAIN ANALYSIS =====
async function runAnalysis() {
  const raw = stockInput.value.trim();
  if (!raw) { stockInput.focus(); return; }

  const symbol = normalizeSymbol(raw);

  loadingSection.classList.remove('hidden');
  errorBox.classList.add('hidden');
  resultsSection.classList.add('hidden');
  analyzeBtn.disabled = true;
  analyzeBtn.style.opacity = '0.7';

  try {
    const data = await fetchStockData(symbol);
    updateLoadingStatus('獲取即時新聞...');
    updateLoadingStatus('獲取基本面數據...');
    const fundData = await fetchFundamentalData(symbol);
    data.fundamentals = fundData;

    updateLoadingStatus('獲取即時新聞...');
    const news = await fetchNews(symbol);
    data.newsSentiment = analyzeSentiment(news);

    updateLoadingStatus('識別 K 線型態...');
    await new Promise(r => setTimeout(r, 200));
    updateLoadingStatus('計算評分中...');
    await new Promise(r => setTimeout(r, 200));

    const prediction = predict(data);
    loadingSection.classList.add('hidden');
    resultsSection.classList.remove('hidden');
    updateStarBtn(data.symbol);
    applyResults(data, prediction);
  } catch (err) {
    loadingSection.classList.add('hidden');
    errorBox.classList.remove('hidden');
    let msg = err.message || '無法取得資料，請確認代碼後重試。';
    if (msg.includes('Failed to fetch')) {
      msg = '連線遭阻擋 (Failed to fetch)。可能是免費代理伺服器超載、遭 Yahoo 阻擋，或被您的「擋廣告外掛(AdBlock)」攔截。請稍後再試或暫時關閉外掛。';
    }
    errorMsg.textContent = msg;
    console.error(err);
  } finally {
    analyzeBtn.disabled = false;
    analyzeBtn.style.opacity = '1';
  }
}
