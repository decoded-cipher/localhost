const fs = require('fs');
const path = require('path');

const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const ZONE_ID = process.env.CLOUDFLARE_ZONE_ID;
const RECORD_NAME = process.env.CF_DNS_RECORD_NAME;
const ZONE_NAME = process.env.CLOUDFLARE_ZONE_NAME;
const STATE_FILE = path.join('/tmp', 'cf-dns-last-ip');

function logErr(msg) {
  console.error(`${new Date().toISOString()} ${msg}`);
}

async function getPublicIP() {
  const urls = ['https://api.ipify.org', 'https://icanhazip.com'];
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (res.ok) {
        const ip = (await res.text()).trim();
        if (ip && /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) return ip;
      }
    } catch (_) {}
  }
  return null;
}

async function main() {
  if (!API_TOKEN) {
    logErr('Set CLOUDFLARE_API_TOKEN');
    process.exit(1);
  }

  const currentIP = await getPublicIP();
  if (!currentIP) {
    logErr('Failed to get public IP');
    process.exit(1);
  }

  if (fs.existsSync(STATE_FILE)) {
    try {
      const lastIP = fs.readFileSync(STATE_FILE, 'utf8').trim();
      if (lastIP === currentIP) process.exit(0);
    } catch (_) {}
  }

  const { default: Cloudflare } = await import('cloudflare');
  const client = new Cloudflare({ apiToken: API_TOKEN });

  let zoneId = ZONE_ID;
  if (!zoneId) {
    const zones = await client.zones.list({ name: ZONE_NAME });
    const zone = zones.result?.[0];
    if (!zone?.id) {
      logErr(`Could not get Zone ID for ${ZONE_NAME}`);
      process.exit(1);
    }
    zoneId = zone.id;
  }

  const fullName = `${RECORD_NAME}.${ZONE_NAME}`;
  const list = await client.dns.records.list({
    zone_id: zoneId,
    type: 'A',
    name: fullName,
  });
  const record = list.result?.[0];
  const existingIP = record?.content;

  if (record && existingIP === currentIP) {
    fs.writeFileSync(STATE_FILE, currentIP);
    process.exit(0);
  }

  const body = {
    type: 'A',
    name: RECORD_NAME,
    content: currentIP,
    proxied: true,
    ttl: 1,
  };

  try {
    if (record?.id) {
      await client.dns.records.edit(record.id, {
        zone_id: zoneId,
        ...body,
      });
    } else {
      await client.dns.records.create({
        zone_id: zoneId,
        ...body,
      });
    }
  } catch (err) {
    logErr(`Cloudflare API error: ${err.message}`);
    process.exit(1);
  }

  fs.writeFileSync(STATE_FILE, currentIP);
  console.log(`${new Date().toISOString()} Updated ${fullName} to ${currentIP}`);
}

main();
