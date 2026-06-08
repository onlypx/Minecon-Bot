const { ChannelType, PermissionFlagsBits } = require('discord.js');
const ticketConfig = require('../config/tickets');

function isGuildManager(member) {
  return Boolean(member?.permissions?.has(PermissionFlagsBits.ManageGuild) || member?.permissions?.has(PermissionFlagsBits.Administrator));
}

function canManageTicket(member) {
  const hasStaffRole = ticketConfig.staffRoleId && member?.roles?.cache?.has(ticketConfig.staffRoleId);
  return Boolean(
    hasStaffRole ||
    member?.permissions?.has(PermissionFlagsBits.ManageChannels) ||
    member?.permissions?.has(PermissionFlagsBits.Administrator)
  );
}

function getMissingTicketPermissions(guild, me) {
  const channel = guild?.members?.me || me;
  const permissions = channel?.permissions;
  if (!permissions) return ['Validar permissões do bot'];

  const required = [
    [PermissionFlagsBits.ManageChannels, 'Gerenciar canais'],
    [PermissionFlagsBits.ViewChannel, 'Ver canais'],
    [PermissionFlagsBits.SendMessages, 'Enviar mensagens'],
    [PermissionFlagsBits.ReadMessageHistory, 'Ler histórico de mensagens'],
    [PermissionFlagsBits.AttachFiles, 'Anexar arquivos']
  ];

  return required
    .filter(([flag]) => !permissions.has(flag))
    .map(([, label]) => label);
}

function buildTicketOverwrites(guild, userId, staffRoleId) {
  const overwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel]
    },
    {
      id: userId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles
      ]
    },
    {
      id: guild.client.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.AttachFiles
      ]
    }
  ];

  if (staffRoleId) {
    overwrites.push({
      id: staffRoleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles
      ]
    });
  }

  return overwrites;
}

module.exports = {
  ChannelType,
  buildTicketOverwrites,
  canManageTicket,
  getMissingTicketPermissions,
  isGuildManager
};
