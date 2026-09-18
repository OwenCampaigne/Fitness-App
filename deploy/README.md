# Running this on a Raspberry Pi 5

A Pi 5 with 16 GB is comfortably more machine than this needs. One user, a
SQLite file, a handful of requests a day. The build is the only part that works
the CPU, and it takes two or three minutes.

Everything below assumes user `owen` and `~/fitness-app`. Change both in the
service files if yours differ.

---

## 1. Node

Bookworm ships a Node too old for Next 14. Install 22 LTS:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs build-essential python3 sqlite3 git
```

`build-essential` and `python3` are there for `better-sqlite3`, which is a
native module. It usually finds a prebuilt arm64 binary; when it does not, it
compiles, and without those two it fails in a way that reads like a broken
install rather than a missing toolchain.

## 2. Clone and configure

```bash
git clone https://github.com/OwenCampaigne/Fitness-App.git ~/fitness-app
cd ~/fitness-app
npm ci
cp .env.example .env.local
nano .env.local
```

Fill in:

```env
DATABASE_URL=file:./prisma/dev.db
GARMIN_USERNAME=...
GARMIN_PASSWORD=...
CRON_SECRET=<openssl rand -hex 32>

# Only if you run OmniRoute here too — see step 5.
ANTHROPIC_BASE_URL=http://localhost:20128/v1
ANTHROPIC_API_KEY=omniroute-local
ANTHROPIC_MODEL=cc/claude-opus-5
```

## 3. Bring the database over

The database is gitignored, so cloning gives you the schema and none of the
history. Copy it from the laptop:

```bash
# on the laptop
scp "prisma/dev.db" owen@raspberrypi.local:~/fitness-app/prisma/dev.db
```

Then on the Pi:

```bash
npx prisma generate
npx prisma migrate deploy   # no-op if the copied db is already current
npm run build
```

Starting fresh instead? `npx prisma migrate deploy` creates the tables, then
`npm run seed` and `npm run seed:libraries` load the exercise catalogs, then
`npx tsx scripts/garmin-backfill.ts 28` pulls your history.

## 4. Run it as a service

```bash
sudo cp deploy/fitness-app.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now fitness-app
journalctl -u fitness-app -f
```

Survives reboots, restarts on crash.

## 5. OmniRoute, if you want the coach

The coach reaches Claude through a local gateway, so it has to run on the same
box for `localhost:20128` to mean anything.

```bash
sudo npm install -g omniroute
omniroute setup          # interactive: reconnect your providers here
sudo cp deploy/omniroute.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now omniroute
```

The OAuth connections do not transfer from the laptop — you authorise again on
the Pi. The unit pins the listener to loopback: OmniRoute's inference plane is
unauthenticated by default, and this machine shares a network with everything
else in the house.

Skipping it is fine. The coach returns a 503 that says it is unavailable, and
nothing else in the app depends on it.

## 6. Reaching it from your phone

[Tailscale](https://tailscale.com) is the least-bad option — free for personal
use, no ports opened, no dynamic-DNS, and it works on campus wifi where port
forwarding will not.

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

Install Tailscale on your phone, sign in with the same account, and the app is
at `http://raspberrypi:3030`. Add it to your home screen and the PWA installs.

Note the PWA's service worker and push notifications want HTTPS. Tailscale
Serve gives you a real certificate:

```bash
sudo tailscale serve --bg 3030
```

## 7. Keep it fed and backed up

```bash
crontab -e
```

```cron
# Garmin sync, three times a day — the watch uploads at different times and a
# missed morning pull should not cost the day.
0 6,12,21 * * * curl -fsS "http://localhost:3030/api/sync?secret=YOUR_CRON_SECRET" >/dev/null

# Database backup at 3am, 30 kept.
0 3 * * * /home/owen/fitness-app/deploy/backup.sh >> /home/owen/backup.log 2>&1
```

The app never calls Garmin in a request path — it reads SQLite, and the sync
fills it. Without the cron the data simply stops updating.

**Back the database up somewhere off the Pi as well.** A boot volume is a
single point of failure, and `dev.db` holds every day of HRV, every logged set
and your clearance history. `rsync ~/fitness-backups` to another machine
weekly, or point `BACKUP_DIR` at a mounted drive.

---

## Updating

From the laptop: commit, push. On the Pi:

```bash
cd ~/fitness-app && ./deploy/deploy.sh
```

Backs up the database, pulls, installs, migrates, builds, restarts, and checks
`/api/health` before declaring success.

### Schema changes — the part worth being careful about

**On the laptop**, when `schema.prisma` changes:

```bash
npx prisma migrate dev --name what_changed
```

That writes a versioned SQL file into `prisma/migrations/`. Commit it.

**On the Pi**, `deploy.sh` runs `npx prisma migrate deploy`, which applies only
the missing migrations and refuses rather than guessing if the database is not
where it expects.

**Do not run `prisma db push` against the Pi.** It reshapes the database to
match the schema, which means it will drop a column to make a rename happen.
That is fine against seed data and unrecoverable against a year of training
history. The repo was baselined onto migrations (`0_init`) precisely so that
`db push` never needs to be the answer again.
