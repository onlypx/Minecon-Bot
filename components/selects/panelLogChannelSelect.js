const { buildSettingsPanel } = require('../buttons/panelSettings');
const { isGuildManager } = require('../../utils/permissions');
const { updateGuildSettings } = require('../../utils/panelSettingsStore');

module.exports = {
  customId: 'panel_log_channel_select',

  async executar(interaction) {
    if (!interaction.inGuild()) {
      await interaction.reply({ content: 'Esta configuracao so pode ser usada em servidores.', ephemeral: true });
      return;
    }

    if (!isGuildManager(interaction.member)) {
      await interaction.reply({ content: 'Voce nao tem permissao para alterar as configuracoes.', ephemeral: true });
      return;
    }

    const channelId = interaction.values?.[0];
    const channel = channelId ? await interaction.guild.channels.fetch(channelId).catch(() => null) : null;
    if (!channel?.isTextBased()) {
      await interaction.reply({ content: 'Selecione um canal de texto valido.', ephemeral: true });
      return;
    }

    updateGuildSettings(interaction.guildId, {
      transcriptLogChannelId: channel.id,
      updatedBy: interaction.user.id
    });

    await interaction.update(buildSettingsPanel(interaction.guild, `Canal de logs salvo em <#${channel.id}>.`));
  }
};
