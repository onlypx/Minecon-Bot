const { ButtonStyle, MessageFlags, SeparatorSpacingSize } = require('discord.js');
const { button, container, row, separator, text } = require('../../utils/visuals');

function buildTicketOpenedPanel(ticket, user, typeConfig) {
  const panel = container()
    .addTextDisplayComponents(text([
      `# ${typeConfig.emojiText || ''} Ticket ${typeConfig.label}`,
      `**Protocolo:** #${ticket.id}`,
      `**Usuario:** <@${user.id}>`,
      '',
      'Descreva sua solicitação com o máximo de contexto. A equipe vai acompanhar por este canal.'
    ].join('\n')))
    .addSeparatorComponents(separator(SeparatorSpacingSize.Large))
    .addTextDisplayComponents(text([
      '**Status:** Aberto',
      '**Responsavel:** Aguardando atendimento',
      '**Transcript:** Disponivel pelos botoes abaixo'
    ].join('\n')))
    .addActionRowComponents(row(
      button('ticket_close', 'Fechar ticket', ButtonStyle.Danger, '🔒'),
      button('ticket_claim', 'Assumir ticket', ButtonStyle.Primary, '✅'),
      button('ticket_transcript', 'Transcript', ButtonStyle.Secondary, '📄')
    ));

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [panel]
  };
}

module.exports = {
  buildTicketOpenedPanel
};
