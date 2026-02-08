# Hosting on Raspberry Pi with Cloudflare

This guide uses **Cloudflare** for DNS and a **Cloudflare Tunnel** so you get a custom domain and HTTPS **without opening any ports** on your router.

---

## 1. Prerequisites

- Raspberry Pi on your local network
- **arjunkrishna.dev** added to Cloudflare (Dashboard → Add site, then point the registrar’s nameservers to Cloudflare)
- Your app will run on the Pi; the tunnel will expose it at **https://pi.arjunkrishna.dev**

---

## 2. Run the app on the Pi

**On the Pi:**

```bash
# Install Node.js (if not already)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# In your project folder
cd /path/to/localhost
npm install --production
```

**Run with PM2** (starts on boot, restarts on crash):

```bash
sudo npm install -g pm2
PORT=8080 pm2 start app/server.js --name "pi-dashboard"
pm2 save
pm2 startup   # run the command it prints (with sudo if needed)
```

The app is now at `http://localhost:8080` on the Pi.

---

## 3. Cloudflare Tunnel (no port forwarding)

A **Cloudflare Tunnel** lets Cloudflare reach your app over an outbound connection from the Pi. You don’t open ports 80/443 or expose your home IP.

### 3.1 Install cloudflared on the Pi

```bash
# Add Cloudflare package repo (Debian/Ubuntu/Raspberry Pi OS)
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb
# For 32-bit Pi (e.g. older Raspberry Pi OS): use cloudflared-linux-arm.deb instead of arm64
sudo dpkg -i cloudflared.deb
```

### 3.2 Log in (required before creating a tunnel)

You must run **`cloudflared tunnel login`** first. It creates the origin certificate that `tunnel create` needs. If you skip this, you’ll see: *"Cannot determine default origin certificate path"* or *"Error locating origin cert"*.

**On a machine with a browser** (your laptop/desktop or Pi with desktop):

```bash
cloudflared tunnel login
```

A browser window opens; log in to Cloudflare and select **arjunkrishna.dev** as the domain for the tunnel. When done, the origin cert is saved as **`~/.cloudflared/cert.pem`**.

**Headless Pi (no browser):** Run `cloudflared tunnel login` on your laptop/desktop instead. After login you’ll have `~/.cloudflared/cert.pem` there. Copy it to the Pi:

```bash
# From your laptop (replace pi@raspberrypi with your Pi user@host)
scp ~/.cloudflared/cert.pem pi@raspberrypi:~/.cloudflared/
# On the Pi, ensure the directory exists and fix ownership
ssh pi@raspberrypi "mkdir -p ~/.cloudflared && chmod 700 ~/.cloudflared"
```

Then on the Pi, verify the cert is present:

```bash
ls -la ~/.cloudflared/cert.pem
```

### 3.3 Create the tunnel

**Only after** `cert.pem` exists on the Pi (or in the same account where you run cloudflared):

```bash
cloudflared tunnel create pi-dashboard
```

Note the **tunnel ID** (e.g. `abc123-def456-...`) from the output. It’s also in `~/.cloudflared/<tunnel-id>.json`. If you did login on another machine, copy that JSON file to the Pi’s `~/.cloudflared/` as well so the Pi can run the tunnel.

### 3.4 Config file for the tunnel

Create the config (replace `YOUR_TUNNEL_ID` with the ID from `tunnel create`):

```bash
sudo mkdir -p /etc/cloudflared
sudo nano /etc/cloudflared/config.yml
```

**`/etc/cloudflared/config.yml`:**

```yaml
tunnel: YOUR_TUNNEL_ID
credentials-file: /home/pi/.cloudflared/YOUR_TUNNEL_ID.json

ingress:
  - hostname: pi.arjunkrishna.dev
    service: http://localhost:8080
  - service: http_status:404
```

Use your Pi username if it’s not `pi`, and fix the path to the JSON file (it’s in `~/.cloudflared/`).

### 3.5 Create the DNS record in Cloudflare

Either in **Zero Trust Dashboard** (Tunnels → your tunnel → Public Hostname) or via **Cloudflare Dashboard** (DNS) for **arjunkrishna.dev**:

- **Type:** CNAME  
- **Name:** `pi`  
- **Target:** `YOUR_TUNNEL_ID.cfargotunnel.com`  
- **Proxy status:** Proxied (orange cloud)

Then **https://pi.arjunkrishna.dev** will resolve through your tunnel.

### 3.6 Run the tunnel as a service

```bash
sudo cloudflared service install
sudo systemctl start cloudflared
sudo systemctl enable cloudflared
```

Check: `sudo systemctl status cloudflared`. Then open **https://pi.arjunkrishna.dev** — Cloudflare provides HTTPS and forwards to your app.

---

## 4. Alternative: DNS update via script (no tunnel)

Instead of a tunnel, a script can update the **A** record for **pi.arjunkrishna.dev** whenever your public IP changes. Traffic is still **proxied** (orange cloud), so visitors see Cloudflare’s IPs.

- **Script:** `cf-dns.js` in project root. Env: `CLOUDFLARE_API_TOKEN` (required). Run: `node cf-dns.js` or `npm run dns-update`. Cron (every minute): `* * * * * cd /path/to/project && CLOUDFLARE_API_TOKEN=your_token node cf-dns.js >> /tmp/cf-dns.log 2>&1`. Only calls the API when your public IP changes.
- **Router:** Port forward 80 and 443 to the Pi.
- **Pi:** Run Caddy or Nginx + Certbot so Cloudflare can connect to your origin over HTTPS (or HTTP with Flexible SSL). If you were using a tunnel, remove the CNAME for `pi` and stop cloudflared; the script will create/update the A record.

---

## 5. Optional: Cloudflare DNS only (with port forwarding)

If you prefer to keep a reverse proxy (Caddy/Nginx) on the Pi and only use Cloudflare for DNS + proxy:

1. **Cloudflare Dashboard → DNS** (arjunkrishna.dev)
   - Add **A** record: name `pi`, value = your **public IP**, **Proxy on** (orange cloud).

2. **Router:** Port forward **80** and **443** to the Pi.

3. On the Pi, run **Caddy** or **Nginx + Certbot** as in the previous guide so the Pi serves HTTPS; Cloudflare will proxy to your Pi’s public IP.

With the **tunnel** (Section 3), you don’t need step 2 or a reverse proxy on the Pi for SSL.

---

## 6. Checklist (Cloudflare Tunnel)

| Step | Action |
|------|--------|
| 1 | Domain is on Cloudflare (nameservers updated at registrar). |
| 2 | App runs on Pi: `http://localhost:8080` (e.g. with PM2). |
| 3 | `cloudflared` installed; `cloudflared tunnel login` and `tunnel create pi-dashboard` done. |
| 4 | `/etc/cloudflared/config.yml` points hostname to `http://localhost:8080`. |
| 5 | DNS CNAME: `pi` → `YOUR_TUNNEL_ID.cfargotunnel.com` (proxied). |
| 6 | `cloudflared` running as a service; visit **https://pi.arjunkrishna.dev**. |

---

## 7. Security notes

- **No open ports:** With the tunnel, you don’t need to open 80/443 on your router; the Pi only makes outbound connections.
- **Visitor IPs:** With Cloudflare in front, your app sees Cloudflare’s headers. Your `app/server.js` already uses `X-Forwarded-For` / `X-Real-IP`; Cloudflare sends the real client IP there, so stats stay correct.
- **Updates:** Keep the Pi, Node, and `cloudflared` updated.
- **SSH:** Prefer key-based login; consider disabling password auth.

Your dashboard uses `X-Forwarded-For` / `X-Real-IP` in `app/server.js`, so visitor IPs will be correct behind Cloudflare.
