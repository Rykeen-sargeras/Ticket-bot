# 🎫 Discord Ticket Giveaway Bot + Web Dashboard

A Discord bot that distributes randomized giveaway tickets based on role, paired with a web dashboard featuring a **verifiable seed-based raffle spinner**.

## Role → Ticket Map

| Role | Tickets |
|------|---------|
| 🟡 1% Gang | 6 |
| 🟢 Short Shorts Gang | 4 |
| 🔵 Scooter Gang | 1 |
| 🔴 Banned Gang | 1 |
| 🚀 Server Booster | +1 bonus (stacks) |

## Features

- Ticket numbers are randomized (`XXXX-XXXX-XXXX`)
- Tickets DM'd privately to each user
- Giveaway channel only sees ticket *counts*
- Seed-based spinner — fully reproducible and verifiable
- Modern dark dashboard (dark blue / teal / silver / red)

---

## Quick Start (Local)

```bash
cp .env.example .env    # then fill in your values
npm install
npm start               # http://localhost:3000
```

## Discord Bot Setup

1. Go to https://discord.com/developers/applications
2. **New Application** → name it → go to **Bot** tab
3. Click **Reset Token** → copy the token → paste into `.env` as `DISCORD_TOKEN`
4. Under **Privileged Gateway Intents**, enable:
   - ✅ SERVER MEMBERS INTENT
   - ✅ MESSAGE CONTENT INTENT
5. Go to **OAuth2 → URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Permissions: `Send Messages`, `Use Slash Commands`, `Read Message History`
6. Copy the generated URL → open it → invite bot to your server

### Getting IDs (for .env)

Enable **Developer Mode**: User Settings → App Settings → Advanced → Developer Mode ON

- **GUILD_ID**: Right-click your server name → Copy Server ID
- **GIVEAWAY_CHANNEL_ID**: Right-click the channel → Copy Channel ID
- **Role IDs** (optional): Right-click a role → Copy Role ID

---

## Deploy to Railway

### Step 1 — Push to GitHub

Create a new repo on GitHub, then:

```bash
cd discord-ticket-bot
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

### Step 2 — Create Railway Project

1. Go to https://railway.com and sign in (GitHub login works)
2. Click **New Project**
3. Choose **Deploy from GitHub repo**
4. Select your repo from the list
5. Railway will auto-detect Node.js and start building

### Step 3 — Add Environment Variables

In your Railway project, click on the **service** (the card that appeared), then:

1. Go to the **Variables** tab
2. Click **+ New Variable** and add each one:

```
DISCORD_TOKEN        = your_bot_token_from_discord
GUILD_ID             = your_server_id
GIVEAWAY_CHANNEL_ID  = your_announcement_channel_id
DASHBOARD_PASSWORD   = THEmatchaman69420
SESSION_SECRET       = any_random_string_here_mash_keyboard
PORT                 = 3000
```

> Railway auto-assigns a port, but setting it explicitly avoids issues.

### Step 4 — Add a Volume (for persistent database)

Railway's filesystem is **ephemeral** — files get wiped on each deploy. You need a volume so your giveaway data survives:

1. In your project, click **+ New** → **Volume**
2. Set the **Mount Path** to: `/data`
3. Now add one more environment variable:

```
DATABASE_PATH = /data/giveaway.db
```

This tells the app to store the SQLite database on the persistent volume.

### Step 5 — Generate a Public URL

1. Click your service → **Settings** tab
2. Under **Networking**, click **Generate Domain**
3. You'll get a URL like `your-app-name.up.railway.app`
4. Open it in your browser — you should see the login page!

### Step 6 — Verify Everything Works

1. Open your Railway URL → log in with your password
2. Check the top-right corner — it should show your bot's name with a green dot
3. In Discord, type `/giveaway create Test Giveaway`
4. Then `/giveaway distribute 1`
5. Members with qualifying roles will get DM'd their tickets
6. Go back to the dashboard → click the giveaway → spin!

---

## Discord Commands

| Command | What it does |
|---------|-------------|
| `/giveaway create My Giveaway` | Creates a new giveaway |
| `/giveaway distribute 1` | Sends tickets to all qualifying members for giveaway #1 |
| `/giveaway list` | Shows all giveaways and their status |

Only server admins can use these commands.

---

## How the Spinner Works

1. Each ticket is one entry in the raffle (so 1% Gang members have 6 entries)
2. A **seed** is generated (or you paste one in)
3. The seed feeds into `seedrandom` which produces a deterministic random number
4. That number picks the winning index from the entry list
5. The same seed + same entries = same winner **every time**
6. Anyone can click **Verify Seed** to re-run and confirm

---

## Troubleshooting

**Bot shows "Offline" on dashboard?**
→ Check your `DISCORD_TOKEN` is correct in Railway variables. Check Railway logs for errors.

**Bot can't DM members?**
→ Some users have DMs disabled. The bot will still assign tickets, it just can't notify them. The channel announcement still goes out.

**"No tickets distributed"?**
→ Make sure your Discord roles match the names exactly: `Banned Gang`, `Scooter Gang`, `Short Shorts Gang`, `1% Gang`, `Server Booster`. Or set the role IDs in env vars for exact matching.

**Database resets on deploy?**
→ You forgot the volume. Go to Step 4 and add one.

---

## Project Structure

```
discord-ticket-bot/
├── server.js             # Express server + API routes
├── Procfile              # Railway process config
├── railway.toml          # Railway build/deploy config
├── nixpacks.toml         # Node.js version pinning
├── package.json
├── .env.example          # Template for environment variables
├── .gitignore
├── lib/
│   ├── bot.js            # Discord.js bot + slash commands
│   ├── database.js       # SQLite via better-sqlite3
│   ├── roles.js          # Role config + ticket calculation
│   ├── spinner.js        # Seed-based deterministic random
│   └── tickets.js        # Ticket number generator
├── views/
│   ├── login.ejs         # Login page
│   ├── dashboard.ejs     # Main dashboard
│   └── giveaway.ejs      # Giveaway detail + raffle spinner
├── public/
│   └── styles.css        # Dark theme (blue/teal/silver/red)
└── data/
    └── .gitkeep          # Placeholder for local SQLite db
```
