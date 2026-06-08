const { SlashCommandBuilder } = require('discord.js');
const { buildMainPanel } = require('../components/panels/mainPanel');
const { isGuildManager } = require('../utils/permissions');

module.exports = {
  dados: new SlashCommandBuilder()
    .setName('painel')
    .setDescription('Envia o painel principal do servidor')
    .setDMPermission(false),

  async executar(interaction) {
    if (!interaction.inGuild()) {
      await interaction.reply({ content: 'Este comando só pode ser usado em servidores.', ephemeral: true });
      return;
    }

    if (!isGuildManager(interaction.member)) {
      await interaction.reply({ content: 'Voce precisa de permissao de gerenciamento do servidor.', ephemeral: true });
      return;
    }

    if (!interaction.channel?.isTextBased()) {
      await interaction.reply({ content: 'Nao consegui enviar o painel neste canal.', ephemeral: true });
      return;
    }

    try {
      await interaction.channel.send(buildMainPanel(interaction.guild, interaction.client));
      await interaction.reply({ content: 'Painel principal enviado com sucesso.', ephemeral: true });
    } catch (error) {
      await interaction.reply({ content: `Nao foi possivel enviar o painel: ${error.message}`, ephemeral: true });
    }
  }
};
