-- name: init
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value INTEGER);
INSERT OR IGNORE INTO meta (key, value) VALUES ('total_views', 0);

CREATE TABLE IF NOT EXISTS seen_ips (ip TEXT PRIMARY KEY);

CREATE TABLE IF NOT EXISTS visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  time TEXT NOT NULL,
  ip TEXT NOT NULL,
  user_agent TEXT,
  referrer TEXT,
  device TEXT,
  screen TEXT,
  language TEXT
);

-- name: insertVisit
INSERT INTO visits (time, ip, user_agent, referrer, device, screen, language)
VALUES (?, ?, ?, ?, ?, ?, ?);

-- name: incTotalViews
UPDATE meta SET value = value + 1 WHERE key = 'total_views';

-- name: addSeenIp
INSERT OR IGNORE INTO seen_ips (ip) VALUES (?);

-- name: trimVisits
DELETE FROM visits WHERE id NOT IN (SELECT id FROM visits ORDER BY id DESC LIMIT ?);

-- name: getTotalViews
SELECT value FROM meta WHERE key = 'total_views';

-- name: getUniqueVisitors
SELECT COUNT(*) AS n FROM seen_ips;

-- name: getRecentVisits
SELECT id, time, ip, user_agent AS userAgent, referrer, device, screen, language
FROM visits ORDER BY id DESC LIMIT ? OFFSET ?;

-- name: getIpCounts
SELECT ip, COUNT(*) AS n FROM visits GROUP BY ip;

-- name: getVisitCount
SELECT COUNT(*) AS n FROM visits;
