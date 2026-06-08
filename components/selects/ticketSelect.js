const { ChannelType } = require('discord.js');
const ticketConfig = require('../../config/tickets');
const { buildTicketOpenedPanel } = require('../panels/ticketOpenedPanel');
const { sanitizeChannelPart } = require('../../utils/format');
const { getGuildSettings } = require('../../utils/panelSettingsStore');
const { buildTicketOverwrites, getMissingTicketPermissions } = require('../../utils/permissions');
const { createTicket, getOpenTicketByUser, updateTicket } = require('../../utils/ticketStore');

module.exports = {
  customId: 'ticket_open_select',

  async executar(interaction) {
    if (!interaction.inGuild()) {
      await interaction.reply({ content: 'Tickets só podem ser abertos em servidores.', ephemeral: true });
      return;
    }

    const type = interaction.values?.[0];
    const typeConfig = ticketConfig.ticketTypes[type];
    if (!typeConfig) {
      await interaction.reply({ content: 'Categoria de ticket invalida.', ephemeral: true });
      return;
    }

    const existing = getOpenTicketByUser(interaction.guildId, interaction.user.id);
    if (existing) {
      const channel = await interaction.guild.channels.fetch(existing.channelId).catch(() => null);
      if (channel) {
        await interaction.reply({ content: `Voce ja possui um ticket aberto: <#${existing.channelId}>`, ephemeral: true });
        return;
      }
      updateTicket(existing.id, { status: 'closed', closedAt: Date.now(), closeReason: 'Canal nao encontrado' });
    }

    const missing = getMissingTicketPermissions(interaction.guild);
    if (missing.length) {
      await interaction.reply({
        content: `Nao consigo criar tickets. Permissoes faltando: ${missing.join(', ')}.`,
        ephemeral: true
      });
      return;
    }

    const parent = ticketConfig.categoryId
      ? await interaction.guild.channels.fetch(ticketConfig.categoryId).catch(() => null)
      : null;
    const parentId = parent && parent.type === ChannelType.GuildCategory ? parent.id : undefined;
    const safeName = sanitizeChannelPart(interaction.member?.displayName || interaction.user.username);
    const channelName = `${typeConfig.channelPrefix}-${safeName}`;

    try {
      const channel = await interaction.guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: parentId,
        topic: `Ticket ${typeConfig.label} de ${interaction.user.tag} (${interaction.user.id})`,
        permissionOverwrites: buildTicketOverwrites(interaction.guild, interaction.user.id, ticketConfig.staffRoleId)
      });

      const ticket = createTicket({
        guildId: interaction.guildId,
        channelId: channel.id,
        userId: interaction.user.id,
        type,
        typeLabel: typeConfig.label
      });

      const settings = getGuildSettings(interaction.guildId);
      const mentionRoleIds = settings.mentionRoleIds.filter(roleId => interaction.guild.roles.cache.has(roleId));
      if (mentionRoleIds.length) {
        await channel.send({
          content: mentionRoleIds.map(roleId => `<@&${roleId}>`).join(' '),
          allowedMentions: { roles: mentionRoleIds }
        }).catch(() => null);
      }

      await channel.send(buildTicketOpenedPanel(ticket, interaction.user, typeConfig));
      await interaction.reply({ content: `Ticket criado com sucesso: <#${channel.id}>`, ephemeral: true });
    } catch (error) {
      await interaction.reply({ content: `Nao foi possivel criar o ticket: ${error.message}`, ephemeral: true });
    }
  }
};
