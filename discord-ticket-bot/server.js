require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const path = require('path');
const { createBot, getClient, isBotReady } = require('./lib/bot');
const db = require('./lib/database');
const { generateSeed, spinWithSeed } = require('./lib/spinner');
const { ROLE_CONFIG, getRoleColor } = require('./lib/roles');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Middleware ---
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// --- Auth middleware ---
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }
  res.redirect('/login');
}

// --- Auth routes ---
app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const { password } = req.body;
  // Collect passwords from both DASHBOARD_PASSWORD and DASHBOARD_PASSWORD_2
  const passwords = [];
  if (process.env.DASHBOARD_PASSWORD) {
    process.env.DASHBOARD_PASSWORD.split(',').forEach(p => passwords.push(p.trim()));
  }
  if (process.env.DASHBOARD_PASSWORD_2) {
    passwords.push(process.env.DASHBOARD_PASSWORD_2.trim());
  }
  if (passwords.includes(password)) {
    req.session.authenticated = true;
    return res.redirect('/');
  }
  res.render('login', { error: 'Invalid password' });
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// --- Dashboard routes ---
app.get('/', requireAuth, (req, res) => {
  const giveaways = db.getAllGiveaways();
  res.render('dashboard', { giveaways, botReady: isBotReady() });
});

app.get('/giveaway/:id', requireAuth, (req, res) => {
  const giveaway = db.getGiveaway(parseInt(req.params.id));
  if (!giveaway) return res.status(404).send('Giveaway not found');
  
  const tickets = db.getTicketsForGiveaway(giveaway.id);
  const history = db.getSpinHistory(giveaway.id);
  
  // Group tickets by role
  const grouped = {};
  for (const role of ROLE_CONFIG) {
    grouped[role.name] = {
      color: role.color,
      users: {}
    };
  }
  
  for (const ticket of tickets) {
    const roleName = ticket.role_name;
    if (!grouped[roleName]) {
      grouped[roleName] = { color: getRoleColor(roleName), users: {} };
    }
    if (!grouped[roleName].users[ticket.user_id]) {
      grouped[roleName].users[ticket.user_id] = {
        username: ticket.username,
        displayName: ticket.display_name,
        tickets: []
      };
    }
    grouped[roleName].users[ticket.user_id].tickets.push(ticket);
  }

  res.render('giveaway', { giveaway, grouped, tickets, history, ROLE_CONFIG });
});

// --- API routes ---
app.post('/api/giveaway/create', requireAuth, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const id = db.createGiveaway(name);

  // Post the enter button to Discord
  const client = getClient();
  const channelId = process.env.GIVEAWAY_CHANNEL_ID;
  if (client && isBotReady() && channelId) {
    try {
      const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
      const guild = client.guilds.cache.get(process.env.GUILD_ID);
      if (guild) {
        const channel = guild.channels.cache.get(channelId);
        if (channel) {
          const embed = new EmbedBuilder()
            .setTitle('🎉 GIVEAWAY — ' + name)
            .setDescription(
              `Click the button below to enter!\n\n` +
              `Your tickets are based on your role:\n` +
              `🟡 **1% Gang** — 6 tickets\n` +
              `🟢 **Short Shorts Gang** — 4 tickets\n` +
              `🔵 **Scooter Gang** — 2 tickets\n` +
              `🔴 **Banned Gang** — 1 ticket\n` +
              `🚀 **Server Booster** — +1 bonus ticket\n\n` +
              `Ticket numbers will be DM'd to you privately.`
            )
            .setColor(0x00cccc)
            .setFooter({ text: `Giveaway #${id}` })
            .setTimestamp();

          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`enter_giveaway_${id}`)
              .setLabel('🎫 Enter Giveaway')
              .setStyle(ButtonStyle.Success)
          );

          await channel.send({ embeds: [embed], components: [row] });
        }
      }
    } catch (err) {
      console.error('Failed to post giveaway to Discord:', err);
    }
  }

  res.json({ success: true, id });
});

app.post('/api/giveaway/:id/spin', requireAuth, (req, res) => {
  const giveawayId = parseInt(req.params.id);
  const giveaway = db.getGiveaway(giveawayId);
  if (!giveaway) return res.status(404).json({ error: 'Not found' });

  const tickets = db.getTicketsForGiveaway(giveawayId);
  if (tickets.length === 0) return res.status(400).json({ error: 'No tickets' });

  // Build entries — each ticket is one entry (so users with 6 tickets appear 6 times)
  const entries = tickets.map(t => ({
    id: t.id,
    userId: t.user_id,
    username: t.username,
    displayName: t.display_name,
    ticketNumber: t.ticket_number,
    roleName: t.role_name
  }));

  // Use provided seed or generate new one
  const seed = req.body.seed || generateSeed();
  const result = spinWithSeed(seed, entries);

  if (!result) return res.status(500).json({ error: 'Spin failed' });

  // Save spin history
  db.addSpinHistory(giveawayId, seed, result.winner.id);
  
  // Mark giveaway as completed with winner
  db.setGiveawayWinner(
    giveawayId, seed,
    result.winner.userId,
    result.winner.username,
    result.winner.roleName,
    result.winner.ticketNumber
  );

  res.json({
    success: true,
    seed,
    winnerIndex: result.index,
    winner: result.winner,
    totalEntries: entries.length,
    entries: entries.map(e => ({
      displayName: e.displayName,
      username: e.username,
      roleName: e.roleName,
      ticketNumber: e.ticketNumber
    }))
  });
});

app.post('/api/giveaway/:id/verify', requireAuth, (req, res) => {
  const giveawayId = parseInt(req.params.id);
  const { seed } = req.body;
  if (!seed) return res.status(400).json({ error: 'Seed required' });

  const tickets = db.getTicketsForGiveaway(giveawayId);
  const entries = tickets.map(t => ({
    id: t.id,
    userId: t.user_id,
    username: t.username,
    displayName: t.display_name,
    ticketNumber: t.ticket_number,
    roleName: t.role_name
  }));

  const result = spinWithSeed(seed, entries);
  res.json({
    success: true,
    seed,
    winnerIndex: result.index,
    winner: result.winner,
    totalEntries: entries.length
  });
});

app.get('/api/giveaway/:id/entries', requireAuth, (req, res) => {
  const giveawayId = parseInt(req.params.id);
  const tickets = db.getTicketsForGiveaway(giveawayId);
  
  const entries = tickets.map(t => ({
    id: t.id,
    userId: t.user_id,
    username: t.username,
    displayName: t.display_name,
    ticketNumber: t.ticket_number,
    roleName: t.role_name
  }));

  res.json({ entries });
});

app.get('/api/bot/status', requireAuth, (req, res) => {
  const client = getClient();
  res.json({
    ready: isBotReady(),
    username: client?.user?.tag || null,
    guilds: client?.guilds?.cache?.size || 0
  });
});

// Announce winner to Discord with screenshot
app.post('/api/giveaway/:id/announce', requireAuth, async (req, res) => {
  const giveawayId = parseInt(req.params.id);
  const giveaway = db.getGiveaway(giveawayId);
  if (!giveaway) return res.status(404).json({ error: 'Not found' });

  const { prize, imageBase64 } = req.body;
  if (!giveaway.winner_username) {
    return res.status(400).json({ error: 'No winner has been selected yet. Spin first!' });
  }

  const client = getClient();
  if (!client || !isBotReady()) {
    return res.status(503).json({ error: 'Bot is not connected' });
  }

  const channelId = process.env.GIVEAWAY_CHANNEL_ID;
  if (!channelId) {
    return res.status(400).json({ error: 'GIVEAWAY_CHANNEL_ID not set' });
  }

  try {
    const guild = client.guilds.cache.get(process.env.GUILD_ID);
    if (!guild) return res.status(400).json({ error: 'Guild not found' });

    const channel = guild.channels.cache.get(channelId);
    if (!channel) return res.status(400).json({ error: 'Channel not found' });

    const { EmbedBuilder, AttachmentBuilder } = require('discord.js');

    // Build the embed
    const embed = new EmbedBuilder()
      .setTitle('🏆 GIVEAWAY WINNER 🏆')
      .setDescription(
        `**${giveaway.name}**\n\n` +
        `🎉 Congratulations to **${giveaway.winner_username}**!\n\n` +
        (prize ? `🎁 **Prize:** ${prize}\n\n` : '') +
        `📋 **Details:**\n` +
        `> Role: **${giveaway.winner_role}**\n` +
        `> Ticket: \`${giveaway.winner_ticket_number}\`\n` +
        `> Seed: \`${giveaway.seed}\`\n\n` +
        `Anyone can verify this result using the seed above.`
      )
      .setColor(0xFFCC00)
      .setTimestamp();

    const files = [];

    // Attach screenshot if provided
    if (imageBase64) {
      const imageBuffer = Buffer.from(imageBase64.replace(/^data:image\/\w+;base64,/, ''), 'base64');
      const attachment = new AttachmentBuilder(imageBuffer, { name: 'winner.png' });
      files.push(attachment);
      embed.setImage('attachment://winner.png');
    }

    await channel.send({ embeds: [embed], files });

    res.json({ success: true, message: 'Winner announced in Discord!' });
  } catch (err) {
    console.error('Announce error:', err);
    res.status(500).json({ error: err.message });
  }
});

// --- Start server & bot ---
app.listen(PORT, () => {
  console.log(`🌐 Dashboard running at http://localhost:${PORT}`);
});

// Start Discord bot if token is available
if (process.env.DISCORD_TOKEN) {
  const bot = createBot();
  bot.login(process.env.DISCORD_TOKEN).catch(err => {
    console.error('❌ Bot login failed:', err.message);
    console.log('Dashboard will still run without the bot.');
  });
} else {
  console.log('⚠️  No DISCORD_TOKEN set — dashboard running without bot');
}
