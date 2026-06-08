require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  Events,
  ActivityType,
  SlashCommandBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags
} = require('discord.js');
const { MushAPI } = require('../services/api');
const { AsyncQueue, sleep } = require('../utils/asyncQueue');
const {
  formatarStatsBedwars,
  formatarLeaderboard,
  formatarInGame,
  formatarLeaderboardTexto,
  formatarStatsSkyWars,
  formatarStatsGladiator,
  formatarStatsSopa,
  formatarBans,
  formatarInGameSkyWars,
  formatarInGameGladiator,
  formatarInGameSopa,
  formatarInGameBans
} = require('../utils/formatters');
const painelCommand = require('../commands/painel');
const ticketCommand = require('../commands/ticket');
const panelRefreshButton = require('../components/buttons/panelRefresh');
const panelSettingsButton = require('../components/buttons/panelSettings');
const panelBackMainButton = require('../components/buttons/panelBackMain');
const ticketCloseButton = require('../components/buttons/ticketClose');
const ticketClaimButton = require('../components/buttons/ticketClaim');
const ticketTranscriptButton = require('../components/buttons/ticketTranscript');
const ticketSelect = require('../components/selects/ticketSelect');
const panelLogChannelSelect = require('../components/selects/panelLogChannelSelect');
const panelMentionRolesSelect = require('../components/selects/panelMentionRolesSelect');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const api = new MushAPI();

let mcConnected = false;
let mcLastEventTime = 0;
const showKickMessages = String(process.env.DISCORD_SHOW_KICK_MESSAGES || '').trim() === '1';

const outgoingToDiscordQueue = new AsyncQueue();
const discordSendDelayMs = Math.max(0, parseInt(process.env.DISCORD_SEND_DELAY_MS || '2000', 10) || 2000);

const outgoingToMinecraftQueue = new AsyncQueue();
const discordToMinecraftDelayMs = Math.max(0, parseInt(process.env.DISCORD_TO_MC_DELAY_MS || '2000', 10) || 2000);

const pendingRequests = new Map(); // requestId -> { resolve, reject, timeout }

function sendToManager(msg) {
  if (!process.send) return;
  try { process.send(msg); } catch {}
}

function getChannel(id) {
  if (!id) return null;
  return client.channels.cache.get(id) || null;
}

async function getOrFetchChannel(id) {
  if (!id) return null;
  const cached = client.channels.cache.get(id);
  if (cached) return cached;
  try {
    const fetched = await client.channels.fetch(id);
    return fetched || null;
  } catch {
    return null;
  }
}

function enqueueDiscordSend(channelId, payload) {
  if (!channelId) return;
  outgoingToDiscordQueue.enqueue({ channelId, payload });
}

async function discordSendWorker() {
  while (true) {
    await outgoingToDiscordQueue.waitForItem();
    const item = outgoingToDiscordQueue.shift();
    if (!item) continue;

    const channel = await getOrFetchChannel(item.channelId);
    if (!channel) {
      // Canal não disponível (ainda). Reenfileira e tenta mais tarde.
      outgoingToDiscordQueue.enqueue(item);
      await sleep(discordSendDelayMs);
      continue;
    }

    try {
      await channel.send(item.payload);
    } catch {}

    await sleep(discordSendDelayMs);
  }
}

const mentionCache = new Map();
const mentionCacheTtlMs = 5 * 60 * 1000;

function cacheGet(key) {
  const now = Date.now();
  const hit = mentionCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= now) {
    mentionCache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value, ttlMs) {
  mentionCache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

async function cacheGetOrFetch(key, fetchFn) {
  const cached = cacheGet(key);
  if (cached !== null) return cached;
  const fetched = await fetchFn();
  if (fetched !== null) cacheSet(key, fetched, mentionCacheTtlMs);
  return fetched;
}

function sanitizeDiscordText(text) {
  let out = String(text || '');

  out = out.replace(/@everyone/g, 'everyone').replace(/@here/g, 'here');
  out = out.replace(/<a?:([a-zA-Z0-9_]+):\d+>/g, ':$1:');
  out = out.replace(/\|\|/g, '');
  out = out.replace(/[*_~`\\]/g, '');
  out = out.replace(/\s+/g, ' ').trim();

  return out;
}

async function resolveMentionsInText(message, text) {
  const guild = message.guild || null;
  const guildId = guild?.id || 'dm';

  const userIds = new Set();
  const roleIds = new Set();
  const channelIds = new Set();

  for (const match of String(text || '').matchAll(/<@!?(\d+)>/g)) userIds.add(match[1]);
  for (const match of String(text || '').matchAll(/<@&(\d+)>/g)) roleIds.add(match[1]);
  for (const match of String(text || '').matchAll(/<#(\d+)>/g)) channelIds.add(match[1]);

  const resolvedUsers = new Map();
  const resolvedRoles = new Map();
  const resolvedChannels = new Map();

  await Promise.all([
    ...Array.from(userIds).map(async (id) => {
      const name = await cacheGetOrFetch(`user:${guildId}:${id}`, async () => {
        try {
          if (guild) {
            const memberCached = guild.members.cache.get(id);
            if (memberCached) return memberCached.user?.username || null;
            const memberFetched = await guild.members.fetch(id).catch(() => null);
            if (memberFetched) return memberFetched.user?.username || null;
          }

          const userCached = client.users.cache.get(id);
          if (userCached) return userCached.username || null;
          const userFetched = await client.users.fetch(id).catch(() => null);
          return userFetched ? (userFetched.username || null) : null;
        } catch {
          return null;
        }
      });
      if (name) resolvedUsers.set(id, name);
    }),
    ...Array.from(roleIds).map(async (id) => {
      const name = await cacheGetOrFetch(`role:${guildId}:${id}`, async () => {
        try {
          if (!guild) return null;
          const cached = guild.roles.cache.get(id);
          if (cached) return cached.name || null;
          const fetched = await guild.roles.fetch(id).catch(() => null);
          return fetched ? (fetched.name || null) : null;
        } catch {
          return null;
        }
      });
      if (name) resolvedRoles.set(id, name);
    }),
    ...Array.from(channelIds).map(async (id) => {
      const name = await cacheGetOrFetch(`channel:${guildId}:${id}`, async () => {
        try {
          if (guild) {
            const cached = guild.channels.cache.get(id);
            if (cached) return cached.name || null;
            const fetched = await guild.channels.fetch(id).catch(() => null);
            return fetched ? (fetched.name || null) : null;
          }

          const channelCached = client.channels.cache.get(id);
          if (channelCached && 'name' in channelCached) return channelCached.name || null;
          const channelFetched = await client.channels.fetch(id).catch(() => null);
          if (channelFetched && 'name' in channelFetched) return channelFetched.name || null;
          return null;
        } catch {
          return null;
        }
      });
      if (name) resolvedChannels.set(id, name);
    })
  ]);

  let out = String(text || '');
  out = out.replace(/<@!?(\d+)>/g, (_, id) => `@${resolvedUsers.get(id) || 'usuario'}`);
  out = out.replace(/<@&(\d+)>/g, (_, id) => `@${resolvedRoles.get(id) || 'cargo'}`);
  out = out.replace(/<#(\d+)>/g, (_, id) => `#${resolvedChannels.get(id) || 'canal'}`);
  return out;
}

function enqueueMinecraftSend(text) {
  if (!text) return;
  outgoingToMinecraftQueue.enqueue({ text });
}

async function discordToMinecraftSendWorker() {
  while (true) {
    await outgoingToMinecraftQueue.waitForItem();

    while (!mcConnected) {
      await sleep(500);
    }

    const item = outgoingToMinecraftQueue.shift();
    if (!item) continue;

    try {
      sendToManager({ type: 'mc:send', text: item.text });
    } catch {}

    await sleep(discordToMinecraftDelayMs);
  }
}

const comandos = [
  painelCommand.dados,
  ticketCommand.dados,
  new SlashCommandBuilder()
    .setName('bedwars')
    .setDescription('Mostra estatísticas de Bed Wars de um jogador')
    .addStringOption(option =>
      option.setName('jogador')
        .setDescription('Nome do jogador')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('sw')
    .setDescription('Mostra estatísticas de Sky Wars de um jogador')
    .addStringOption(option =>
      option.setName('jogador')
        .setDescription('Nome do jogador')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('glad')
    .setDescription('Mostra estatísticas de Gladiator de um jogador')
    .addStringOption(option =>
      option.setName('jogador')
        .setDescription('Nome do jogador')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('sopa')
    .setDescription('Mostra estatísticas de Sopa de um jogador')
    .addStringOption(option =>
      option.setName('jogador')
        .setDescription('Nome do jogador')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('bans')
    .setDescription('Mostra bans e mutes de um jogador')
    .addStringOption(option =>
      option.setName('jogador')
        .setDescription('Nome do jogador')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('clan-membros')
    .setDescription('Mostra a lista de membros do clã (com paginação)')
];

const slashCommandHandlers = new Map([
  ['painel', painelCommand],
  ['ticket', ticketCommand]
]);

const buttonHandlers = new Map([
  [panelRefreshButton.customId, panelRefreshButton],
  [panelSettingsButton.customId, panelSettingsButton],
  [panelBackMainButton.customId, panelBackMainButton],
  [ticketCloseButton.customId, ticketCloseButton],
  [ticketClaimButton.customId, ticketClaimButton],
  [ticketTranscriptButton.customId, ticketTranscriptButton]
]);

const selectHandlers = new Map([
  [ticketSelect.customId, ticketSelect],
  [panelLogChannelSelect.customId, panelLogChannelSelect],
  [panelMentionRolesSelect.customId, panelMentionRolesSelect]
]);

function newRequestId() {
  try { return crypto.randomUUID(); } catch {}
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

const CLAN_MEMBERS_PAGE_SIZE = Math.max(1, parseInt(process.env.CLAN_MEMBERS_PAGE_SIZE || '12', 10) || 12);
const MC_CLAN_MEMBERS_DISCORD_TIMEOUT_MS = Math.max(1000, parseInt(process.env.MC_CLAN_MEMBERS_DISCORD_TIMEOUT_MS || '20000', 10) || 20000);
const MC_CLAN_MEMBERS_MAX_PAGES = Math.max(1, parseInt(process.env.MC_CLAN_MEMBERS_MAX_PAGES || '10', 10) || 10);
const CLAN_MEMBERS_REFRESH_DELAY_MS = Math.max(0, parseInt(process.env.CLAN_MEMBERS_REFRESH_DELAY_MS || '2500', 10) || 2500);
const CLAN_MEMBERS_PANEL_TTL_MS = Math.max(60000, parseInt(process.env.CLAN_MEMBERS_PANEL_TTL_MS || String(6 * 60 * 60 * 1000), 10) || (6 * 60 * 60 * 1000));

const clanPanels = new Map(); // messageId -> { channelId, messageId, page, members, createdAt, expiresAt, refreshTimer }
let clanMembersRefreshTimer = null;

function buildClanMembersPanel(members, page) {
  const total = members.length;
  const totalPages = Math.max(1, Math.ceil(total / CLAN_MEMBERS_PAGE_SIZE));
  const safeTotalPages = Math.min(totalPages, MC_CLAN_MEMBERS_MAX_PAGES);
  const safePage = clamp(page, 0, safeTotalPages - 1);

  const start = safePage * CLAN_MEMBERS_PAGE_SIZE;
  const end = Math.min(start + CLAN_MEMBERS_PAGE_SIZE, total);
  const slice = members.slice(start, end);

  const header = `**Membros do clã**\nTotal: **${total}** • Página: **${safePage + 1}/${safeTotalPages}**`;
  const lines = slice.length === 0
    ? '_Sem membros para exibir nesta página._'
    : slice.map((m, idx) => {
      const cargo = String(m.cargo || '').trim();
      const nick = String(m.nick || '').trim();
      const prefix = `${start + idx + 1}.`;
      return `${prefix} **${cargo}** ${nick}`;
    }).join('\n');

  const note = totalPages > MC_CLAN_MEMBERS_MAX_PAGES
    ? `\n\n_Exibindo no máximo **${MC_CLAN_MEMBERS_MAX_PAGES}** páginas (config: MC_CLAN_MEMBERS_MAX_PAGES)._`
    : '';

  const prevDisabled = safePage <= 0;
  const nextDisabled = safePage >= safeTotalPages - 1;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('clan_members_prev')
      .setLabel('Anterior')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(prevDisabled),
    new ButtonBuilder()
      .setCustomId('clan_members_next')
      .setLabel('Próxima')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(nextDisabled)
  );

  const container = new ContainerBuilder()
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${header}\n\n${lines}${note}`)
    )
    .addActionRowComponents(row);

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container]
  };
}

function requestClanMembers() {
  if (!mcConnected) return Promise.reject(new Error('Minecraft desconectado'));

  const requestId = newRequestId();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error('Timeout ao buscar membros do clã'));
    }, MC_CLAN_MEMBERS_DISCORD_TIMEOUT_MS);

    pendingRequests.set(requestId, { resolve, reject, timeout });
    sendToManager({ type: 'mc:clanMembers', requestId });
  });
}

async function buscarEJogarStats(jogador) {
  const resultado = await api.buscarStatsBedwars(jogador);
  const embed = formatarStatsBedwars(resultado);

  enqueueDiscordSend(process.env.IN_GAME_CHANNEL_ID, formatarInGame(resultado));

  if (process.env.MC_CHANNEL_ID && mcConnected) {
    sendToManager({ type: 'mc:send', text: formatarInGame(resultado) });
  }

  return embed;
}

async function buscarEJogarLeaderboard() {
  const resultado = await api.buscarLeaderboard();
  const embed = formatarLeaderboard(resultado);

  enqueueDiscordSend(process.env.IN_GAME_CHANNEL_ID, formatarLeaderboardTexto(resultado));

  if (process.env.MC_CHANNEL_ID && mcConnected) {
    sendToManager({ type: 'mc:send', text: formatarLeaderboardTexto(resultado) });
  }

  return embed;
}

async function handleMinecraftCommand(comando, jogador) {
  console.log(`[HANDLER] Recebido: ${comando} - ${jogador}`);
  try {
    let texto = null;

    if (comando === 'bedwars') {
      const resultado = await api.buscarStatsBedwars(jogador);
      texto = formatarInGame(resultado);
    } else if (comando === 'nicked') {
      const verificacao = await api.verificarNicked(jogador);
      texto = verificacao.nicked ? `[NICKED] ${jogador} e nicked` : `[OK] ${jogador} nao e nicked`;
    } else if (comando === 'skywars') {
      const resultado = await api.buscarStatsSkyWars(jogador);
      texto = formatarInGameSkyWars(resultado);
    } else if (comando === 'gladiator') {
      const resultado = await api.buscarStatsGladiator(jogador);
      texto = formatarInGameGladiator(resultado);
    } else if (comando === 'sopa') {
      const resultado = await api.buscarStatsSopa(jogador);
      texto = formatarInGameSopa(resultado);
    } else if (comando === 'bans') {
      const resultado = await api.buscarBans(jogador);
      texto = formatarInGameBans(resultado);
    }

    if (!texto) return;
    console.log(`[HANDLER] Enviando: ${texto}`);
    sendToManager({ type: 'mc:send', text: texto });
    console.log('[HANDLER] Enviado');
  } catch (err) {
    console.log(`[HANDLER] Erro: ${err.message}`);
    sendToManager({ type: 'mc:send', text: `Erro: ${err.message}` });
  }
}

process.on('message', async (msg) => {
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'mc:state') {
    mcConnected = !!msg.connected;
    mcLastEventTime = msg.lastEventTime || mcLastEventTime || 0;
    return;
  }

  if (msg.type === 'mc:connected') {
    mcConnected = true;
    mcLastEventTime = Date.now();
    return;
  }

  if (msg.type === 'mc:disconnected') {
    mcConnected = false;
    return;
  }

  if (msg.type === 'mc:onCommand') {
    await handleMinecraftCommand(msg.comando, msg.jogador);
    return;
  }

  if (msg.type === 'mc:clanEvent') {
    const embed = new EmbedBuilder();
    const mensagem = msg.mensagem || '';
    switch (msg.eventoTipo) {
      case 'entrada_clan':
        embed.setColor(0x00ff00).setTitle('🟢 Novo Membro').setDescription(mensagem).setTimestamp();
        break;
      case 'saida_clan':
        embed.setColor(0xffaa00).setTitle('🔴 Saída do Clan').setDescription(mensagem).setTimestamp();
        break;
      case 'expulso_clan':
        embed.setColor(0xff0000).setTitle('⛔ Expulso do Clan').setDescription(mensagem).setTimestamp();
        break;
      case 'convidado_clan':
        embed.setColor(0x00aaff).setTitle('📩 Convite Enviado').setDescription(mensagem).setTimestamp();
        break;
      default:
        embed.setColor(0xaaaaaa).setDescription(mensagem).setTimestamp();
        break;
    }
    enqueueDiscordSend(process.env.CLAN_LOGS_CHANNEL_ID, { embeds: [embed] });

    if (msg.eventoTipo === 'entrada_clan' || msg.eventoTipo === 'saida_clan' || msg.eventoTipo === 'expulso_clan') {
      // Agenda refresh único (coalescing) para todos os painéis ativos
      if (!clanMembersRefreshTimer) {
        clanMembersRefreshTimer = setTimeout(async () => {
          clanMembersRefreshTimer = null;
          if (clanPanels.size === 0) return;

          let members;
          try {
            members = await requestClanMembers();
          } catch {
            return;
          }

          for (const panel of clanPanels.values()) {
            panel.members = members;
            panel.expiresAt = Date.now() + CLAN_MEMBERS_PANEL_TTL_MS;

            const payload = buildClanMembersPanel(panel.members, panel.page);
            const channel = await getOrFetchChannel(panel.channelId);
            if (!channel || !channel.isTextBased()) continue;
            const message = await channel.messages.fetch(panel.messageId).catch(() => null);
            if (!message) continue;
            await message.edit(payload).catch(() => null);
          }
        }, CLAN_MEMBERS_REFRESH_DELAY_MS);
      }
    }
    return;
  }

  if (msg.type === 'mc:clanChat') {
    enqueueDiscordSend(process.env.IN_GAME_CHANNEL_ID, `[CLAN] ${msg.username}: ${msg.message}`);
    return;
  }

  if (msg.type === 'mc:botMessage') {
    const text = String(msg.message || '');
    // Por padrão, não spammar kicks no Discord (ex: "Você já está conectado no servidor").
    if (!showKickMessages && /^\[KICK\]/i.test(text)) return;
    enqueueDiscordSend(process.env.IN_GAME_CHANNEL_ID, `\`\`\`\n[Bot] ${text}\n\`\`\``);
    return;
  }

  if (msg.type === 'mc:clanMembers:reply') {
    const requestId = msg.requestId;
    const pending = requestId ? pendingRequests.get(requestId) : null;
    if (!pending) return;
    clearTimeout(pending.timeout);
    pendingRequests.delete(requestId);

    if (msg.ok) pending.resolve(Array.isArray(msg.members) ? msg.members : []);
    else pending.reject(new Error(msg.error || 'Falha ao buscar membros do clã'));
    return;
  }
});

client.once(Events.ClientReady, async () => {
  console.log(`🤖 Bot logado como ${client.user.tag}`);

  const guild = client.guilds.cache.get(process.env.GUILD_ID);
  if (guild) {
    await guild.commands.set(comandos);
    console.log('✅ Comandos registrados!');
  }

  if (process.env.MC_EMAIL || process.env.MC_USERNAME) {
    console.log(`[MC] host=${process.env.MC_HOST || 'mushmc.com'} port=${process.env.MC_PORT || '25565'} disableSrv=${process.env.MC_DISABLE_SRV || '0'} targets=${process.env.MC_TARGETS || '(auto)'} targetsOnly=${process.env.MC_TARGETS_ONLY || '0'} fallbacks=${process.env.MC_FALLBACK_HOSTS || '(none)'}`);
    if (String(process.env.MC_SIMPLE || '').trim() === '1') {
      console.log('[MC] Modo simples ativado (MC_SIMPLE=1): conexão direta, sem SRV/fallbacks automáticos.');
    }
    sendToManager({ type: 'mc:connect' });
  }
});

// Previne crash por rejeições não tratadas em eventos async do Discord
client.on('error', (err) => {
  console.error('[Discord] Erro não tratado no client:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Discord] unhandledRejection:', reason?.message || reason);
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.isButton()) {
    const id = interaction.customId;
    const handler = buttonHandlers.get(id);
    if (handler) {
      try {
        await handler.executar(interaction);
      } catch (err) {
        console.error(`[Discord] Erro no botao ${id}:`, err.message);
        const payload = { content: 'Nao foi possivel processar esta acao.', ephemeral: true };
        try {
          if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
          else await interaction.reply(payload);
        } catch {}
      }
      return;
    }

    if (id !== 'clan_members_prev' && id !== 'clan_members_next') return;

    const messageId = interaction.message?.id;
    const channelId = interaction.channelId;
    if (!messageId || !channelId) {
      try { await interaction.deferUpdate(); } catch {}
      return;
    }

    const panel = clanPanels.get(messageId);
    if (!panel) {
      try { await interaction.deferUpdate(); } catch {}
      return;
    }

    const totalPages = Math.max(1, Math.ceil(panel.members.length / CLAN_MEMBERS_PAGE_SIZE));
    const safeTotalPages = Math.min(totalPages, MC_CLAN_MEMBERS_MAX_PAGES);
    const delta = id === 'clan_members_prev' ? -1 : 1;
    panel.page = clamp(panel.page + delta, 0, safeTotalPages - 1);
    panel.expiresAt = Date.now() + CLAN_MEMBERS_PANEL_TTL_MS;

    const payload = buildClanMembersPanel(panel.members, panel.page);
    try {
      await interaction.deferUpdate();
      await interaction.message.edit(payload);
    } catch {}
    return;
  }

  if (interaction.isStringSelectMenu() || interaction.isChannelSelectMenu() || interaction.isRoleSelectMenu()) {
    const handler = selectHandlers.get(interaction.customId);
    if (!handler) return;

    try {
      await handler.executar(interaction);
    } catch (err) {
      console.error(`[Discord] Erro no select ${interaction.customId}:`, err.message);
      const payload = { content: 'Nao foi possivel processar esta selecao.', ephemeral: true };
      try {
        if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
        else await interaction.reply(payload);
      } catch {}
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const { commandName, options } = interaction;

  const slashHandler = slashCommandHandlers.get(commandName);
  if (slashHandler) {
    try {
      await slashHandler.executar(interaction);
    } catch (err) {
      console.error(`[Discord] Erro no comando /${commandName}:`, err.message);
      const payload = { content: 'Nao foi possivel executar este comando.', ephemeral: true };
      try {
        if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
        else await interaction.reply(payload);
      } catch {}
    }
    return;
  }

  // Helper: faz deferReply com proteção contra interação expirada (erro 10062)
  async function safeDefer() {
    try {
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply();
      }
      return true;
    } catch (err) {
      if (err.code === 10062) {
        console.warn(`[Discord] Interação expirada antes do deferReply (${commandName}), ignorando.`);
      } else {
        console.error(`[Discord] Erro no deferReply (${commandName}):`, err.message);
      }
      return false;
    }
  }

  // Helper: faz editReply com proteção
  async function safeEdit(payload) {
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(payload);
      }
    } catch (err) {
      console.error(`[Discord] Erro no editReply (${commandName}):`, err.message);
    }
  }

  if (commandName === 'bedwars') {
    if (!await safeDefer()) return;
    const jogador = options.getString('jogador');
    try {
      const embed = await buscarEJogarStats(jogador);
      await safeEdit({ embeds: [embed] });
    } catch (erro) {
      const embedErro = new EmbedBuilder().setColor(0xff0000).setDescription(`❌ ${erro.message}`);
      await safeEdit({ embeds: [embedErro] });
    }
  }

  if (commandName === 'sw') {
    if (!await safeDefer()) return;
    const jogador = options.getString('jogador');
    try {
      const resultado = await api.buscarStatsSkyWars(jogador);
      const embed = formatarStatsSkyWars(resultado);
      await safeEdit({ embeds: [embed] });
    } catch (erro) {
      const embedErro = new EmbedBuilder().setColor(0xff0000).setDescription(`❌ ${erro.message}`);
      await safeEdit({ embeds: [embedErro] });
    }
  }

  if (commandName === 'glad') {
    if (!await safeDefer()) return;
    const jogador = options.getString('jogador');
    try {
      const resultado = await api.buscarStatsGladiator(jogador);
      const embed = formatarStatsGladiator(resultado);
      await safeEdit({ embeds: [embed] });
    } catch (erro) {
      const embedErro = new EmbedBuilder().setColor(0xff0000).setDescription(`❌ ${erro.message}`);
      await safeEdit({ embeds: [embedErro] });
    }
  }

  if (commandName === 'sopa') {
    if (!await safeDefer()) return;
    const jogador = options.getString('jogador');
    try {
      const resultado = await api.buscarStatsSopa(jogador);
      const embed = formatarStatsSopa(resultado);
      await safeEdit({ embeds: [embed] });
    } catch (erro) {
      const embedErro = new EmbedBuilder().setColor(0xff0000).setDescription(`❌ ${erro.message}`);
      await safeEdit({ embeds: [embedErro] });
    }
  }

  if (commandName === 'bans') {
    if (!await safeDefer()) return;
    const jogador = options.getString('jogador');
    try {
      const resultado = await api.buscarBans(jogador);
      const embed = formatarBans(resultado);
      await safeEdit({ embeds: [embed] });
    } catch (erro) {
      const embedErro = new EmbedBuilder().setColor(0xff0000).setDescription(`❌ ${erro.message}`);
      await safeEdit({ embeds: [embedErro] });
    }
  }

  if (commandName === 'clan-membros') {
    if (!await safeDefer()) return;
    try {
      const members = await requestClanMembers();
      const payload = buildClanMembersPanel(members, 0);
      await safeEdit(payload);

      const reply = await interaction.fetchReply().catch(() => null);
      if (reply && reply.id) {
        clanPanels.set(reply.id, {
          channelId: interaction.channelId,
          messageId: reply.id,
          page: 0,
          members,
          createdAt: Date.now(),
          expiresAt: Date.now() + CLAN_MEMBERS_PANEL_TTL_MS,
          refreshTimer: null
        });
      }
    } catch (err) {
      const embedErro = new EmbedBuilder().setColor(0xff0000).setDescription(`❌ ${err.message}`);
      await safeEdit({ embeds: [embedErro] });
    }
  }
});

// Limpeza periódica de painéis antigos
setInterval(() => {
  const now = Date.now();
  for (const [id, panel] of clanPanels) {
    if (panel.expiresAt && panel.expiresAt <= now) {
      if (panel.refreshTimer) clearTimeout(panel.refreshTimer);
      clanPanels.delete(id);
    }
  }
}, 60000).unref?.();

client.on('messageCreate', async (message) => {
  if (message.channelId !== process.env.IN_GAME_CHANNEL_ID) return;
  if (message.author?.bot) return;
  if (message.webhookId) return;

  const prefix = process.env.PREFIX || '!';
  if (message.content && message.content.startsWith(prefix)) return;

  if (!message.content?.trim()) return;

  try {
    const authorName = message.member?.displayName || message.author?.globalName || message.author?.username || 'Desconhecido';
    let content = await resolveMentionsInText(message, message.content);
    content = sanitizeDiscordText(content);
    if (!content) return;

    const finalText = `[Discord] ${authorName}: ${content}`;
    if (finalText.length > 256) {
      await message.reply({
        content: `❌ Mensagem muito longa para o Minecraft (limite 256). Tamanho atual: ${finalText.length}.`,
        allowedMentions: { repliedUser: false }
      });
      return;
    }

    enqueueMinecraftSend(finalText);
  } catch (err) {
    try {
      await message.reply({
        content: `❌ Não consegui encaminhar sua mensagem para o Minecraft: ${err.message}`,
        allowedMentions: { repliedUser: false }
      });
    } catch {}
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith(process.env.PREFIX || '!')) return;

  const args = message.content.slice((process.env.PREFIX || '!').length).trim().split(' ');
  const comando = args.shift().toLowerCase();

  if (comando === 'bedwars' || comando === 'bw') {
    const jogador = args[0];
    if (!jogador) return message.reply('❌ Uso: `!bedwars <jogador>`');
    const loading = await message.reply('⏳ Buscando dados...');
    try {
      const resultado = await api.buscarStatsBedwars(jogador);
      const texto = formatarInGame(resultado);
      await loading.delete();
      message.reply(texto);
    } catch (erro) {
      await loading.delete();
      message.reply(`❌ ${erro.message}`);
    }
  }

  if (comando === 'ping') {
    const last = mcLastEventTime || 0;
    const seconds = last ? Math.floor((Date.now() - last) / 1000) : null;
    const embed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setDescription(`🏓 Pong!\nDiscord: ✅ Online\nMinecraft: ${mcConnected ? '✅ Conectado' : '❌ Desconectado'}\nÚltima atividade MC: ${seconds === null ? 'N/A' : `${seconds}s atrás`}`);
    message.reply({ embeds: [embed] });
  }

  if (comando === 'status') {
    const embed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle('📊 Status do Bot')
      .addFields(
        { name: 'Discord', value: '✅ Online', inline: true },
        { name: 'Minecraft', value: mcConnected ? '✅ Conectado' : '❌ Desconectado', inline: true },
        { name: 'API', value: '✅ ONLINE', inline: true }
      );
    message.reply({ embeds: [embed] });
  }

  if (comando === 'sw') {
    const jogador = args[0];
    if (!jogador) return message.reply('❌ Uso: `!sw <jogador>`');
    const loading = await message.reply('⏳ Buscando dados...');
    try {
      const resultado = await api.buscarStatsSkyWars(jogador);
      const texto = formatarInGameSkyWars(resultado);
      await loading.delete();
      message.reply(texto);
    } catch (erro) {
      await loading.delete();
      message.reply(`❌ ${erro.message}`);
    }
  }

  if (comando === 'glad') {
    const jogador = args[0];
    if (!jogador) return message.reply('❌ Uso: `!glad <jogador>`');
    const loading = await message.reply('⏳ Buscando dados...');
    try {
      const resultado = await api.buscarStatsGladiator(jogador);
      const texto = formatarInGameGladiator(resultado);
      await loading.delete();
      message.reply(texto);
    } catch (erro) {
      await loading.delete();
      message.reply(`❌ ${erro.message}`);
    }
  }

  if (comando === 'sopa') {
    const jogador = args[0];
    if (!jogador) return message.reply('❌ Uso: `!sopa <jogador>`');
    const loading = await message.reply('⏳ Buscando dados...');
    try {
      const resultado = await api.buscarStatsSopa(jogador);
      const texto = formatarInGameSopa(resultado);
      await loading.delete();
      message.reply(texto);
    } catch (erro) {
      await loading.delete();
      message.reply(`❌ ${erro.message}`);
    }
  }

  if (comando === 'bans') {
    const jogador = args[0];
    if (!jogador) return message.reply('❌ Uso: `!bans <jogador>`');
    const loading = await message.reply('⏳ Buscando dados...');
    try {
      const resultado = await api.buscarBans(jogador);
      const texto = formatarInGameBans(resultado);
      await loading.delete();
      message.reply(texto);
    } catch (erro) {
      await loading.delete();
      message.reply(`❌ ${erro.message}`);
    }
  }

  if (comando === 'reconnect') {
    if (!message.member.permissions.has('Administrator')) return;
    message.reply('🔄 Forçando reconexão do bot Minecraft...');
    sendToManager({ type: 'mc:disconnect' });
    setTimeout(() => sendToManager({ type: 'mc:connect' }), 2000);
  }
});

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('❌ TOKEN não configurado no arquivo .env');
  process.exit(1);
}

// Eventos "visuais" (status/presence) continuam rodando no processo do Discord
const eventsPath = path.join(__dirname, '..', 'events');
if (fs.existsSync(eventsPath)) {
  const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));
  for (const file of eventFiles) {
    const filePath = path.join(eventsPath, file);
    const event = require(filePath);
    if (event.once) client.once(event.name, (...args) => event.execute(...args));
    else client.on(event.name, (...args) => event.execute(...args));
  }
}

process.on('SIGINT', () => {
  console.log('🛑 Encerrando bot...');
  try { client.destroy(); } catch {}
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('🛑 Encerrando bot...');
  try { client.destroy(); } catch {}
  process.exit(0);
});

// Login com retry automático — evita crash por timeout de rede (Connect Timeout Error)
let loginAttempt = 0;
const MAX_LOGIN_ATTEMPTS = 20;
const LOGIN_BASE_DELAY_MS = 5000;

async function loginWithRetry() {
  loginAttempt++;
  try {
    await client.login(token);
    loginAttempt = 0; // resetar em caso de desconexão futura
  } catch (err) {
    const isTimeout = /timeout/i.test(err.message) || /ECONNRESET/i.test(err.message) || /ENOTFOUND/i.test(err.message);
    if (loginAttempt >= MAX_LOGIN_ATTEMPTS) {
      console.error(`❌ [Discord] Login falhou após ${MAX_LOGIN_ATTEMPTS} tentativas. Encerrando worker para reinício pelo manager.`);
      process.exit(1);
      return;
    }
    const delay = Math.min(LOGIN_BASE_DELAY_MS * Math.pow(1.5, loginAttempt - 1), 120000);
    console.warn(`⚠️ [Discord] Login falhou (tentativa ${loginAttempt}/${MAX_LOGIN_ATTEMPTS}): ${err.message}${isTimeout ? ' [timeout de rede]' : ''}. Tentando novamente em ${(delay / 1000).toFixed(1)}s...`);
    setTimeout(loginWithRetry, delay);
  }
}

loginWithRetry();

// Start worker (MC -> Discord)
discordSendWorker();

// Start worker (Discord -> MC)
discordToMinecraftSendWorker();
