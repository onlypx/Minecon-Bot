const axios = require('axios');

class MushAPI {
    constructor() {
        this.baseURL = process.env.MUSH_API_URL || 'https://mush.com.br/api';
        this.cache = new Map();
        this.cacheTTL = (parseInt(process.env.CACHE_TTL) || 60) * 1000;
        this.lastRequest = 0;
        this.rateLimitMs = parseInt(process.env.RATE_LIMIT_MS) || 1000;
    }

    normalizarResponse(data) {
        // A API pode responder HTTP 200 com `success: false` e status dentro de `response`
        if (data && data.success === false) {
            const status = data.response?.status;
            if (status === 404) throw new Error('Jogador não encontrado');
            throw new Error('API retornou erro');
        }

        return data?.response || data;
    }

    acharStatsJogo(stats, chavesPreferidas = [], prefixos = []) {
        if (!stats) return null;

        for (const key of chavesPreferidas) {
            if (stats[key]) return stats[key];
        }

        const keys = Object.keys(stats);
        for (const prefix of prefixos) {
            const foundKey = keys.find(k => k.toLowerCase().startsWith(prefix.toLowerCase()));
            if (foundKey && stats[foundKey]) return stats[foundKey];
        }

        return null;
    }

    extrairStatsDuels(duelsStats, prefix) {
        if (!duelsStats) return null;

        const norm = (key) => `${prefix}_${key}`;
        const wins = duelsStats[norm('wins')];
        const losses = duelsStats[norm('losses')];
        const kills = duelsStats[norm('kills')];
        const deaths = duelsStats[norm('deaths')];

        const temAlgumValor =
            [wins, losses, kills, deaths].some(v => typeof v === 'number') ||
            [wins, losses, kills, deaths].some(v => typeof v === 'string');

        if (!temAlgumValor) return null;

        return {
            wins: wins ?? 0,
            losses: losses ?? 0,
            kills: kills ?? 0,
            deaths: deaths ?? 0
        };
    }

    async esperaRateLimit() {
        const agora = Date.now();
        const tempoDecorrido = agora - this.lastRequest;
        
        if (tempoDecorrido < this.rateLimitMs) {
            await new Promise(resolve => 
                setTimeout(resolve, this.rateLimitMs - tempoDecorrido)
            );
        }
        
        this.lastRequest = Date.now();
    }

    async getCached(endpoint, chaveCache) {
        const cacheKey = `${endpoint}:${chaveCache}`;
        const cached = this.cache.get(cacheKey);
        
        if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
            return cached.data;
        }
        
        await this.esperaRateLimit();
        
        try {
            const response = await axios.get(`${this.baseURL}${endpoint}`, {
                timeout: 10000,
                headers: {
                    'Accept': 'application/json'
                }
            });
            
            const data = response.data;
            this.cache.set(cacheKey, {
                data: data,
                timestamp: Date.now()
            });
            
            return data;
        } catch (error) {
            if (cached && Date.now() - cached.timestamp < this.cacheTTL * 2) {
                return cached.data;
            }
            throw error;
        }
    }

    async buscarPerfilJogador(nomeOuUuid) {
        const data = await this.getCached(`/player/${nomeOuUuid}`, nomeOuUuid);
        return data;
    }

    async buscarStatsBedwars(nome) {
        try {
            console.log(`[API] Buscando: /player/${nome}`);
            const data = await this.getCached(`/player/${nome}`, `player:${nome}`);

            const response = this.normalizarResponse(data);
            
            if (!response || !response.stats || !response.stats.bedwars) {
                throw new Error('Stats de Bed Wars não encontrados');
            }
            
            const bwStats = response.stats.bedwars;
            bwStats.username = response.account?.username || nome;
            bwStats.level = bwStats.level || 1;
            bwStats.fkdr = data.fkdr;
            bwStats.wlr = data.wlr;
            bwStats.firstLogin = response.first_login;
            
            return this.processarStatsBedwars(bwStats, nome);
        } catch (error) {
            console.log(`[API] Erro:`, error.message);
            if (error.message === 'Jogador não encontrado' || error.message === 'Stats de Bed Wars não encontrados') {
                throw error;
            }
            if (error.code === 'ECONNABORTED' || error.code === 'ENOTFOUND') {
                throw new Error('API indisponível no momento');
            }
            throw new Error('Erro ao buscar dados do jogador');
        }
    }

    async verificarNicked(nome) {
        try {
            const data = await this.getCached(`/player/${nome}`, `nick:${nome}`);

            if (data && data.success === false && data.response?.status === 404) {
                return { nicked: true, motivos: ['Jogador não encontrado'] };
            }

            const response = data?.response || data;
            
            if (!response || !response.account) {
                return { nicked: true, motivos: ['Jogador não encontrado'] };
            }
            
            const stats = response.stats?.bedwars;
            
            if (!stats) {
                return { nicked: true, motivos: ['Sem stats de Bed Wars'] };
            }
            
            const { wins, kills, final_kills, games_played, xp, level } = stats;
            
            const motivos = [];
            
            if (wins === 0 && kills === 0 && final_kills === 0 && games_played === 0) {
                motivos.push('Stats zeros');
            }
            
            if (xp < 100 && games_played > 50) {
                motivos.push('XP muito baixo para partidas jogadas');
            }
            
            if (wins > 0 && games_played > 0 && wins > games_played) {
                motivos.push('Wins maior que jogos');
            }
            
            if (level > 20 && wins < 5) {
                motivos.push('Level alto mas wins baixos');
            }
            
            return {
                nicked: motivos.length > 0,
                motivos
            };
        } catch (error) {
            return { nicked: true, motivos: ['Erro ao buscar'] };
        }
    }

    processarStatsBedwars(data, nomeProcurado) {
        const wins = data.wins || 0;
        const losses = data.losses || 0;
        const finalKills = data.final_kills || 0;
        const finalDeaths = data.final_deaths || 0;
        
        const wlr = losses > 0 ? (wins / losses).toFixed(2) : (wins > 0 ? wins.toFixed(2) : '0');
        const fkdr = finalDeaths > 0 ? (finalKills / finalDeaths).toFixed(2) : (finalKills > 0 ? finalKills.toFixed(2) : '0');

        return {
            nome: data.username || nomeProcurado,
            level: data.level || 1,
            wins,
            losses,
            fkdr,
            wlr,
            firstLogin: data.firstLogin || null
        };
    }

    async buscarLeaderboard() {
        const data = await this.getCached('/leaderboard/bedwars', 'leaderboard');
        return data;
    }

    async buscarStatsSkyWars(nome) {
        try {
            console.log(`[API] Buscando SkyWars: /player/${nome}`);
            const data = await this.getCached(`/player/${nome}`, `skywars:${nome}`);
            const response = this.normalizarResponse(data);

            const swStats = this.acharStatsJogo(
                response?.stats,
                ['skywars', 'skywars_r1', 'skywars_r2', 'skywars_r3'],
                ['skywars']
            );

            if (!response || !response.stats || !swStats) {
                throw new Error('Stats de Sky Wars não encontrados');
            }

            swStats.username = response.account?.username || nome;

            return this.processarStatsSkyWars(swStats, nome);
        } catch (error) {
            console.log(`[API] Erro SkyWars:`, error.message);
            if (error.message === 'Jogador não encontrado' || error.message === 'Stats de Sky Wars não encontrados') {
                throw error;
            }
            if (error.code === 'ECONNABORTED' || error.code === 'ENOTFOUND') {
                throw new Error('API indisponível no momento');
            }
            throw new Error('Erro ao buscar dados do jogador');
        }
    }

    async buscarStatsGladiator(nome) {
        try {
            console.log(`[API] Buscando Gladiator: /player/${nome}`);
            const data = await this.getCached(`/player/${nome}`, `gladiator:${nome}`);
            const response = this.normalizarResponse(data);

            const gladStats = this.acharStatsJogo(
                response?.stats,
                ['gladiator', 'gladiator_r1', 'gladiator_r2', 'gladiator_r3'],
                ['gladiator']
            );

            const gladStatsDuels = this.extrairStatsDuels(response?.stats?.duels, 'gladiator');
            const statsFinal = gladStats || gladStatsDuels;

            if (!response || !response.stats || !statsFinal) {
                throw new Error('Stats de Gladiator não encontrados');
            }

            statsFinal.username = response.account?.username || nome;

            return this.processarStatsGladiator(statsFinal, nome);
        } catch (error) {
            console.log(`[API] Erro Gladiator:`, error.message);
            if (error.message === 'Jogador não encontrado' || error.message === 'Stats de Gladiator não encontrados') {
                throw error;
            }
            if (error.code === 'ECONNABORTED' || error.code === 'ENOTFOUND') {
                throw new Error('API indisponível no momento');
            }
            throw new Error('Erro ao buscar dados do jogador');
        }
    }

    async buscarStatsSopa(nome) {
        try {
            console.log(`[API] Buscando Sopa: /player/${nome}`);
            const data = await this.getCached(`/player/${nome}`, `sopa:${nome}`);
            const response = this.normalizarResponse(data);

            const sopaStats = this.acharStatsJogo(
                response?.stats,
                ['soup', 'sopa', 'soup_r1', 'soup_r2', 'soup_r3', 'soup_pvp', 'soup_pvp_r1'],
                ['soup', 'sopa']
            );

            const sopaStatsDuels = this.extrairStatsDuels(response?.stats?.duels, 'soup');
            const statsFinal = sopaStats || sopaStatsDuels;

            if (!response || !response.stats || !statsFinal) {
                throw new Error('Stats de Sopa não encontrados');
            }

            statsFinal.username = response.account?.username || nome;

            return this.processarStatsSopa(statsFinal, nome);
        } catch (error) {
            console.log(`[API] Erro Sopa:`, error.message);
            if (error.message === 'Jogador não encontrado' || error.message === 'Stats de Sopa não encontrados') {
                throw error;
            }
            if (error.code === 'ECONNABORTED' || error.code === 'ENOTFOUND') {
                throw new Error('API indisponível no momento');
            }
            throw new Error('Erro ao buscar dados do jogador');
        }
    }

    async buscarBans(nome) {
        // Mantém o nome do método por compatibilidade com o bot,
        // mas agora retorna bans + mutes com base no endpoint público `/punishments`.
        return this.buscarPunicoesJogador(nome);
    }

    async buscarPunicoesJogador(nome, opts = {}) {
        const timerange = (opts.timerange || 'month').toLowerCase();
        const viponly = opts.viponly === true ? 'true' : 'false';

        try {
            // Resolve o username real da conta (corrige variações de case/apelidos)
            const perfilData = await this.getCached(`/player/${nome}`, `profile:${nome}`);
            const perfil = this.normalizarResponse(perfilData);
            const username = perfil?.account?.username || nome;
            const banned = perfil?.banned === true;
            const muted = perfil?.muted === true;
            const banBlacklistCount = typeof perfil?.ban_blacklist_count === 'number' ? perfil.ban_blacklist_count : null;
            const muteBlacklistCount = typeof perfil?.mute_blacklist_count === 'number' ? perfil.mute_blacklist_count : null;

            console.log(`[API] Buscando punições: /punishments?timerange=${timerange}&punishtype=all&viponly=${viponly}`);
            const punicoesData = await this.getCached(
                `/punishments?timerange=${encodeURIComponent(timerange)}&punishtype=all&viponly=${viponly}`,
                `punishments:${timerange}:${viponly}`
            );

            const entries = Array.isArray(punicoesData?.entries) ? punicoesData.entries : [];
            const userEntries = entries.filter(e => {
                const u = e?.account?.username;
                if (!u) return false;
                return String(u).toLowerCase() === String(username).toLowerCase();
            });

            const bans = userEntries.filter(e => String(e?.type || '').toLowerCase() === 'ban');
            const mutes = userEntries.filter(e => String(e?.type || '').toLowerCase() === 'mute');

            const bansAtivos = bans.filter(e => e?.active === true);
            const mutesAtivos = mutes.filter(e => e?.active === true);

            const ordenarTempoDesc = (a, b) => (b?.time || 0) - (a?.time || 0);
            bans.sort(ordenarTempoDesc);
            mutes.sort(ordenarTempoDesc);

            return {
                nome: username,
                timerange,
                // Totais: a API do player expõe contadores independentes do timerange.
                // Quando indisponíveis, cai para o que encontramos no timerange atual.
                bans: banBlacklistCount ?? bans.length,
                mutes: muteBlacklistCount ?? mutes.length,
                bansAtivos: bansAtivos.length,
                mutesAtivos: mutesAtivos.length,
                banned,
                muted,
                bansRecentes: bans.length,
                mutesRecentes: mutes.length,
                listaBans: bans,
                listaMutes: mutes
            };
        } catch (error) {
            console.log(`[API] Erro Punições:`, error.message);
            if (error.message === 'Jogador não encontrado') {
                throw error;
            }
            if (error.code === 'ECONNABORTED' || error.code === 'ENOTFOUND') {
                throw new Error('API indisponível no momento');
            }
            throw new Error('Erro ao buscar punições do jogador');
        }
    }

    processarStatsSkyWars(data, nomeProcurado) {
        const wins = data.wins || 0;
        const losses = data.losses || 0;
        const kills = data.kills || 0;
        const deaths = data.deaths || 0;

        const wlr = losses > 0 ? (wins / losses).toFixed(2) : (wins > 0 ? wins.toFixed(2) : '0');
        const kdr = deaths > 0 ? (kills / deaths).toFixed(2) : (kills > 0 ? kills.toFixed(2) : '0');

        return {
            nome: data.username || nomeProcurado,
            wins,
            losses,
            kills,
            deaths,
            kdr,
            wlr
        };
    }

    processarStatsGladiator(data, nomeProcurado) {
        const wins = data.wins || 0;
        const losses = data.losses || 0;
        const kills = data.kills || 0;
        const deaths = data.deaths || 0;

        const wlr = losses > 0 ? (wins / losses).toFixed(2) : (wins > 0 ? wins.toFixed(2) : '0');
        const kdr = deaths > 0 ? (kills / deaths).toFixed(2) : (kills > 0 ? kills.toFixed(2) : '0');

        return {
            nome: data.username || nomeProcurado,
            wins,
            losses,
            kills,
            deaths,
            kdr,
            wlr
        };
    }

    processarStatsSopa(data, nomeProcurado) {
        const wins = data.wins || 0;
        const losses = data.losses || 0;
        const kills = data.kills || 0;
        const deaths = data.deaths || 0;

        const wlr = losses > 0 ? (wins / losses).toFixed(2) : (wins > 0 ? wins.toFixed(2) : '0');
        const kdr = deaths > 0 ? (kills / deaths).toFixed(2) : (kills > 0 ? kills.toFixed(2) : '0');

        return {
            nome: data.username || nomeProcurado,
            wins,
            losses,
            kills,
            deaths,
            kdr,
            wlr
        };
    }

    limparCache() {
        const agora = Date.now();
        for (const [key, value] of this.cache) {
            if (agora - value.timestamp > this.cacheTTL) {
                this.cache.delete(key);
            }
        }
    }
}

module.exports = { MushAPI };
