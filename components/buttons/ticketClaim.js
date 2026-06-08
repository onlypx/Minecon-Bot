const { canManageTicket } = require('../../utils/permissions');
const { getTicketByChannel, updateTicket } = require('../../utils/ticketStore');

module.exports = {
  customId: 'ticket_claim',

  async executar(interaction) {
    const ticket = getTicketByChannel(interaction.channelId);
    if (!ticket) {
      await interaction.reply({ content: 'Este canal nao possui um ticket aberto registrado.', ephemeral: true });
      return;
    }

    if (!canManageTicket(interaction.member)) {
      await interaction.reply({ content: 'Apenas a equipe pode assumir tickets.', ephemeral: true });
      return;
    }

    if (ticket.claimedBy) {
      await interaction.reply({ content: `Este ticket ja foi assumido por <@${ticket.claimedBy}>.`, ephemeral: true });
      return;
    }

    updateTicket(ticket.id, { claimedBy: interaction.user.id });
    await interaction.reply({ content: `Ticket assumido por <@${interaction.user.id}>.` });
  }
};
