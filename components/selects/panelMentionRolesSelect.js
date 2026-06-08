const { buildSettingsPanel } = require('../buttons/panelSettings');
const { isGuildManager } = require('../../utils/permissions');
const { updateGuildSettings } = require('../../utils/panelSettingsStore');

module.exports = {
  customId: 'panel_ticket_mention_roles_select',

  async executar(interaction) {
    if (!interaction.inGuild()) {
      await interaction.reply({ content: 'Esta configuracao so pode ser usada em servidores.', ephemeral: true });
      return;
    }

    if (!isGuildManager(interaction.member)) {
      await interaction.reply({ content: 'Voce nao tem permissao para alterar as configuracoes.', ephemeral: true });
      return;
    }

    const roleIds = Array.isArray(interaction.values) ? interaction.values.slice(0, 10) : [];
    updateGuildSettings(interaction.guildId, {
      mentionRoleIds: roleIds,
      updatedBy: interaction.user.id
    });

    const notice = roleIds.length
      ? `Cargos que serao marcados salvos: ${roleIds.map(roleId => `<@&${roleId}>`).join(', ')}.`
      : 'Nenhum cargo sera marcado nos tickets.';

    await interaction.update(buildSettingsPanel(interaction.guild, notice));
  }
};
