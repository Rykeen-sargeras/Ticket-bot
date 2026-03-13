const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
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

  client.on('interactionCreate', handleInteraction);

  return client;
}

async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('giveaway')
      .setDescription('Manage giveaways')
      .addSubcommand(sub =>
        sub.setName('create')
          .setDescription('Create a new giveaway')
          .addStringOption(opt => opt.setName('name').setDescription('Giveaway name').setRequired(true))
      )
      .addSubcommand(sub =>
        sub.setName('distribute')
          .setDescription('Distribute tickets for active giveaway')
          .addIntegerOption(opt => opt.setName('id').setDescription('Giveaway ID').setRequired(true))
      )
      .addSubcommand(sub =>
        sub.setName('list')
          .setDescription('List all giveaways')
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

async function handleInteraction(interaction) {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'giveaway') {
    const sub = interaction.options.getSubcommand();

    if (sub === 'create') {
      const name = interaction.options.getString('name');
      const giveawayId = db.createGiveaway(name);
      const embed = new EmbedBuilder()
        .setTitle('🎉 New Giveaway Created!')
        .setDescription(`**${name}**\nID: \`${giveawayId}\`\nUse \`/giveaway distribute ${giveawayId}\` to send tickets!`)
        .setColor(0x00cccc)
        .setTimestamp();
      await interaction.reply({ embeds: [embed] });
    }

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
        const result = await distributeTickets(giveawayId, interaction.guild);
        const embed = new EmbedBuilder()
          .setTitle('🎫 Tickets Distributed!')
          .setDescription(`**${giveaway.name}**\n\n${result.summary}`)
          .setColor(0x00ff88)
          .setFooter({ text: `Total tickets: ${result.totalTickets} | Users: ${result.totalUsers}` })
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

        // Announce in giveaway channel
        const channelId = process.env.GIVEAWAY_CHANNEL_ID;
        if (channelId) {
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
  }
}

/**
 * Distribute tickets to all qualifying members
 */
async function distributeTickets(giveawayId, guild) {
  // Fetch all members
  await guild.members.fetch();

  const userResults = [];
  let totalTickets = 0;
  let totalUsers = 0;

  for (const [, member] of guild.members.cache) {
    if (member.user.bot) continue;

    const ticketInfo = calculateTickets(member);
    if (!ticketInfo) continue;

    // Check if user already has tickets for this giveaway
    const existing = db.getUserTickets(giveawayId, member.id);
    if (existing.length > 0) continue;

    const ticketNumbers = generateTicketNumbers(ticketInfo.totalTickets);

    // Store tickets in DB
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

    // DM the user their tickets
    try {
      const ticketList = ticketNumbers.map((t, i) => `\`${t}\``).join('\n');
      const dmEmbed = new EmbedBuilder()
        .setTitle('🎫 Your Giveaway Tickets!')
        .setDescription(
          `You've received **${ticketInfo.totalTickets}** ticket(s)!\n` +
          `Role: **${ticketInfo.primaryRole}**` +
          (ticketInfo.hasBooster ? ` + 🚀 Server Booster Bonus!` : '') +
          `\n\nYour ticket number(s):\n${ticketList}`
        )
        .setColor(0x00cccc)
        .setFooter({ text: 'Good luck! 🍀' })
        .setTimestamp();

      await member.send({ embeds: [dmEmbed] });
    } catch (dmErr) {
      console.log(`Could not DM ${member.user.username} — DMs may be disabled`);
    }

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

/**
 * Announce in the giveaway channel — only shows ticket COUNT, not numbers
 */
async function announceDistribution(channel, giveawayName, userResults) {
  const lines = userResults.map(u => {
    const boosterIcon = u.hasBooster ? ' 🚀' : '';
    return `**${u.displayName}** (${u.role}${boosterIcon}) — 🎫 ×${u.ticketCount}`;
  });

  // Split into chunks to avoid message length limits
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
