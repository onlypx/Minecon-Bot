/**
 * Utilitários para formatar respostas do bot
 * Suporta tanto Discord embeds quanto texto in-game (códigos de cor Minecraft)
 */

const { EmbedBuilder } = require('discord.js');

function formatarTempoConta(timestamp) {
    const firstLogin = Number(timestamp);
    if (!Number.isFinite(firstLogin) || firstLogin <= 0) return 'N/A';

    let diffMs = Date.now() - firstLogin;
    if (diffMs < 0) diffMs = 0;

    const dayMs = 24 * 60 * 60 * 1000;
    const totalDays = Math.floor(diffMs / dayMs);
    const years = Math.floor(totalDays / 365);
    const months = Math.floor((totalDays % 365) / 30);
    const days = totalDays % 30;

    const parts = [];
    if (years > 0) parts.push(`${years}a`);
    if (months > 0) parts.push(`${months}m`);
    if (years === 0 && days > 0) parts.push(`${days}d`);
    if (parts.length === 0) return 'hoje';

    return parts.slice(0, 2).join(' ');
}

/**
 * Formata estatísticas de Bed Wars para embed do Discord
 * @param {Object} dados - Dados processados do jogador
 * @returns {EmbedBuilder} - Embed formatado
 */
function formatarStatsBedwars(dados) {
    const { nome, rank, nicked, motivosNick } = dados;
    const stats = dados.stats || dados;
    
    const embed = new EmbedBuilder();
    
    if (nicked) {
        embed.setColor(0xffcc00)
            .setTitle(`⚠️ Estatísticas de Bed Wars - ${nome}`)
            .setFooter({ text: '⚠️ Jogador possivelmente nicked' });
        
        if (Array.isArray(motivosNick) && motivosNick.length > 0) {
            embed.setDescription(`**Motivos detectados:**\n${motivosNick.map(m => `• ${m}`).join('\n')}`);
        }
    } else {
        embed.setColor(0x00ff00)
            .setTitle(`📊 Estatísticas de Bed Wars - ${nome}`)
            .setFooter({ text: '✅ Jogador verificado' });
    }

    if (rank && rank !== 'Nenhum') {
        embed.addFields({
            name: '🏆 Rank',
            value: rank,
            inline: true
        });
    }

    const wlr = stats.wlr || '0';
    const kdr = stats.kdr || '0';

    embed.addFields([
        {
            name: '🎮 Vitórias/Derrotas',
            value: `**Wins:** ${stats.wins || 0}\n**Losses:** ${stats.losses || 0}\n**WLR:** ${wlr}`,
            inline: true
        },
        {
            name: '⚔️ Kills/Deaths',
            value: `**Kills:** ${stats.kills || 0}\n**Deaths:** ${stats.deaths || 0}\n**KDR:** ${kdr}`,
            inline: true
        },
        {
            name: '🛏️ Bed Wars',
            value: `**Camas destruídas:** ${stats.bedsDestroyed || 0}\n**Partidas:** ${stats.gamesPlayed || 0}`,
            inline: true
        }
    ]);

    if (stats.xp > 0) {
        embed.addFields({
            name: '⭐ Nível',
            value: `**XP:** ${stats.xp}`,
            inline: true
        });
    }

    if (stats.firstLogin) {
        embed.addFields({
            name: '⏳ Conta Mush',
            value: formatarTempoConta(stats.firstLogin),
            inline: true
        });
    }

    return embed;
}

/**
 * Formata leaderboard para embed do Discord
 * @param {Array} leaderboard - Array com dados do leaderboard
 * @returns {EmbedBuilder} - Embed formatado
 */
function formatarLeaderboard(leaderboard, textoSimples = false) {
    if (textoSimples) {
        return formatarLeaderboardTexto(leaderboard);
    }

    if (!leaderboard || !Array.isArray(leaderboard) || leaderboard.length === 0) {
        const embed = new EmbedBuilder()
            .setColor(0xff0000)
            .setDescription('❌ Leaderboard indisponível');
        return embed;
    }

    const top10 = leaderboard.slice(0, 10);
    let descricao = '';

    top10.forEach((player, index) => {
        const posicao = index + 1;
        const emoji = posicao === 1 ? '🥇' : posicao === 2 ? '🥈' : posicao === 3 ? '🥉' : `${posicao}.`;
        const nome = player.username || player.name || player.player || 'Unknown';
        const stat = player.wins || player.xp || player.kills || 0;
        
        descricao += `${emoji} **${nome}** - ${stat} wins\n`;
    });

    const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle('🏆 TOP 10 Bed Wars')
        .setDescription(descricao)
        .setFooter({ text: 'Mush.com.br • Bed Wars Leaderboard' });

    return embed;
}

/**
 * Formata leaderboard para texto simples (in-game)
 * @param {Array} leaderboard - Array com dados do leaderboard
 * @returns {string} - Texto formatado
 */
function formatarLeaderboardTexto(leaderboard) {
    if (!leaderboard || !Array.isArray(leaderboard) || leaderboard.length === 0) {
        return 'Leaderboard indisponivel';
    }

    const top10 = leaderboard.slice(0, 10);
    let texto = 'TOP 10 Bed Wars\n';

    top10.forEach((player, index) => {
        const posicao = index + 1;
        const nome = player.username || player.name || player.player || 'Unknown';
        const stat = player.wins || player.xp || player.kills || 0;
        
        texto += `${posicao}. ${nome} - ${stat} wins\n`;
    });

    return texto;
}

function formatarInGame(dados) {
    const { nome, level, fkdr, wlr, firstLogin } = dados;
    
    const lvl = level || 1;
    const finalKdr = fkdr || '0';
    const winLr = wlr || '0';
    const tempoConta = formatarTempoConta(firstLogin);
    const contaParte = tempoConta !== 'N/A' ? ` | Mush ${tempoConta}` : '';
    
    return `${nome} | lvl ${lvl} | FKDR ${finalKdr} | WLR ${winLr}${contaParte}`;
}

function formatarNicked(verificacao, nome) {
    if (verificacao.nicked) {
        return `[NICKED] ${nome}: ${verificacao.motivos.join(', ')}`;
    }
    return `[OK] ${nome} verificado`;
}

/**
 * Formata mensagem de erro para embed do Discord
 * @param {string} mensagem - Mensagem de erro
 * @returns {EmbedBuilder} - Embed de erro
 */
function formatarErro(mensagem) {
    return new EmbedBuilder()
        .setColor(0xff0000)
        .setDescription(`❌ ${mensagem}`);
}

/**
 * Formata mensagem de erro para in-game
 * @param {string} mensagem - Mensagem de erro
 * @returns {string} - Texto formatado
 */
function formatarErroInGame(mensagem) {
    return `§c❌ ${mensagem}`;
}

function formatarStatsSkyWars(dados) {
    const embed = new EmbedBuilder()
        .setColor(0x00aaff)
        .setTitle(`☁️ Estatísticas de Sky Wars - ${dados.nome}`)
        .setFooter({ text: 'Mush.com.br' });

    embed.addFields([
        {
            name: '🏆 Vitórias/Derrotas',
            value: `**Wins:** ${dados.wins}\n**Losses:** ${dados.losses}\n**WLR:** ${dados.wlr}`,
            inline: true
        },
        {
            name: '⚔️ Kills/Deaths',
            value: `**Kills:** ${dados.kills}\n**Deaths:** ${dados.deaths}\n**KDR:** ${dados.kdr}`,
            inline: true
        }
    ]);

    return embed;
}

function formatarStatsGladiator(dados) {
    const embed = new EmbedBuilder()
        .setColor(0xffaa00)
        .setTitle(`⚔️ Estatísticas de Gladiator - ${dados.nome}`)
        .setFooter({ text: 'Mush.com.br' });

    embed.addFields([
        {
            name: '🏆 Vitórias/Derrotas',
            value: `**Wins:** ${dados.wins}\n**Losses:** ${dados.losses}\n**WLR:** ${dados.wlr}`,
            inline: true
        },
        {
            name: '⚔️ Kills/Deaths',
            value: `**Kills:** ${dados.kills}\n**Deaths:** ${dados.deaths}\n**KDR:** ${dados.kdr}`,
            inline: true
        }
    ]);

    return embed;
}

function formatarStatsSopa(dados) {
    const embed = new EmbedBuilder()
        .setColor(0xff6600)
        .setTitle(`🍲 Estatísticas de Sopa - ${dados.nome}`)
        .setFooter({ text: 'Mush.com.br' });

    embed.addFields([
        {
            name: '🏆 Vitórias/Derrotas',
            value: `**Wins:** ${dados.wins}\n**Losses:** ${dados.losses}\n**WLR:** ${dados.wlr}`,
            inline: true
        },
        {
            name: '⚔️ Kills/Deaths',
            value: `**Kills:** ${dados.kills}\n**Deaths:** ${dados.deaths}\n**KDR:** ${dados.kdr}`,
            inline: true
        }
    ]);

    return embed;
}

function formatarBans(dados) {
    const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle(`🚫 Punições - ${dados.nome}`)
        .setFooter({ text: 'Mush.com.br' });

    const timerangeLabel = dados.timerange === 'day' ? 'últimas 24h' : 'último mês';
    const statusParts = [
        dados.banned ? '🚫 BANIDO' : '✅ não banido',
        dados.muted ? '🔇 MUTADO' : '✅ não mutado'
    ].filter(Boolean);

    const formatarLinhaPunicao = (p) => {
        if (!p) return null;
        const ts = typeof p.time === 'number' ? Math.floor(p.time / 1000) : null;
        const when = ts ? `<t:${ts}:d>` : 'data desconhecida';
        const ativo = p.active === true ? '✅ ativa' : '⛔ expirada';
        const motivo = p.reason ? String(p.reason).slice(0, 120) : 'sem motivo';
        return `• ${when} — ${ativo} — ${motivo}`;
    };

    const topBans = Array.isArray(dados.listaBans) ? dados.listaBans.slice(0, 3).map(formatarLinhaPunicao).filter(Boolean) : [];
    const topMutes = Array.isArray(dados.listaMutes) ? dados.listaMutes.slice(0, 3).map(formatarLinhaPunicao).filter(Boolean) : [];

    embed.addFields([
        {
            name: '📅 Período',
            value: timerangeLabel,
            inline: true
        },
        {
            name: '📌 Status',
            value: statusParts.join('\n') || 'N/A',
            inline: true
        },
        {
            name: '🚫 Bans',
            value: `${dados.bans} (ativas: ${dados.bansAtivos})` + (typeof dados.bansRecentes === 'number' ? `\nNo período: ${dados.bansRecentes}` : ''),
            inline: true
        },
        {
            name: '🔇 Mutes',
            value: `${dados.mutes} (ativas: ${dados.mutesAtivos})` + (typeof dados.mutesRecentes === 'number' ? `\nNo período: ${dados.mutesRecentes}` : ''),
            inline: true
        },
        {
            name: '🧾 Últimos bans',
            value: topBans.length ? topBans.join('\n') : 'Nenhum ban no período',
            inline: false
        },
        {
            name: '🧾 Últimos mutes',
            value: topMutes.length ? topMutes.join('\n') : 'Nenhum mute no período',
            inline: false
        }
    ]);

    return embed;
}

function formatarInGameSkyWars(dados) {
    return `${dados.nome} | KDR ${dados.kdr} | WLR ${dados.wlr} | ${dados.wins}W`;
}

function formatarInGameGladiator(dados) {
    return `${dados.nome} | KDR ${dados.kdr} | WLR ${dados.wlr} | ${dados.wins}W`;
}

function formatarInGameSopa(dados) {
    return `${dados.nome} | KDR ${dados.kdr} | WLR ${dados.wlr} | ${dados.wins}W`;
}

function formatarInGameBans(dados) {
    const status = [
        dados.banned ? 'BAN' : null,
        dados.muted ? 'MUTE' : null
    ].filter(Boolean).join('+');
    const statusTxt = status ? ` | ${status}` : '';
    return `${dados.nome} | Bans: ${dados.bans} | Mutes: ${dados.mutes}${statusTxt}`;
}

module.exports = {
    formatarStatsBedwars,
    formatarLeaderboard,
    formatarInGame,
    formatarErro,
    formatarErroInGame,
    formatarLeaderboardTexto,
    formatarStatsSkyWars,
    formatarStatsGladiator,
    formatarStatsSopa,
    formatarBans,
    formatarInGameSkyWars,
    formatarInGameGladiator,
    formatarInGameSopa,
    formatarInGameBans
};
