const { SlashCommandBuilder } = require('discord.js');
const { buildTicketPanel } = require('../components/panels/ticketPanel');
const { isGuildManager } = require('../utils/permissions');

module.exports = {
  dados: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Envia o painel de abertura de tickets')
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
      await interaction.channel.send(buildTicketPanel(interaction.guild));
      await interaction.reply({ content: 'Central de tickets enviada com sucesso.', ephemeral: true });
    } catch (error) {
      await interaction.reply({ content: `Nao foi possivel enviar a central de tickets: ${error.message}`, ephemeral: true });
    }
  }
};
