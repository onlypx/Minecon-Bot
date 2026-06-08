const {
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  MessageFlags,
  RoleSelectMenuBuilder,
  SeparatorSpacingSize
} = require('discord.js');
const ticketConfig = require('../../config/tickets');
const { button, container, row, separator, text } = require('../../utils/visuals');
const { isGuildManager } = require('../../utils/permissions');
const { getGuildSettings } = require('../../utils/panelSettingsStore');

function buildSettingsPanel(guild, notice) {
  const settings = getGuildSettings(guild.id);
  const staff = ticketConfig.staffRoleId ? `<@&${ticketConfig.staffRoleId}>` : 'Nao configurado';
  const category = ticketConfig.categoryId ? `<#${ticketConfig.categoryId}>` : 'Canal atual';
  const transcripts = settings.transcriptLogChannelId ? `<#${settings.transcriptLogChannelId}>` : 'Somente resposta do botao';
  const mentionRoles = settings.mentionRoleIds.length
    ? settings.mentionRoleIds.map(roleId => `<@&${roleId}>`).join(', ')
    : 'Nenhum cargo selecionado';
  const status = notice ? `\n\n**Status:** ${notice}` : '';

  const logChannelSelect = new ChannelSelectMenuBuilder()
    .setCustomId('panel_log_channel_select')
    .setPlaceholder('Selecione o canal de logs')
    .setMinValues(1)
    .setMaxValues(1)
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);

  const mentionRoleSelect = new RoleSelectMenuBuilder()
    .setCustomId('panel_ticket_mention_roles_select')
    .setPlaceholder('Selecione os cargos marcados nos tickets')
    .setMinValues(0)
    .setMaxValues(10);

  const panel = container()
    .addTextDisplayComponents(text([
      '# Configuracoes do Painel',
      `**Servidor:** ${guild?.name || 'Servidor'}`,
      '',
      'Escolha abaixo o canal onde os logs e transcripts serao enviados.'
    ].join('\n')))
    .addSeparatorComponents(separator(SeparatorSpacingSize.Large))
    .addTextDisplayComponents(text([
      `**Equipe:** ${staff}`,
      `**Categoria de tickets:** ${category}`,
      `**Canal de logs:** ${transcripts}`,
      `**Cargos marcados:** ${mentionRoles}${status}`
    ].join('\n')))
    .addActionRowComponents(row(logChannelSelect))
    .addActionRowComponents(row(mentionRoleSelect));

  if (notice) {
    panel.addActionRowComponents(row(
      button('panel_back_main', 'Voltar ao painel', ButtonStyle.Secondary, '↩️')
    ));
  }

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [panel],
    ephemeral: true
  };
}

module.exports = {
  customId: 'panel_settings',
  buildSettingsPanel,

  async executar(interaction) {
    if (!isGuildManager(interaction.member)) {
      await interaction.reply({ content: 'Voce nao tem permissao para abrir as configuracoes.', ephemeral: true });
      return;
    }

    await interaction.reply(buildSettingsPanel(interaction.guild));
  }
};
