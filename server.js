const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 8080;
const APP_DIR = __dirname;
const DATA_FILE = path.join(APP_DIR, 'data', 'visits.json');
const MAX_VISITS = 500;
const PAGE_SIZE = 10;

app.set('view engine', 'hbs');
app.set('views', path.join(APP_DIR, 'views'));

function ensureData() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]', 'utf8');
}

function loadVisits() {
  ensureData();
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function saveVisits(visits) {
  ensureData();
  fs.writeFileSync(DATA_FILE, JSON.stringify(visits.slice(-MAX_VISITS), null, 2), 'utf8');
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

function parseUa(ua) {
  if (!ua) return 'Unknown';
  const s = ua.slice(0, 200).toLowerCase();
  const device = s.includes('tablet') || s.includes('ipad') ? 'Tablet' : (s.includes('mobile') || s.includes('android') ? 'Mobile' : 'Desktop');
  const browser = s.includes('edg/') ? 'Edge' : s.includes('opr/') || s.includes('opera') ? 'Opera' : s.includes('chrome') && !s.includes('chromium') ? 'Chrome' : s.includes('firefox') ? 'Firefox' : s.includes('safari') && !s.includes('chrome') ? 'Safari' : 'Other';
  return `${device} · ${browser}`;
}

app.get('/', (req, res) => {
  res.render('index', { hostname: req.hostname || 'pi.local' });
});

app.post('/api/visit', express.json(), (req, res) => {
  const visits = loadVisits();
  const body = req.body || {};
  const rawUa = req.headers['user-agent'] || '';
  const referrer = String(body.referrer || req.get('referer') || '').slice(0, 500);
  const sw = body.screenWidth, sh = body.screenHeight;
  visits.push({
    time: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    ip: getClientIp(req),
    userAgent: rawUa.slice(0, 400),
    referrer,
    device: parseUa(rawUa),
    screen: sw != null && sh != null ? `${sw}×${sh}` : null,
    language: typeof body.language === 'string' ? body.language.slice(0, 32) : null,
  });
  saveVisits(visits);
  res.json({ ok: true });
});

app.get('/api/stats', (req, res) => {
  const visits = loadVisits();
  const ipCounts = {};
  visits.forEach((v) => { ipCounts[v.ip] = (ipCounts[v.ip] || 0) + 1; });
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || PAGE_SIZE));
  const reversed = [...visits].reverse().map((v) => ({ ...v, visitCount: ipCounts[v.ip] || 1 }));
  const start = (page - 1) * limit;
  const recentVisits = reversed.slice(start, start + limit);
  res.json({
    totalViews: visits.length,
    uniqueVisitors: new Set(visits.map((v) => v.ip)).size,
    recentVisits,
    hasMore: start + recentVisits.length < reversed.length,
  });
});

ensureData();
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Raspberry Pi dashboard at http://0.0.0.0:${PORT}`);
});
