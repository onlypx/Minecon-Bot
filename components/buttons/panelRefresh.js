const { buildMainPanel } = require('../panels/mainPanel');
const { isGuildManager } = require('../../utils/permissions');

module.exports = {
  customId: 'panel_refresh',

  async executar(interaction) {
    if (!isGuildManager(interaction.member)) {
      await interaction.reply({ content: 'Voce nao tem permissao para atualizar este painel.', ephemeral: true });
      return;
    }

    try {
      await interaction.update(buildMainPanel(interaction.guild, interaction.client));
    } catch (error) {
      await interaction.reply({ content: `Nao foi possivel atualizar o painel: ${error.message}`, ephemeral: true });
    }
  }
};
