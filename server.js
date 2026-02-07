const express = require('express');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 8080;
const APP_DIR = __dirname;
const DATA_DIR = path.join(APP_DIR, 'data');
const DB_PATH = path.join(DATA_DIR, 'visits.db');
const SQL_FILE = path.join(APP_DIR, 'queries.sql');
const INDEX_FILE = path.join(APP_DIR, 'index.html');
const MAX_VISITS = 100;
const PAGE_SIZE = 10;

function loadSql(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const sql = {};
  const regex = /--\s*name:\s*(\S+)\s*\n([\s\S]*?)(?=\n--\s*name:\s|\n*$)/g;
  let m;
  while ((m = regex.exec(content)) !== null) {
    sql[m[1]] = m[2].trim();
  }
  return sql;
}

const sql = loadSql(SQL_FILE);

function getDb() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(DB_PATH);
  db.exec(sql.init);
  return db;
}

const db = getDb();

const insertVisit = db.prepare(sql.insertVisit);
const incTotalViews = db.prepare(sql.incTotalViews);
const addSeenIp = db.prepare(sql.addSeenIp);
const trimVisits = db.prepare(sql.trimVisits);

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
  const hostname = req.hostname || 'pi.local';
  const html = fs.readFileSync(INDEX_FILE, 'utf8').replace(/__HOSTNAME__/g, hostname);
  res.type('html').send(html);
});

app.post('/api/visit', express.json(), (req, res) => {
  const body = req.body || {};
  const rawUa = req.headers['user-agent'] || '';
  const referrer = String(body.referrer || req.get('referer') || '').slice(0, 500);
  const sw = body.screenWidth, sh = body.screenHeight;
  const ip = getClientIp(req);
  const time = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  db.transaction(() => {
    insertVisit.run(time, ip, rawUa.slice(0, 400), referrer, parseUa(rawUa), sw != null && sh != null ? `${sw}×${sh}` : null, typeof body.language === 'string' ? body.language.slice(0, 32) : null);
    incTotalViews.run();
    addSeenIp.run(ip);
    trimVisits.run(MAX_VISITS);
  })();

  res.json({ ok: true });
});

app.get('/api/stats', (req, res) => {
  const totalViews = db.prepare(sql.getTotalViews).get()?.value ?? 0;
  const uniqueVisitors = db.prepare(sql.getUniqueVisitors).get()?.n ?? 0;

  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || PAGE_SIZE));
  const offset = (page - 1) * limit;

  const rows = db.prepare(sql.getRecentVisits).all(limit, offset);

  const ipCounts = {};
  db.prepare(sql.getIpCounts).all().forEach((r) => { ipCounts[r.ip] = r.n; });

  const recentVisits = rows.map((r) => ({ ...r, visitCount: ipCounts[r.ip] ?? 1 }));

  const totalRows = db.prepare(sql.getVisitCount).get().n;
  res.json({
    totalViews,
    uniqueVisitors,
    recentVisits,
    hasMore: rows.length === limit && totalRows > offset + limit,
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Raspberry Pi dashboard at http://0.0.0.0:${PORT}`);
});
