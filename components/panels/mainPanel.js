const { ButtonStyle, MessageFlags, SeparatorSpacingSize } = require('discord.js');
const { countOpenTickets } = require('../../utils/ticketStore');
const { button, container, row, separator, text } = require('../../utils/visuals');
const { formatDuration, formatMemory } = require('../../utils/format');

function buildMainPanel(guild, client) {
  const memory = process.memoryUsage();
  const openTickets = guild ? countOpenTickets(guild.id) : 0;

  const panel = container()
    .addTextDisplayComponents(text([
      '# Painel Principal',
      `**${guild?.name || 'Servidor'}**`,
      '',
      '```ansi',
      '\u001b[0;37mSistema operacional e pronto para atendimento.\u001b[0m',
      '```'
    ].join('\n')))
    .addSeparatorComponents(separator(SeparatorSpacingSize.Large))
    .addTextDisplayComponents(text([
      `**Tickets abertos:** ${openTickets}`,
      '**Status do sistema:** Online',
      `**Uptime do bot:** ${formatDuration(client.uptime || 0)}`,
      `**Uso de memoria:** ${formatMemory(memory.rss)}`
    ].join('\n')))
    .addSeparatorComponents(separator(SeparatorSpacingSize.Small))
    .addActionRowComponents(row(
      button('panel_settings', 'Configurações', ButtonStyle.Secondary, '⚙️'),
      button('panel_refresh', 'Atualizar', ButtonStyle.Primary, '🔄')
    ));

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [panel]
  };
}

module.exports = {
  buildMainPanel
};
