const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { calculateTickets } = require('./roles');
const { generateTicketNumbers } = require('./tickets');
const db = require('./database');

let client;
let botReady = false;

function createBot() {
  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages
    ]
  });

  client.once('ready', async () => {
    console.log(`🤖 Bot logged in as ${client.user.tag}`);
    botReady = true;
    await registerCommands();
  });

  client.on('interactionCreate', async (interaction) => {
    if (interaction.isChatInputCommand()) {
      await handleCommand(interaction);
    } else if (interaction.isButton()) {
      await handleButton(interaction);
    }
  });

  return client;
}

async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('giveaway')
      .setDescription('Manage giveaways')
      .addSubcommand(sub =>
        sub.setName('create')
          .setDescription('Create a new giveaway and post the enter button')
          .addStringOption(opt => opt.setName('name').setDescription('Giveaway name').setRequired(true))
      )
      .addSubcommand(sub =>
        sub.setName('distribute')
          .setDescription('Bulk distribute tickets to ALL qualifying members')
          .addIntegerOption(opt => opt.setName('id').setDescription('Giveaway ID').setRequired(true))
      )
      .addSubcommand(sub =>
        sub.setName('list')
          .setDescription('List all giveaways')
      )
      .addSubcommand(sub =>
        sub.setName('close')
          .setDescription('Close a giveaway (disables the enter button)')
          .addIntegerOption(opt => opt.setName('id').setDescription('Giveaway ID').setRequired(true))
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  ];

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(
      Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID),
      { body: commands.map(c => c.toJSON()) }
    );
    console.log('✅ Slash commands registered');
  } catch (err) {
    console.error('Failed to register commands:', err);
  }
}

// =====================
// SLASH COMMAND HANDLER
// =====================
async function handleCommand(interaction) {
  if (interaction.commandName !== 'giveaway') return;
  const sub = interaction.options.getSubcommand();

  // --- CREATE ---
  if (sub === 'create') {
    const name = interaction.options.getString('name');
    const giveawayId = db.createGiveaway(name);

    // Post the enter button in the giveaway channel
    const channelId = process.env.GIVEAWAY_CHANNEL_ID;
    const channel = channelId
      ? interaction.guild.channels.cache.get(channelId)
      : interaction.channel;

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
      .setFooter({ text: `Giveaway #${giveawayId}` })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`enter_giveaway_${giveawayId}`)
        .setLabel('🎫 Enter Giveaway')
        .setStyle(ButtonStyle.Success)
    );

    if (channel) {
      await channel.send({ embeds: [embed], components: [row] });
    }

    await interaction.reply({
      content: `✅ Giveaway **${name}** created (ID: \`${giveawayId}\`)${channel ? ` — entry button posted in <#${channel.id}>` : ''}`,
      ephemeral: true
    });
  }

  // --- DISTRIBUTE (bulk) ---
  else if (sub === 'distribute') {
    const giveawayId = interaction.options.getInteger('id');
    const giveaway = db.getGiveaway(giveawayId);

    if (!giveaway) {
      return interaction.reply({ content: '❌ Giveaway not found.', ephemeral: true });
    }
    if (giveaway.status !== 'open') {
      return interaction.reply({ content: '❌ This giveaway is not open.', ephemeral: true });
    }

    await interaction.deferReply();

    try {
      const result = await distributeTicketsBulk(giveawayId, interaction.guild);
      const embed = new EmbedBuilder()
        .setTitle('🎫 Tickets Distributed!')
        .setDescription(`**${giveaway.name}**\n\n${result.summary}`)
        .setColor(0x00ff88)
        .setFooter({ text: `Total tickets: ${result.totalTickets} | Users: ${result.totalUsers}` })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

      // Announce in giveaway channel
      const channelId = process.env.GIVEAWAY_CHANNEL_ID;
      if (channelId && result.userResults.length > 0) {
        const channel = interaction.guild.channels.cache.get(channelId);
        if (channel) {
          await announceDistribution(channel, giveaway.name, result.userResults);
        }
      }
    } catch (err) {
      console.error('Distribution error:', err);
      await interaction.editReply({ content: `❌ Error distributing tickets: ${err.message}` });
    }
  }

  // --- LIST ---
  else if (sub === 'list') {
    const giveaways = db.getAllGiveaways();
    if (giveaways.length === 0) {
      return interaction.reply({ content: 'No giveaways yet. Create one with `/giveaway create`', ephemeral: true });
    }
    const list = giveaways.map(g =>
      `**#${g.id}** — ${g.name} [${g.status.toUpperCase()}] ${g.winner_username ? `🏆 ${g.winner_username}` : ''}`
    ).join('\n');
    const embed = new EmbedBuilder()
      .setTitle('📋 All Giveaways')
      .setDescription(list)
      .setColor(0x0088cc);
    await interaction.reply({ embeds: [embed] });
  }

  // --- CLOSE ---
  else if (sub === 'close') {
    const giveawayId = interaction.options.getInteger('id');
    const giveaway = db.getGiveaway(giveawayId);

    if (!giveaway) {
      return interaction.reply({ content: '❌ Giveaway not found.', ephemeral: true });
    }

    db.updateGiveawayStatus(giveawayId, 'closed');
    await interaction.reply({
      content: `✅ Giveaway **${giveaway.name}** is now closed. The enter button will no longer work.`,
      ephemeral: false
    });
  }
}

// =====================
// BUTTON CLICK HANDLER
// =====================
async function handleButton(interaction) {
  const customId = interaction.customId;

  // Check if it's an enter giveaway button
  if (!customId.startsWith('enter_giveaway_')) return;

  const giveawayId = parseInt(customId.replace('enter_giveaway_', ''));
  const giveaway = db.getGiveaway(giveawayId);

  // Validate giveaway
  if (!giveaway) {
    return interaction.reply({ content: '❌ This giveaway no longer exists.', ephemeral: true });
  }
  if (giveaway.status !== 'open') {
    return interaction.reply({ content: '🔒 This giveaway is closed. No more entries accepted.', ephemeral: true });
  }

  // Check if user already entered
  const existing = db.getUserTickets(giveawayId, interaction.user.id);
  if (existing.length > 0) {
    const ticketList = existing.map(t => `\`${t.ticket_number}\``).join(', ');
    return interaction.reply({
      content: `✅ You've already entered! You have **${existing.length}** ticket(s): ${ticketList}`,
      ephemeral: true
    });
  }

  // Check their roles
  const member = interaction.member;
  const ticketInfo = calculateTickets(member);

  if (!ticketInfo) {
    return interaction.reply({
      content: '❌ You don\'t have a qualifying role for this giveaway.\nRequired: **Banned Gang**, **Scooter Gang**, **Short Shorts Gang**, or **1% Gang**.',
      ephemeral: true
    });
  }

  // Generate and store tickets
  const ticketNumbers = generateTicketNumbers(ticketInfo.totalTickets);

  for (const num of ticketNumbers) {
    db.addTicket(
      giveawayId,
      interaction.user.id,
      interaction.user.username,
      member.displayName,
      ticketInfo.primaryRole,
      num
    );
  }

  // Reply in channel (ephemeral — only they see it)
  const boosterText = ticketInfo.hasBooster ? ' *(+1 Server Booster bonus!)*' : '';
  await interaction.reply({
    content: `🎫 You're in! **${ticketInfo.totalTickets}** ticket(s) for **${ticketInfo.primaryRole}**${boosterText} — check your DMs!`,
    ephemeral: true
  });

  // DM them their ticket numbers
  try {
    const ticketList = ticketNumbers.map(t => `\`${t}\``).join('\n');
    const dmEmbed = new EmbedBuilder()
      .setTitle('🎫 Your Giveaway Tickets!')
      .setDescription(
        `**${giveaway.name}**\n\n` +
        `You received **${ticketInfo.totalTickets}** ticket(s)!\n` +
        `Role: **${ticketInfo.primaryRole}**` +
        (ticketInfo.hasBooster ? ` + 🚀 Server Booster Bonus!` : '') +
        `\n\nYour ticket number(s):\n${ticketList}`
      )
      .setColor(0x00cccc)
      .setFooter({ text: 'Good luck! 🍀' })
      .setTimestamp();

    await interaction.user.send({ embeds: [dmEmbed] });
  } catch (dmErr) {
    console.log(`Could not DM ${interaction.user.username} — DMs may be disabled`);
    // Follow up so they still get their numbers
    try {
      const ticketList = ticketNumbers.map(t => `\`${t}\``).join(', ');
      await interaction.followUp({
        content: `⚠️ I couldn't DM you! Here are your tickets (only you can see this): ${ticketList}`,
        ephemeral: true
      });
    } catch (e) {
      console.error('Follow-up also failed:', e);
    }
  }

  // Announce in giveaway channel (public — just the count, not the numbers)
  const channelId = process.env.GIVEAWAY_CHANNEL_ID;
  if (channelId) {
    const channel = interaction.guild.channels.cache.get(channelId);
    if (channel) {
      const boosterIcon = ticketInfo.hasBooster ? ' 🚀' : '';
      await channel.send(
        `🎫 **${member.displayName}** entered the giveaway! (${ticketInfo.primaryRole}${boosterIcon}) — **${ticketInfo.totalTickets}** ticket(s)`
      );
    }
  }
}

// =====================
// BULK DISTRIBUTE
// =====================
async function distributeTicketsBulk(giveawayId, guild) {
  await guild.members.fetch();

  const userResults = [];
  let totalTickets = 0;
  let totalUsers = 0;

  for (const [, member] of guild.members.cache) {
    if (member.user.bot) continue;

    const ticketInfo = calculateTickets(member);
    if (!ticketInfo) continue;

    const existing = db.getUserTickets(giveawayId, member.id);
    if (existing.length > 0) continue;

    const ticketNumbers = generateTicketNumbers(ticketInfo.totalTickets);

    for (const num of ticketNumbers) {
      db.addTicket(
        giveawayId,
        member.id,
        member.user.username,
        member.displayName,
        ticketInfo.primaryRole,
        num
      );
    }

    // NO DMs during bulk distribute — users get DM'd when they click the Enter button

    userResults.push({
      username: member.user.username,
      displayName: member.displayName,
      role: ticketInfo.primaryRole,
      ticketCount: ticketInfo.totalTickets,
      hasBooster: ticketInfo.hasBooster
    });

    totalTickets += ticketInfo.totalTickets;
    totalUsers++;
  }

  const summary = `Distributed **${totalTickets}** tickets to **${totalUsers}** members.`;
  return { summary, totalTickets, totalUsers, userResults };
}

// =====================
// CHANNEL ANNOUNCEMENTS
// =====================
async function announceDistribution(channel, giveawayName, userResults) {
  const lines = userResults.map(u => {
    const boosterIcon = u.hasBooster ? ' 🚀' : '';
    return `**${u.displayName}** (${u.role}${boosterIcon}) — 🎫 ×${u.ticketCount}`;
  });

  const chunks = [];
  let current = '';
  for (const line of lines) {
    if ((current + '\n' + line).length > 1900) {
      chunks.push(current);
      current = line;
    } else {
      current += (current ? '\n' : '') + line;
    }
  }
  if (current) chunks.push(current);

  const headerEmbed = new EmbedBuilder()
    .setTitle(`🎉 Tickets Distributed — ${giveawayName}`)
    .setDescription(`${userResults.length} members received tickets!\nTicket numbers have been sent via DM.`)
    .setColor(0xff4444)
    .setTimestamp();

  await channel.send({ embeds: [headerEmbed] });

  for (const chunk of chunks) {
    await channel.send(chunk);
  }
}

function getClient() {
  return client;
}

function isBotReady() {
  return botReady;
}

module.exports = { createBot, getClient, isBotReady };
