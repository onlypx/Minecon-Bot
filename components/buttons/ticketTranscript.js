const { AttachmentBuilder } = require('discord.js');
const { canManageTicket } = require('../../utils/permissions');
const { getGuildSettings } = require('../../utils/panelSettingsStore');
const { getTicketByChannel } = require('../../utils/ticketStore');

async function buildTranscript(channel) {
  const messages = await channel.messages.fetch({ limit: 100 });
  const ordered = Array.from(messages.values()).sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  const lines = ordered.map(message => {
    const date = new Date(message.createdTimestamp).toISOString();
    const author = message.author?.tag || 'Desconhecido';
    const content = message.content || '';
    const attachments = message.attachments?.size
      ? ` [Anexos: ${message.attachments.map(att => att.url).join(', ')}]`
      : '';
    return `[${date}] ${author}: ${content}${attachments}`;
  });

  return Buffer.from(lines.join('\n') || 'Nenhuma mensagem encontrada.', 'utf8');
}

module.exports = {
  customId: 'ticket_transcript',

  async executar(interaction) {
    const ticket = getTicketByChannel(interaction.channelId);
    if (!ticket) {
      await interaction.reply({ content: 'Este canal nao possui um ticket aberto registrado.', ephemeral: true });
      return;
    }

    if (ticket.userId !== interaction.user.id && !canManageTicket(interaction.member)) {
      await interaction.reply({ content: 'Voce nao tem permissao para gerar este transcript.', ephemeral: true });
      return;
    }

    try {
      await interaction.deferReply({ ephemeral: true });
      const buffer = await buildTranscript(interaction.channel);
      const attachment = new AttachmentBuilder(buffer, { name: `transcript-${ticket.id}.txt` });
      await interaction.editReply({ content: `Transcript do ticket #${ticket.id}.`, files: [attachment] });

      const settings = getGuildSettings(interaction.guildId);
      if (settings.transcriptLogChannelId) {
        const logChannel = await interaction.guild.channels.fetch(settings.transcriptLogChannelId).catch(() => null);
        if (logChannel?.isTextBased()) {
          await logChannel.send({
            content: `Transcript do ticket #${ticket.id} gerado por <@${interaction.user.id}>.`,
            files: [new AttachmentBuilder(buffer, { name: `transcript-${ticket.id}.txt` })]
          }).catch(() => null);
        }
      }
    } catch (error) {
      const content = `Nao foi possivel gerar o transcript: ${error.message}`;
      if (interaction.deferred || interaction.replied) await interaction.editReply({ content });
      else await interaction.reply({ content, ephemeral: true });
    }
  }
};
