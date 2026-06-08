/**
 * Comando /bedwars - Busca estatísticas de Bed Wars de um jogador
 * Autor: Bot Mush Bed Wars
 * Descrição: Exibe stats de Bed Wars do jogador solicitado
 */

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { MushAPI } = require('../services/api');
const { formatarStatsBedwars, formatarInGame } = require('../utils/formatters');

module.exports = {
    dados: new SlashCommandBuilder()
        .setName('bedwars')
        .setDescription('Mostra estatísticas de Bed Wars de um jogador')
        .addStringOption(option =>
            option.setName('jogador')
                .setDescription('Nome do jogador')
                .setRequired(true)
        ),

    async executar(interacao, api) {
        await interacao.deferReply();
        
        const jogador = interacao.options.getString('jogador');
        
        try {
            const resultado = await api.buscarStatsBedwars(jogador);
            
            const embed = formatarStatsBedwars(resultado);
            await interacao.editReply({ embeds: [embed] });
            
            if (process.env.IN_GAME_CHANNEL_ID) {
                const { Client, GatewayIntentBits } = require('discord.js');
                const canalInGame = interacao.client.channels.cache.get(process.env.IN_GAME_CHANNEL_ID);
                if (canalInGame) {
                    const msgInGame = formatarInGame(resultado);
                    canalInGame.send(msgInGame);
                }
            }
        } catch (erro) {
            const embedErro = new EmbedBuilder()
                .setColor(0xff0000)
                .setDescription(`❌ ${erro.message}`);
            await interacao.editReply({ embeds: [embedErro] });
        }
    }
};
