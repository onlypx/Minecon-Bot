const path = require('path');
const {
  AttachmentBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SeparatorSpacingSize,
  StringSelectMenuBuilder
} = require('discord.js');
const ticketConfig = require('../../config/tickets');
const { container, row, separator, text } = require('../../utils/visuals');

const bannerFileName = 'suporte_minecon.png';
const bannerPath = path.join(__dirname, '..', '..', 'fotos', bannerFileName);

function buildTicketPanel(guild) {
  const select = new StringSelectMenuBuilder()
    .setCustomId('ticket_open_select')
    .setPlaceholder('Selecione o tipo de atendimento')
    .addOptions(
      Object.entries(ticketConfig.ticketTypes).map(([value, item]) => ({
        label: item.label,
        value,
        description: item.description,
        emoji: item.emoji
      }))
    );

  const panel = container()
    .addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder()
          .setURL(`attachment://${bannerFileName}`)
          .setDescription('Central de Tickets Minecon')
      )
    )
    .addTextDisplayComponents(text([
      '# Central de Tickets',
      `**${guild?.name || 'Atendimento'}**`,
      '',
      'Escolha uma categoria abaixo para iniciar um atendimento privado com a equipe.'
    ].join('\n')))
    .addSeparatorComponents(separator(SeparatorSpacingSize.Large))
    .addTextDisplayComponents(text('**Categorias disponiveis**\nParceria e recrutamento possuem canais privados e acompanhamento individual.'))
    .addActionRowComponents(row(select));

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [panel],
    files: [
      new AttachmentBuilder(bannerPath, { name: bannerFileName })
    ]
  };
}

module.exports = {
  buildTicketPanel
};
