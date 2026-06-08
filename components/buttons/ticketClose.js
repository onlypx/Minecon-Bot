const { canManageTicket } = require('../../utils/permissions');
const { getTicketByChannel, updateTicket } = require('../../utils/ticketStore');

module.exports = {
  customId: 'ticket_close',

  async executar(interaction) {
    const ticket = getTicketByChannel(interaction.channelId);
    if (!ticket) {
      await interaction.reply({ content: 'Este canal nao possui um ticket aberto registrado.', ephemeral: true });
      return;
    }

    if (ticket.userId !== interaction.user.id && !canManageTicket(interaction.member)) {
      await interaction.reply({ content: 'Voce nao tem permissao para fechar este ticket.', ephemeral: true });
      return;
    }

    updateTicket(ticket.id, {
      status: 'closed',
      closedAt: Date.now(),
      closedBy: interaction.user.id
    });

    await interaction.reply({ content: 'Ticket fechado. Este canal sera removido em 5 segundos.' });
    setTimeout(() => {
      interaction.channel?.delete(`Ticket fechado por ${interaction.user.tag}`).catch(() => null);
    }, 5000);
  }
};
