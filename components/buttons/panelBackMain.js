const { buildMainPanel } = require('../panels/mainPanel');
const { isGuildManager } = require('../../utils/permissions');

module.exports = {
  customId: 'panel_back_main',

  async executar(interaction) {
    if (!isGuildManager(interaction.member)) {
      await interaction.reply({ content: 'Voce nao tem permissao para voltar ao painel.', ephemeral: true });
      return;
    }

    await interaction.update({
      ...buildMainPanel(interaction.guild, interaction.client),
      ephemeral: true
    });
  }
};
