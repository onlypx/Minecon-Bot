/**
 * Serviço de conexão Minecraft usando Mineflayer
 * Gerencia a conexão do bot com o servidor e chat in-game
 */

const mineflayer = require('mineflayer');
const autoeat = require('mineflayer-auto-eat').loader;
const dns = require('dns');
const net = require('net');
const fs = require('fs');
const path = require('path');
const { ProxyManager, connectViaProxy } = require('../proxyManager');

const originalWarn = console.warn;
console.warn = function(...args) {
    const msg = args.join(' ');
    if (msg.includes('unknown transaction confirmation')) return;
    originalWarn.apply(console, args);
};

class MinecraftBot {
    constructor() {
        this.bot = null;
        this.jogadoresOnline = new Set();
        this.estaAtivo = false;
        this.intervaloAtividade = null;
        this.intervaloKeepAlive = null;
        this.lastActionTime = Date.now();
        this.lastEventTime = Date.now();
        this.lastPacketTime = Date.now();
        this.estaMovendo = false;
        this.posicaoAtual = null;
        const profilesFolder = process.env.MC_PROFILES_FOLDER
            ? String(process.env.MC_PROFILES_FOLDER)
            : path.join(__dirname, '..', 'minecraft-profiles');
        this.config = {
            host: process.env.MC_HOST || 'mushmc.com',
            port: parseInt(process.env.MC_PORT) || 25565,
            username: process.env.MC_EMAIL,
            version: process.env.MC_VERSION || '1.8.9',
            auth: 'microsoft',
            profilesFolder
        };
        this.onClanEvent = null;
        this.onCommand = null;
        this.onClanChat = null;
        this.onBotMessage = null;
        this.onDisconnect = null;
        this.conectando = false;
        this.desconectadoEm = null;
        this._recentClanChat = new Map();
        this._recentCommands = new Map();
        this._suppressDisconnect = false;
        this._lastKickReason = null;
        this._socketClosedCount = 0;
        this._lastSocketClosedTime = 0;
        this._lastHumanBehaviorStartAt = 0;
        this._keepAliveRxCount = 0;
        this._keepAliveTxCount = 0;
        this._lastKeepAliveRxAt = 0;
        this._lastKeepAliveTxAt = 0;
        this._badTargets = new Map(); // key -> { fails, cooldownUntil, lastReason, lastAt }
        this._lastGoodTargetKey = null;

        this.proxyManager = new ProxyManager({
            filePath: process.env.MC_PROXIES_FILE || path.join(__dirname, '..', 'proxies.txt'),
            defaultProtocol: process.env.MC_PROXY_PROTOCOL || 'socks5',
            cooldownMs: parseInt(process.env.MC_PROXY_COOLDOWN_MS || '120000', 10),
            maxFailsBeforeCooldown: parseInt(process.env.MC_PROXY_FAILS_BEFORE_COOLDOWN || '2', 10)
        });
        this._proxiesLoadedAt = 0;
    }

    _flattenChatJson(node) {
        const parts = [];
        const visit = (n) => {
            if (!n) return;
            if (typeof n === 'string') {
                parts.push(n);
                return;
            }
            if (Array.isArray(n)) {
                for (const item of n) visit(item);
                return;
            }
            if (typeof n !== 'object') return;

            if (typeof n.text === 'string') parts.push(n.text);
            if (n.extra) visit(n.extra);
            if (n.with) visit(n.with);
        };
        visit(node);
        return parts.join('');
    }

    _targetKey(host, port) {
        return `${host}:${port}`;
    }

    _getBadTargetConfig() {
        const cooldownMs = parseInt(process.env.MC_BAD_TARGET_COOLDOWN_MS || '600000', 10);
        const failsBeforeCooldown = parseInt(process.env.MC_BAD_TARGET_FAILS_BEFORE_COOLDOWN || '2', 10);
        return {
            cooldownMs: Number.isFinite(cooldownMs) ? cooldownMs : 600000,
            failsBeforeCooldown: Number.isFinite(failsBeforeCooldown) ? failsBeforeCooldown : 2
        };
    }

    _markTargetGood(host, port) {
        const key = this._targetKey(host, port);
        this._lastGoodTargetKey = key;
        this._badTargets.delete(key);
    }

    _markTargetBad(host, port, reason) {
        const key = this._targetKey(host, port);
        const now = Date.now();
        const cfg = this._getBadTargetConfig();
        const prev = this._badTargets.get(key) || { fails: 0, cooldownUntil: 0, lastReason: null, lastAt: 0 };
        const fails = (prev.fails || 0) + 1;
        const cooldownUntil = fails >= cfg.failsBeforeCooldown ? (now + cfg.cooldownMs) : prev.cooldownUntil;
        this._badTargets.set(key, { fails, cooldownUntil, lastReason: String(reason || ''), lastAt: now });
    }

    _shouldSkipTarget(host, port) {
        const key = this._targetKey(host, port);
        const entry = this._badTargets.get(key);
        if (!entry) return false;
        const now = Date.now();
        if (entry.cooldownUntil && entry.cooldownUntil > now) return true;
        if (entry.cooldownUntil && entry.cooldownUntil <= now) this._badTargets.delete(key);
        return false;
    }

    isSimpleMode() {
        return String(process.env.MC_SIMPLE || '').trim() === '1';
    }

    isDebugEnabled() {
        return String(process.env.MC_DEBUG || '').trim() === '1';
    }

    getChatLengthLimit() {
        const raw = process.env.MC_CHAT_MAX_LEN;
        const configured = raw !== undefined && raw !== null ? parseInt(String(raw), 10) : NaN;
        if (Number.isFinite(configured) && configured >= 0) return configured;

        const version = String(this.config && this.config.version ? this.config.version : process.env.MC_VERSION || '').trim();
        if (version.startsWith('1.8')) return 100;
        return 256;
    }

    _installClientDiagnostics(bot) {
        if (!bot || !bot._client || bot._client.__mineconDiagnosticsInstalled) return;
        const client = bot._client;
        client.__mineconDiagnosticsInstalled = true;

        this._keepAliveRxCount = 0;
        this._keepAliveTxCount = 0;
        this._lastKeepAliveRxAt = 0;
        this._lastKeepAliveTxAt = 0;

        const originalWrite = client.write.bind(client);
        client.write = (name, params) => {
            this.lastActionTime = Date.now();
            if (name === 'keep_alive') {
                this._keepAliveTxCount++;
                this._lastKeepAliveTxAt = Date.now();
                if (this.isDebugEnabled()) console.log(`[MC_KEEPALIVE] tx count=${this._keepAliveTxCount}`);
            }
            return originalWrite(name, params);
        };

        client.on('keep_alive', () => {
            this._keepAliveRxCount++;
            this._lastKeepAliveRxAt = Date.now();
            this.lastPacketTime = Date.now();
            if (this.isDebugEnabled()) console.log(`[MC_KEEPALIVE] rx count=${this._keepAliveRxCount}`);
        });
    }

    getLastNetworkActivityTime() {
        return Math.max(
            this.lastEventTime || 0,
            this.lastPacketTime || 0,
            this.lastActionTime || 0,
            this._lastKeepAliveRxAt || 0,
            this._lastKeepAliveTxAt || 0
        );
    }

    _logDisconnectDiagnostics() {
        const now = Date.now();
        const age = (t) => t ? `${((now - t) / 1000).toFixed(1)}s` : 'nunca';
        console.log(`[MC_DIAG] keepAlive rx=${this._keepAliveRxCount} lastRx=${age(this._lastKeepAliveRxAt)} tx=${this._keepAliveTxCount} lastTx=${age(this._lastKeepAliveTxAt)} lastOutbound=${age(this.lastActionTime)} lastPacket=${age(this.lastPacketTime)}`);
    }

    async tcpProbe(host, port, timeoutMs) {
        return new Promise((resolve) => {
            const socket = new net.Socket();
            let finished = false;

            const done = (ok, err) => {
                if (finished) return;
                finished = true;
                try { socket.destroy(); } catch (e) {}
                resolve({ ok, err });
            };

            socket.setTimeout(timeoutMs);
            socket.once('connect', () => done(true));
            socket.once('timeout', () => done(false, new Error('tcp timeout')));
            socket.once('error', (err) => done(false, err));

            try {
                socket.connect(port, host);
            } catch (err) {
                done(false, err);
            }
        });
    }

    async resolveSrvTargets(host, port) {
        const disableSrv = String(process.env.MC_DISABLE_SRV || '').trim() === '1';
        if (disableSrv) return [{ host, port }];

        const isIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes(':');
        if (isIp) return [{ host, port }];

        try {
            const records = await Promise.race([
                dns.promises.resolveSrv(`_minecraft._tcp.${host}`),
                new Promise((_, reject) => setTimeout(() => reject(new Error('SRV lookup timeout')), 2000))
            ]);

            if (!records || records.length === 0) return [{ host, port }];

            const unique = new Map();
            for (const r of records) {
                const name = String(r.name || '').replace(/\.$/, '');
                const key = `${name}:${r.port}`;
                if (!unique.has(key)) unique.set(key, { host: name, port: r.port });
            }

            // Preferência: porta 25565 primeiro (muitos servidores deixam 25566/25567 indisponíveis/instáveis)
            const list = [...unique.values()];
            list.sort((a, b) => {
                const ap = a.port === 25565 ? 0 : a.port;
                const bp = b.port === 25565 ? 0 : b.port;
                return ap - bp;
            });

            return list;
        } catch {
            return [{ host, port }];
        }
    }

	async getConnectTargets() {
        const host = this.config.host;
        const port = this.config.port;

        const explicitTargets = String(process.env.MC_TARGETS || '').trim();
        const explicitOnly = String(process.env.MC_TARGETS_ONLY || '').trim() === '1';
        let explicitParsed = [];
        if (explicitTargets) {
            explicitParsed = explicitTargets
                .split(',')
                .map(s => s.trim())
                .filter(Boolean)
                .map((entry) => {
                    const [h, p] = entry.split(':').map(x => x.trim());
                    const parsedPort = p ? parseInt(p, 10) : port;
                    return { host: h, port: Number.isFinite(parsedPort) ? parsedPort : port };
                })
                .filter(t => t.host && t.port);

            if (explicitOnly && explicitParsed.length > 0) return explicitParsed;
        }

        // Modo simples: apenas host/porta configurados, sem SRV e sem fallbacks
        if (this.isSimpleMode()) return explicitParsed.length > 0 ? explicitParsed : [{ host, port }];

        const disableSrv = String(process.env.MC_DISABLE_SRV || '').trim() === '1';
        let targets = [];

        // Alvos explícitos (MC_TARGETS) vêm primeiro, mas por padrão não desativam fallbacks.
        // Use MC_TARGETS_ONLY=1 para comportamento estrito.
        if (explicitParsed.length > 0) targets.push(...explicitParsed);

        if (disableSrv) {
            targets.push({ host, port });
        } else {
            const srvTargets = await this.resolveSrvTargets(host, port);
            targets.push(...srvTargets);
            const fallbackKey = `${host}:${port}`;
            const seen = new Set(targets.map(t => `${t.host}:${t.port}`));
            if (!seen.has(fallbackKey)) targets.push({ host, port });
        }

        const fallbackHosts = process.env.MC_FALLBACK_HOSTS;
        if (fallbackHosts) {
            const fallbackList = fallbackHosts.split(',').map(h => h.trim()).filter(Boolean);
            for (const fh of fallbackList) {
                const key = `${fh}:${port}`;
                if (!targets.find(t => `${t.host}:${t.port}` === key)) {
                    targets.push({ host: fh, port });
                }
            }
        }

        const hardcodedFallbacks = [
            { host: 'br1.mushmc.com', port: 25565 },
            { host: '167.114.64.109', port: 25565 },
            { host: '167.114.64.110', port: 25565 }
        ];
         for (const hf of hardcodedFallbacks) {
             const key = `${hf.host}:${hf.port}`;
             if (!targets.find(t => `${t.host}:${t.port}` === key)) {
                 targets.push(hf);
             }
         }

        // Dedupe preservando ordem (evita tentar o mesmo host:porta várias vezes)
        const deduped = [];
        const seenKeys = new Set();
        for (const t of targets) {
            const key = `${t.host}:${t.port}`;
            if (seenKeys.has(key)) continue;
            seenKeys.add(key);
            deduped.push(t);
        }
        targets = deduped;

         // Remove temporariamente alvos que falharam repetidamente (cooldown).
         const filtered = targets.filter(t => !this._shouldSkipTarget(t.host, t.port));
         const finalTargets = filtered.length > 0 ? filtered : targets;

        // Preferir o último alvo que conectou com sucesso.
        if (this._lastGoodTargetKey) {
            finalTargets.sort((a, b) => {
                const ak = `${a.host}:${a.port}`;
                const bk = `${b.host}:${b.port}`;
                if (ak === this._lastGoodTargetKey) return -1;
                if (bk === this._lastGoodTargetKey) return 1;
                return 0;
            });
        }

        return finalTargets;
    }

async verificarRede() {
        return new Promise((resolve) => {
            const dns = require('dns');
            dns.resolve(this.config.host, (err) => {
                if (err) {
                    console.log('⚠️ Problema de DNS para', this.config.host);
                    resolve(false);
                } else {
                    resolve(true);
                }
            });
        });
    }

    async conectar() {
        if (this.conectando) {
            console.log('⏳ Conexão já em progresso, aguardando...');
            await new Promise(resolve => setTimeout(resolve, 5000));
            return Boolean(this.bot && this.bot.player);
        }

        if (!this.config.username) {
            console.error('❌ Credenciais Minecraft não configuradas');
            return false;
        }

        if (this.bot && this.bot.player) {
            console.log('✅ Bot já está conectado');
            return true;
        }

        const redeOk = await this.verificarRede();
        if (!redeOk) {
            console.log('🌐 Aguardando rede estabilizar...');
            await new Promise(r => setTimeout(r, 10000));
        }

        this.conectando = true;

        if (this.desconectadoEm) {
            const tempoDesdeDesconexao = Date.now() - this.desconectadoEm;
            const tempoMinimoEspera = Math.max(30000, this._socketClosedCount * 5000);
            if (tempoDesdeDesconexao < tempoMinimoEspera) {
                const esperar = tempoMinimoEspera - tempoDesdeDesconexao;
                console.log(`⏳ Aguardando ${(esperar/1000).toFixed(1)}s para reconectar... (socketClosedCount: ${this._socketClosedCount})`);
                await new Promise(resolve => setTimeout(resolve, esperar));
            }
        }

        if (this.bot && this.bot.player) {
            console.log('✅ Bot conectou enquanto esperava');
            this.conectando = false;
            return true;
        }

        try {
            fs.mkdirSync(this.config.profilesFolder, { recursive: true });
        } catch (e) {
            console.warn(`⚠️ Não foi possível criar profilesFolder (${this.config.profilesFolder}): ${e.message}`);
        }

        console.log(`📁 Minecraft profilesFolder: ${this.config.profilesFolder}`);

        const targets = await this.getConnectTargets();
        const connectTimeoutMs = parseInt(process.env.MC_CONNECT_TIMEOUT_MS || '20000');
        const probeTimeoutMs = parseInt(process.env.MC_PROBE_TIMEOUT_MS || '8000');
        const tcpProbeEnabled = String(process.env.MC_TCP_PROBE_ENABLED || '1').trim() !== '0';
        const tcpProbeStrict = String(process.env.MC_TCP_PROBE_STRICT || '0').trim() === '1';
        const proxyEnabledRequested = String(process.env.MC_PROXY_ENABLED || '').trim() === '1';
        const proxyConnectTimeoutMs = parseInt(process.env.MC_PROXY_CONNECT_TIMEOUT_MS || String(connectTimeoutMs), 10);
        const proxyTriesPerTarget = parseInt(process.env.MC_PROXY_TRIES_PER_TARGET || '3', 10);

        let proxyEnabled = proxyEnabledRequested;
        if (proxyEnabledRequested) {
            const now = Date.now();
            if (!this._proxiesLoadedAt || (now - this._proxiesLoadedAt > 60000)) {
                this.proxyManager.reload();
                this._proxiesLoadedAt = now;
            }
            const count = this.proxyManager.getAll().length;
            console.log(`[PROXY] enabled=1 protocol=${this.proxyManager.defaultProtocol} file=${process.env.MC_PROXIES_FILE || 'proxies.txt'} loaded=${count}`);
            if (count === 0) {
                console.log('[PROXY] enabled=1 but no proxies loaded. Falling back to direct connection.');
                proxyEnabled = false;
            }
        }

        if (this.isDebugEnabled()) {
            console.log(`[MC_DEBUG] host=${this.config.host} port=${this.config.port} disableSrv=${String(process.env.MC_DISABLE_SRV || '').trim()} targets=${targets.map(t => `${t.host}:${t.port}`).join(',')}`);
        }

        // Durante tentativas de conexão, não dispara onDisconnect (evita loop duplo: watchdog + evento end)
        this._suppressDisconnect = true;
        this._lastKickReason = null;

        let lastErr = null;
        let abortAllTargets = false;
        for (const t of targets) {
            if (abortAllTargets) break;
            const attempts = proxyEnabled ? Math.max(1, proxyTriesPerTarget) : 1;
	            for (let proxyAttempt = 0; proxyAttempt < attempts; proxyAttempt++) {
	                const proxy = proxyEnabled ? this.proxyManager.getRandomProxy() : null;
	                const proxyLabel = proxy ? `${proxy.protocol}://${proxy.username ? `${proxy.username}:***@` : ''}${proxy.host}:${proxy.port}` : 'direct';
	                console.log(`[CONNECT] target=${t.host}:${t.port} via=${proxyLabel} attempt=${proxyAttempt + 1}/${attempts}`);

	                if (tcpProbeEnabled && !proxyEnabled && !this.isSimpleMode()) {
	                    const probe = await this.tcpProbe(t.host, t.port, probeTimeoutMs);
	                    if (!probe.ok) {
	                        const msg = probe.err && probe.err.message ? probe.err.message : String(probe.err || 'tcp probe failed');
	                        this._markTargetBad(t.host, t.port, `tcp_probe_failed:${msg}`);
	                        if (tcpProbeStrict) {
	                            console.log(`[ERROR] TCP probe falhou target=${t.host}:${t.port} (${msg}). Tentando próximo...`);
	                            lastErr = new Error(`TCP probe falhou para ${t.host}:${t.port}: ${msg}`);
	                            continue;
	                        }
                        // Em algumas redes o connect pode demorar mais que o probe (falso negativo).
                        // Se não estiver em modo "strict", tenta conectar mesmo assim e deixa o Mineflayer decidir.
                        console.log(`[WARN] TCP probe falhou target=${t.host}:${t.port} (${msg}), mas tentando conectar mesmo assim (strict=0)...`);
                    }
                }

                if (this.bot) {
                    try { this.bot.end(); } catch(e) {}
                    this.bot = null;
                }

                const bot = mineflayer.createBot({
                    host: t.host,
                    port: t.port,
                    username: this.config.username,
                    auth: this.config.auth,
                    version: this.config.version,
                    chatLengthLimit: this.getChatLengthLimit(),
                    profilesFolder: this.config.profilesFolder,
                    onMsaCode: (data) => {
                    try {
                        const uri = data && data.verification_uri ? data.verification_uri : '(sem uri)';
                        const code = data && data.user_code ? data.user_code : '(sem código)';
                        const expires = data && data.expires_in ? `${data.expires_in}s` : 'desconhecido';
                        console.log(`🔑 Login Microsoft necessário. Acesse ${uri} e use o código ${code} (expira em ${expires}).`);
                    } catch (e) {
                        console.log('🔑 Login Microsoft necessário (device code).');
                    }
                    },
                    hideErrors: true,
                    connectTimeout: connectTimeoutMs,
                    keepAlive: true,
                    keepAliveInterval: 15000,
                    checkTimeoutInterval: 120000,
                    ...(proxy ? {
                        connect: (client) => {
                            (async () => {
                                try {
                                    console.log(`[PROXY] connecting ${t.host}:${t.port} via ${proxy.protocol}://${proxy.host}:${proxy.port}`);
                                    const socket = await connectViaProxy(proxy, t.host, t.port, proxyConnectTimeoutMs);
                                    client.setSocket(socket);
                                    client.emit('connect');
                                } catch (err) {
                                    const msg = err && err.message ? err.message : String(err);
                                    console.log(`[ERROR] proxy connect failed via=${proxyLabel} target=${t.host}:${t.port} err=${msg}`);
                                    try { client.emit('error', err); } catch {}
                                }
                            })();
                        }
                    } : {})
                });

                bot.__proxy = proxy || null;
                this.bot = bot;
                this._installClientDiagnostics(bot);
                if (!this.isSimpleMode()) bot.loadPlugin(autoeat);

            bot.on('error', (err) => {
                console.log('⚠️ Erro de rede:', err.message);
            });

            const onKicked = (reason) => {
                this._lastKickReason = null;
                try {
                    const reasonStr = typeof reason === 'string' ? reason : JSON.stringify(reason);
                    this._lastKickReason = reasonStr;
                    console.log(`⚠️ Bot kickado: ${reasonStr}`);
                    if (this.onBotMessage) this.onBotMessage(`[KICK] ${reasonStr}`);
                } catch(e) {}
                this.desconectadoEm = Date.now();
                this.pararAtividades();
            };

            bot.on('kicked', onKicked);
            bot.on('kick', onKicked);

            bot.on('end', (reason) => {
                const kickInfo = this._lastKickReason ? ` (kicked: ${this._lastKickReason})` : '';
                console.log('⚠️ Bot desconectou:', `${reason}${kickInfo}`);
                this._logDisconnectDiagnostics();
                this.desconectadoEm = Date.now();
                this.estaAtivo = false;
                this.conectando = false;
                this.pararAtividades();
                this.pararKeepAlive();
                if (this.bot === bot) this.bot = null;
                if (!this._suppressDisconnect && this.onDisconnect) {
                    this.onDisconnect(`${reason}${kickInfo}`);
                }
            });

            bot.on('login', () => {
                console.log(`🔐 Bot autenticado: ${bot.username}`);
            });

            bot.on('spawn', () => {
                console.log(`✅ Bot Minecraft entrou no mundo: ${bot.username}`);
                this.estaAtivo = true;
                this.conectando = false;
                this.desconectadoEm = null;
                this.lastEventTime = Date.now();
                this.lastPacketTime = Date.now();
                this.lastActionTime = Date.now();
                this._suppressDisconnect = false;
                this.iniciarKeepAlive();
                const disableHuman = String(process.env.MC_DISABLE_HUMAN || '').trim() === '1';
                if (!disableHuman) this.iniciarComportamentoHumano();
            });

            bot._client.on('packet', () => {
                this.lastPacketTime = Date.now();
                this.lastEventTime = Date.now();
            });

            const disableChat = String(process.env.MC_DISABLE_CHAT_LISTENERS || '').trim() === '1';
            if (!disableChat) {
                bot.on('chat', (username, message) => {
                    if (username === bot.username) return;
                    this.processarChat(username, message);
                });

                bot.on('message', (jsonMsg, position, sender) => {
                    this.lastEventTime = Date.now();
                    this.processarMensagemSistema(jsonMsg, sender);
                });
            }

            bot.on('health', () => {
                if (bot.food && bot.food < 10) {
                    console.log(`🍖 Comida baixa: ${bot.food}`);
                }
            });

	                try {
	                    await new Promise((resolve, reject) => {
	                        const timeout = setTimeout(() => reject(new Error('Timeout ao conectar')), connectTimeoutMs + 5000);
                        bot.once('spawn', () => {
                            clearTimeout(timeout);
                            resolve(true);
                        });
                        bot.once('error', (err) => {
                            clearTimeout(timeout);
                            reject(err);
                        });
	                        bot.once('end', (reason) => {
	                            clearTimeout(timeout);
	                            const reasonStr = String(reason || 'socketClosed');
                                const reasonWithKick = this._lastKickReason ? `${reasonStr} (kicked: ${this._lastKickReason})` : reasonStr;
	                            if (reasonStr.includes('socketClosed') || reasonStr.includes('closed') || reasonStr.includes('Timed out')) {
	                                this._socketClosedCount++;
	                                this._lastSocketClosedTime = Date.now();
	                                console.log(`🔌 socketClosed detectado (${this._socketClosedCount}x)`);
	                            }
	                            this._markTargetBad(t.host, t.port, `end:${reasonWithKick}`);
	                            reject(new Error(reasonWithKick));
	                        });
	                    });

	                    if (proxy) this.proxyManager.markGood(proxy);
	                    this._markTargetGood(t.host, t.port);
	                    this._socketClosedCount = 0;
	                    console.log(`[CONNECT] connected target=${t.host}:${t.port} via=${proxyLabel}`);
	                    return true;
	                } catch (err) {
	                    const errMsg = err && err.message ? err.message : String(err);

                    // Se o servidor informou que a conta ainda está conectada, não adianta insistir.
                    if (this._lastKickReason && /já está conectado no servidor/i.test(this._lastKickReason)) {
                        lastErr = new Error(`já está conectado no servidor: ${this._lastKickReason}`);
                        abortAllTargets = true; // aborta TODOS os targets, não só o proxy-loop
                        break;
                    }

                    if (this._lastKickReason && /reiniciando|reiniciar|restarting|restart/i.test(this._lastKickReason)) {
                        lastErr = new Error(`servidor reiniciando: ${this._lastKickReason}`);
                        abortAllTargets = true;
                        break;
                    }

                    // Classifica erro de proxy/rede para rotacionar proxy automaticamente.
                    const proxyRelated = proxyEnabled && proxy && (
                        /PROXY_/i.test(errMsg) ||
                        /SOCKS/i.test(errMsg) ||
                        /ECONNRESET/i.test(errMsg) ||
                        /ECONNREFUSED/i.test(errMsg) ||
                        /ETIMEDOUT/i.test(errMsg) ||
                        /Timeout/i.test(errMsg)
                    );

	                    if (proxyRelated) {
	                        this.proxyManager.markBad(proxy, errMsg);
	                        console.log(`[RECONNECT] proxy_failed via=${proxyLabel} target=${t.host}:${t.port} err=${errMsg}`);
	                    } else if (errMsg.includes('socketClosed') || errMsg.includes('Timed out') || errMsg.includes('Timeout')) {
	                        this._markTargetBad(t.host, t.port, `connect_failed:${errMsg}`);
	                        console.log(`[RECONNECT] socketClosed target=${t.host}:${t.port} err=${errMsg}`);
	                    } else {
	                        lastErr = err;
	                        console.log(`[ERROR] connect_failed target=${t.host}:${t.port} err=${errMsg}`);
	                    }

                    try { bot.end(); } catch(e) {}
                    this.bot = null;

                    // Pequeno delay entre tentativas para não floodar proxy/host.
                    await new Promise(r => setTimeout(r, 1500 + Math.random() * 1500));
                    continue;
                }
            }
        }

        this._suppressDisconnect = false;
        this.conectando = false;
        if (lastErr) throw lastErr;
        return false;
    }

    processarComando(message) {
        if (!this.onCommand) return;
        const msg = message.trim().toLowerCase();
        const args = msg.split(' ');

        if ((args[0] === '/bw' || args[0] === '!bw' || args[0] === 'bw' || args[0] === '/bedwars' || args[0] === '!bedwars' || args[0] === 'bedwars') && args[1]) {
            if (this.shouldSuppressRecentCommand('bedwars', args.slice(1).join(' '))) return;
            this.onCommand('bedwars', args.slice(1).join(' '));
        } else if ((args[0] === '/nicked' || args[0] === '!nicked' || args[0] === 'nicked') && args[1]) {
            if (this.shouldSuppressRecentCommand('nicked', args.slice(1).join(' '))) return;
            this.onCommand('nicked', args.slice(1).join(' '));
        } else if ((args[0] === '/sw' || args[0] === '!sw' || args[0] === 'sw' || args[0] === '/skywars' || args[0] === '!skywars' || args[0] === 'skywars') && args[1]) {
            if (this.shouldSuppressRecentCommand('skywars', args.slice(1).join(' '))) return;
            this.onCommand('skywars', args.slice(1).join(' '));
        } else if ((args[0] === '/glad' || args[0] === '!glad' || args[0] === 'glad' || args[0] === '/gladiator' || args[0] === '!gladiator' || args[0] === 'gladiator') && args[1]) {
            if (this.shouldSuppressRecentCommand('gladiator', args.slice(1).join(' '))) return;
            this.onCommand('gladiator', args.slice(1).join(' '));
        } else if ((args[0] === '/sopa' || args[0] === '!sopa' || args[0] === 'sopa') && args[1]) {
            if (this.shouldSuppressRecentCommand('sopa', args.slice(1).join(' '))) return;
            this.onCommand('sopa', args.slice(1).join(' '));
        } else if ((args[0] === '/bans' || args[0] === '!bans' || args[0] === 'bans') && args[1]) {
            if (this.shouldSuppressRecentCommand('bans', args.slice(1).join(' '))) return;
            this.onCommand('bans', args.slice(1).join(' '));
        }
    }

    shouldSuppressRecentCommand(comando, jogador) {
        const dedupMs = parseInt(process.env.MC_COMMAND_DEDUP_MS || '2500', 10);
        if (dedupMs <= 0) return false;

        const now = Date.now();
        const key = `${comando}\u0000${String(jogador || '').trim().toLowerCase()}`;
        const last = this._recentCommands.get(key);
        if (last && now - last < dedupMs) return true;

        this._recentCommands.set(key, now);
        for (const [k, t] of this._recentCommands) {
            if (now - t > 30000) this._recentCommands.delete(k);
        }
        return false;
    }

    processarChat(username, message) {
    // Simple mode: only handle clan messages
    if (this.isSimpleMode() && !/\[CLAN\]/i.test(message)) return;

    // Attempt to parse clan chat regardless of onClanChat handler
    const parsed = this.parseClanChat(message);
    if (parsed && this.bot && this.bot.username && parsed.username && parsed.username !== this.bot.username) {
        // Emit event if a handler is registered
        if (this.onClanChat) {
            this.emitClanChat(parsed.username, parsed.message);
        }
        // Process the extracted command/message
        this.processarComando(parsed.message);
        return;
    }

    // Fallback: treat as regular command/message
    this.processarComando(message);
}





    processarMensagemSistema(jsonMsg, sender) {
        let msgStr = '';
        try {
            if (typeof jsonMsg === 'string') msgStr = jsonMsg;
            else if (jsonMsg && typeof jsonMsg.toString === 'function') msgStr = jsonMsg.toString();
            else msgStr = this._flattenChatJson(jsonMsg);
        } catch (e) {
            msgStr = '';
        }

        if (!msgStr) return;

        if (this.isSimpleMode() && !/\[CLAN\]/i.test(msgStr)) return;

        if (this.onClanChat) {
            const clean = msgStr.replace(/§./g, '').trim();
            const parsed = this.parseClanChat(clean);
            if (parsed && parsed.username && parsed.message && this.bot && this.bot.username && parsed.username !== this.bot.username) {
                this.emitClanChat(parsed.username, parsed.message);
                this.processarComando(parsed.message);
                return;
            }
        }

        if (this.onClanEvent) {
            const cleanEvent = msgStr.replace(/§./g, '').trim();
            const eventos = [
                { regex: /(.+) entrou no clan/i, tipo: 'entrada_clan' },
                { regex: /(.+) saiu do clan/i, tipo: 'saida_clan' },
                { regex: /(.+) foi removido do clan/i, tipo: 'expulso_clan' },
                { regex: /(.+) foi convidado para o clan/i, tipo: 'convidado_clan' }
            ];
            for (const evt of eventos) {
                const match = cleanEvent.match(evt.regex);
                if (match) {
                    this.onClanEvent({ tipo: evt.tipo, mensagem: cleanEvent });
                    break;
                }
            }
        }
    }

    _enviarComandoRaw(comando) {
        if (!this.bot || !this.bot._client) return false;
        const cmd = String(comando || '').trim();
        if (!cmd) return false;
        try {
            this.bot._client.write('chat', { message: cmd });
            return true;
        } catch {
            try {
                this.bot.chat(cmd);
                return true;
            } catch {}
        }
        return false;
    }

    _parseMembrosDoClan(lines) {
        const out = [];
        for (const rawLine of lines) {
            const line = String(rawLine || '')
                .replace(/§./g, '')
                .replace(/\s+/g, ' ')
                .trim();

            if (!line) continue;
            if (/^membros de /i.test(line)) continue;
            if (/\bmembers?\b/i.test(line) && /\bmembros?\b/i.test(line)) continue;

            const m = line.match(/^⬤\s*(?<nick>[a-zA-Z0-9_]{3,16}\+?)\s*-\s*(?<cargo>l[ií]der|sub-?l[ií]der|gerente|membro)\s*$/i);
            if (!m) continue;

            let nick = String(m.groups?.nick || '').trim();
            const cargo = String(m.groups?.cargo || '').trim();
            if (!nick || !cargo) continue;

            if (nick.endsWith('+')) nick = nick.slice(0, -1);
            out.push({ nick, cargo });
        }
        return out;
    }

    async buscarMembrosDoClan() {
        if (!this.bot || !this.bot.player) throw new Error('Bot Minecraft desconectado');

        const cmd = String(process.env.MC_CLAN_MEMBERS_CMD || '/clan membros').trim() || '/clan membros';
        const timeoutMs = Math.max(1000, parseInt(process.env.MC_CLAN_MEMBERS_TIMEOUT_MS || '12000', 10) || 12000);
        const debug = String(process.env.MC_CLAN_MEMBERS_DEBUG || '').trim() === '1';

        const captured = [];
        let lastLineAt = 0;
        let sawMemberLine = false;

        const onMessage = (jsonMsg) => {
            const text = this._flattenChatJson(jsonMsg).replace(/§./g, '').trim();
            if (!text) return;
            captured.push(text);
            lastLineAt = Date.now();
            if (/^⬤\s*/.test(text)) sawMemberLine = true;
            if (debug) console.log('[MC_CLAN_MEMBERS] line:', text);
        };

        this.bot.on('message', onMessage);

        try {
            const ok = this._enviarComandoRaw(cmd);
            if (!ok) throw new Error('Falha ao enviar comando para o servidor');

            const startedAt = Date.now();
            while (Date.now() - startedAt < timeoutMs) {
                await new Promise(r => setTimeout(r, 75));

                // heurística: após começar a aparecer lista, para quando "estabilizar"
                if (sawMemberLine && lastLineAt && Date.now() - lastLineAt > 450) break;
            }

            const parsed = this._parseMembrosDoClan(captured);
            if (debug) console.log('[MC_CLAN_MEMBERS] parsed:', parsed);

            if (parsed.length === 0) {
                throw new Error('Não consegui obter a lista de membros do clã (0 linhas parseadas)');
            }

            return parsed;
        } finally {
            try { this.bot.removeListener('message', onMessage); } catch {}
        }
    }

    parseClanChat(line) {
        if (!line) return null;
        const clean = String(line)
            .replace(/§./g, '')     // remove cores Minecraft
            .replace(/\s+/g, ' ')   // normaliza espaços
            .trim();

        if (!/\[CLAN\]/i.test(clean)) return null;

        // Variações comuns (já vi servidores usando ":" e também "»/›")
        const patterns = [
            // [CLAN] [TAG] Usuario: mensagem
            /^\[CLAN\]\s*(?:[^\w\[]+\s*)*(?:\[[^\]]+\]\s*)*(?<username>[a-zA-Z0-9_]{3,16})\s*:\s*(?<message>.+)$/i,
            // [CLAN] [TAG] Usuario » mensagem
            /^\[CLAN\]\s*(?:[^\w\[]+\s*)*(?:\[[^\]]+\]\s*)*(?<username>[a-zA-Z0-9_]{3,16})\s*[»›>\-]\s*(?<message>.+)$/i
        ];

        for (const re of patterns) {
            const m = clean.match(re);
            if (!m) continue;
            const username = m.groups?.username ? String(m.groups.username).trim() : '';
            const message = m.groups?.message ? String(m.groups.message).trim() : '';
            if (!username || !message) continue;
            return { username, message };
        }

        // Fallback: tenta extrair no formato antigo baseado em ":"
        const idx = clean.indexOf(':');
        if (idx === -1) return null;
        const left = clean.slice(0, idx).trim();
        const right = clean.slice(idx + 1).trim();
        if (!right) return null;
        if (!left.toUpperCase().startsWith('[CLAN]')) return null;
        const leftNoClan = left.replace(/^\[CLAN\]\s*/i, '').trim();
        const tokens = leftNoClan.split(/\s+/).filter(Boolean);
        const username = [...tokens].reverse().find(t => /^[a-zA-Z0-9_]{3,16}$/.test(t));
        if (!username) return null;
        return { username, message: right };
    }

    emitClanChat(username, message) {
        if (!this.onClanChat) return;
        const u = String(username || '').trim();
        const m = String(message || '').trim();
        if (!u || !m) return;

        const dedupMs = parseInt(process.env.MC_CLANCHAT_DEDUP_MS || '200', 10);
        if (dedupMs > 0) {
            const key = `${u}\u0000${m}`;
            const now = Date.now();
            const last = this._recentClanChat.get(key);
            if (last && now - last < dedupMs) return;
            this._recentClanChat.set(key, now);

            // Limpeza simples pra não crescer sem limite
            for (const [k, t] of this._recentClanChat) {
                if (now - t > 30000) this._recentClanChat.delete(k);
            }
        }

        this.onClanChat(u, m);
    }

    iniciarComportamentoHumano() {
        const now = Date.now();
        // O evento 'spawn' pode disparar em respawns; evita reiniciar em loop curto.
        if (now - this._lastHumanBehaviorStartAt < 5000) return;
        this._lastHumanBehaviorStartAt = now;

        this.pararAtividades();
        console.log('🎭 Iniciando comportamento humano...');

        // Intervalo customizável para ações principais
        const intervalMin = parseInt(process.env.MC_HUMAN_INTERVAL_MIN || '8000', 10);
        const intervalMax = parseInt(process.env.MC_HUMAN_INTERVAL_MAX || '25000', 10);
        const minVal = Math.min(intervalMin, intervalMax);
        const maxVal = Math.max(intervalMin, intervalMax);
        const delay = () => minVal + Math.random() * (maxVal - minVal);

        let proximaAcao = delay();

        this.intervaloAtividade = setInterval(() => {
            if (!this.estaAtivo || !this.bot || !this.bot.player) return;

            // Verificar inatividade de rede/eventos (2 minutos)
            if (Date.now() - this.getLastNetworkActivityTime() > 120000) {
                console.log('📡 [AFK] Nenhuma atividade de rede detectada há 2min. Enviando ping...');
                try {
                    // Alternar entre comandos para parecer mais humano
                    const pings = ['/help', '/v'];
                    const ping = pings[Math.floor(Math.random() * pings.length)];
                    this.bot.chat(ping);
                } catch(e) {}
                this.lastEventTime = Date.now();
            }

            proximaAcao -= 100;
            if (proximaAcao > 0) return;

            proximaAcao = delay();
            this.executarAcaoHumana();
        }, 100);

        // Loop de micro-olhar / micro-movimentos (mais frequente e discreto)
        // Executado a cada 2.5 a 5 segundos por padrão
        const microDelay = () => 2500 + Math.random() * 2500;
        let proximoMicroLook = microDelay();

        this.intervaloMicroMovimento = setInterval(() => {
            if (!this.estaAtivo || !this.bot || !this.bot.entity) return;

            proximoMicroLook -= 250;
            if (proximoMicroLook > 0) return;

            proximoMicroLook = microDelay();
            this.acaoMicroLook();
        }, 250);
    }

    iniciarKeepAlive() {
        this.pararKeepAlive();

        const rawIntervalMs = parseInt(process.env.MC_SESSION_KEEPALIVE_MS || '10000', 10);
        const intervalMs = Number.isFinite(rawIntervalMs) ? Math.max(0, rawIntervalMs) : 10000;
        if (intervalMs <= 0) return;

        const rawQuietMs = parseInt(process.env.MC_SESSION_KEEPALIVE_QUIET_MS || String(intervalMs), 10);
        const quietMs = Number.isFinite(rawQuietMs) ? Math.max(1000, rawQuietMs) : intervalMs;
        console.log(`📡 Keepalive de sessão Minecraft ativo (${intervalMs}ms).`);

        this.intervaloKeepAlive = setInterval(() => {
            if (!this.estaAtivo || !this.bot || !this.bot.player || !this.bot._client) return;

            const quietFor = Date.now() - (this.lastActionTime || 0);
            if (quietFor < quietMs) return;

            try {
                const entity = this.bot.entity;
                const position = entity && entity.position;
                if (!position) return;

                this.bot._client.write('position', {
                    x: position.x,
                    y: position.y,
                    z: position.z,
                    yaw: entity.yaw || 0,
                    pitch: entity.pitch || 0,
                    onGround: !!entity.onGround,
                    flags: { onGround: !!entity.onGround, hasHorizontalCollision: undefined }
                });

                this.lastActionTime = Date.now();
                if (this.isDebugEnabled()) console.log(`📡 [KEEPALIVE] position packet enviado após ${(quietFor / 1000).toFixed(1)}s sem pacotes.`);
            } catch (e) {
                if (this.isDebugEnabled()) console.log('⚠️ [KEEPALIVE] Falha ao enviar packet:', e.message);
            }
        }, intervalMs);
    }

    executarAcaoHumana() {
        if (!this.bot || !this.bot.player) return;

        const acoes = [
            () => this.acaoOlhar(),
            () => this.acaoAndar(),
            () => this.acaoPular(),
            () => this.acaoSentar(),
            () => this.acaoSprint(),
            () => this.acaoParar(),
            () => this.acaoOlharJogador(),
            () => this.acaoSentenciar(),
            () => this.acaoEspera(),
            () => this.acaoSwing(),
            () => this.acaoDuploCrouch()
        ];

        const acao = acoes[Math.floor(Math.random() * acoes.length)];
        try {
            acao();
        } catch (e) {
            if (this.isDebugEnabled()) {
                console.log('⚠️ Erro ao executar ação humana:', e.message);
            }
        }
    }

    acaoOlhar() {
        if (!this.bot || !this.bot.entity) return;
        const yaw = Math.random() * Math.PI * 2;
        const pitch = (Math.random() - 0.5) * Math.PI / 2;
        this.bot.look(yaw, pitch, false);
    }

    acaoMicroLook() {
        if (!this.bot || !this.bot.entity) return;
        // Ajustes minúsculos de mouse (yaw +/- 0.05 a 0.15 rad, pitch +/- 0.03 a 0.08 rad)
        const yawOffset = (Math.random() - 0.5) * 0.3;
        const pitchOffset = (Math.random() - 0.5) * 0.15;
        const currentYaw = this.bot.entity.yaw;
        const currentPitch = this.bot.entity.pitch;
        this.bot.look(currentYaw + yawOffset, Math.max(-Math.PI / 2, Math.min(Math.PI / 2, currentPitch + pitchOffset)), false);
    }

    acaoSwing() {
        if (!this.bot) return;
        try {
            this.bot.swingArm('hand');
        } catch(e) {}
    }

    acaoDuploCrouch() {
        if (!this.bot) return;
        try {
            this.bot.setControlState('sneak', true);
            setTimeout(() => {
                if (this.bot) this.bot.setControlState('sneak', false);
                setTimeout(() => {
                    if (this.bot) this.bot.setControlState('sneak', true);
                    setTimeout(() => {
                        if (this.bot) this.bot.setControlState('sneak', false);
                    }, 200);
                }, 150);
            }, 200);
        } catch(e) {}
    }

    acaoAndar() {
        if (!this.bot || !this.bot.entity) return;
        const duracao = 500 + Math.random() * 800; // menor duração para evitar desvio
        const direcoes = ['forward', 'back', 'left', 'right'];
        const dir = direcoes[Math.floor(Math.random() * direcoes.length)];

        // Direção oposta para voltar
        const opostos = { 'forward': 'back', 'back': 'forward', 'left': 'right', 'right': 'left' };
        const oposto = opostos[dir];
        
        if (Math.random() > 0.8) this.bot.setControlState('jump', true);
        
        this.bot.setControlState(dir, true);
        setTimeout(() => {
            if (this.bot) {
                this.bot.setControlState(dir, false);
                this.bot.setControlState('jump', false);
                
                // Espera um pouco e anda na direção oposta para retornar
                setTimeout(() => {
                    if (this.bot) {
                        this.bot.setControlState(oposto, true);
                        setTimeout(() => {
                            if (this.bot) {
                                this.bot.setControlState(oposto, false);
                            }
                        }, duracao);
                    }
                }, 500);
            }
        }, duracao);
    }

    acaoPular() {
        if (!this.bot) return;
        this.bot.setControlState('jump', true);
        setTimeout(() => {
            if (this.bot) this.bot.setControlState('jump', false);
        }, 200 + Math.random() * 400);
    }

    acaoSentar() {
        if (!this.bot) return;
        this.bot.setControlState('sneak', true);
        setTimeout(() => {
            if (this.bot) this.bot.setControlState('sneak', false);
        }, 2000 + Math.random() * 4000);
    }

    acaoSprint() {
        if (!this.bot) return;
        this.bot.setControlState('sprint', true);
        this.bot.setControlState('forward', true);
        setTimeout(() => {
            if (this.bot) {
                this.bot.setControlState('sprint', false);
                this.bot.setControlState('forward', false);
            }
        }, 1000 + Math.random() * 2000);
    }

    acaoParar() {
        if (!this.bot) return;
        ['forward', 'back', 'left', 'right', 'sprint', 'sneak'].forEach(dir => {
            try { this.bot.setControlState(dir, false); } catch(e) {}
        });
    }

    acaoOlharJogador() {
        if (!this.bot || !this.bot.entity) return;
        if (Object.keys(this.bot.entities).length === 0) {
            this.acaoOlhar();
            return;
        }
        const entities = Object.values(this.bot.entities).filter(e => e.type === 'player' && e.username !== this.bot.username);
        if (entities.length > 0) {
            const target = entities[Math.floor(Math.random() * entities.length)];
            if (target.position) {
                this.bot.lookAt(target.position, false);
            }
        } else {
            this.acaoOlhar();
        }
    }

    acaoSentenciar() {
        if (!this.bot) return;
        this.bot.setControlState('sneak', true);
        setTimeout(() => {
            if (this.bot) this.bot.setControlState('sneak', false);
        }, 500);
    }

    acaoEspera() {
        // Apenas espera sem fazer nada - simula inatividade natural
    }

    pararAtividades() {
        if (this.intervaloAtividade) {
            clearInterval(this.intervaloAtividade);
            this.intervaloAtividade = null;
        }
        if (this.intervaloMicroMovimento) {
            clearInterval(this.intervaloMicroMovimento);
            this.intervaloMicroMovimento = null;
        }
        this.acaoParar();
    }

    pararKeepAlive() {
        if (this.intervaloKeepAlive) {
            clearInterval(this.intervaloKeepAlive);
            this.intervaloKeepAlive = null;
        }
    }

    enviarMensagem(texto) {
        if (this.bot && this.bot.player) {
            try {
                const limit = this.getChatLengthLimit();
                const msg = String(texto).replace(/\[BW\]/g, '');

                const prefix = '/cc ';
                const maxPayloadLen = Math.max(0, limit - prefix.length);
                const payload = msg.slice(0, maxPayloadLen);
                const command = (prefix + payload).slice(0, limit);

                if (command.length === 0) return false;

                this.bot.chat(command);
                if (this.onBotMessage) this.onBotMessage(payload);
                return true;
            } catch (err) {
                console.error('Erro ao enviar mensagem:', err);
                return false;
            }
        }
        return false;
    }

    isConnected() {
        if (!this.estaAtivo || !this.bot || !this.bot.player || !this.bot._client) return false;

        const client = this.bot._client;
        if (client.state && client.state !== 'play') return false;
        if (client.socket && client.socket.destroyed) return false;

        return true;
    }

    isConnecting() {
        return !!this.conectando;
    }

    desconectar() {
        this.pararAtividades();
        this.pararKeepAlive();
        this.estaAtivo = false;
        if (this.bot) {
            try { this.bot.quit('Bot desligado'); } catch(e) {}
            this.bot = null;
        }
    }
}

module.exports = { MinecraftBot };
