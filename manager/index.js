require('dotenv').config();

const path = require('path');
const fs = require('fs');
const { fork } = require('child_process');
const http = require('http');

const DEFAULT_PORT = 3000;
const envPort = process.env.PORT;
const requestedPort = (envPort === undefined || envPort === null || envPort === '')
  ? DEFAULT_PORT
  : Number(envPort);

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('OK');
});

const logListeningPort = () => {
  const addr = server.address();
  const actualPort = addr && typeof addr === 'object' ? addr.port : requestedPort;
  console.log(`Health check server running on port ${actualPort}`);
};

let retriedPort = false;
let loggedListening = false;
server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE' && !retriedPort) {
    retriedPort = true;
    console.warn(`⚠️ Health check port ${requestedPort} em uso. Subindo em uma porta aleatória...`);
    server.listen(0);
    return;
  }
  throw err;
});
server.on('listening', () => {
  if (loggedListening) return;
  loggedListening = true;
  logListeningPort();
});
server.listen(requestedPort);

const DISCORD_CHILD = path.join(__dirname, '..', 'discord', 'bot.js');
const MINECRAFT_CHILD = path.join(__dirname, '..', 'minecraft', 'worker.js');

const mcEnabled = !!(process.env.MC_EMAIL || process.env.MC_USERNAME);

let discordProc = null;
let mcProc = null;
let minecraftStartedOnce = false;

let reconnectAttempts = 0;
let reconnectTimeout = null;
let isReconnecting = false;
let lastReconnectionStart = 0;
let reconnectCooldownUntil = 0;
let socketClosedConsecutive = 0;

const MAX_RECONNECT_ATTEMPTS = parseInt(process.env.MC_MAX_RECONNECT_ATTEMPTS || '50', 10);
const RECONNECT_BASE_DELAY = parseInt(process.env.MC_RECONNECT_BASE_DELAY_MS || '5000', 10);
const MAX_RECONNECT_DELAY = parseInt(process.env.MC_RECONNECT_MAX_DELAY_MS || '300000', 10);
const RECONNECT_COOLDOWN_MS = parseInt(process.env.MC_RECONNECT_COOLDOWN_MS || '300000', 10);
const SOCKET_CLOSED_RESET_THRESHOLD = 300000;
const RESTART_COOLDOWN_MS = parseInt(process.env.MC_SERVER_RESTART_COOLDOWN_MS || '90000', 10);
const SESSION_COOLDOWN_MS = parseInt(process.env.MC_SESSION_COOLDOWN_MS || '90000', 10);
const COOLDOWN_FILE = process.env.MC_RECONNECT_COOLDOWN_FILE
  ? path.resolve(process.env.MC_RECONNECT_COOLDOWN_FILE)
  : path.join(__dirname, '..', 'minecraft-profiles', '.reconnect-cooldown.json');

function sendToDiscord(message) {
  if (!discordProc || !discordProc.connected) return;
  try { discordProc.send(message); } catch {}
}

function sendToMinecraft(message) {
  if (!mcProc || !mcProc.connected) return;
  try { mcProc.send(message); } catch {}
}

function clearReconnectTimer() {
  if (reconnectTimeout) clearTimeout(reconnectTimeout);
  reconnectTimeout = null;
}

function saveReconnectCooldown(reason) {
  if (!reconnectCooldownUntil || reconnectCooldownUntil <= Date.now()) return;
  try {
    fs.mkdirSync(path.dirname(COOLDOWN_FILE), { recursive: true });
    fs.writeFileSync(COOLDOWN_FILE, JSON.stringify({
      until: reconnectCooldownUntil,
      reason: String(reason || ''),
      savedAt: Date.now()
    }));
  } catch {}
}

function loadReconnectCooldown() {
  try {
    const parsed = JSON.parse(fs.readFileSync(COOLDOWN_FILE, 'utf8'));
    const until = Number(parsed && parsed.until);
    if (Number.isFinite(until) && until > Date.now()) {
      reconnectCooldownUntil = Math.max(reconnectCooldownUntil || 0, until);
      return String(parsed.reason || 'persisted-cooldown');
    }
  } catch {}
  return null;
}

function clearReconnectCooldown() {
  reconnectCooldownUntil = 0;
  try { fs.rmSync(COOLDOWN_FILE, { force: true }); } catch {}
}

function requestMinecraftConnect(reason = 'requested') {
  if (!mcEnabled) return;

  const persistedReason = loadReconnectCooldown();
  if (reconnectCooldownUntil && Date.now() < reconnectCooldownUntil) {
    const waitMs = reconnectCooldownUntil - Date.now();
    console.log(`⏸️ Conexão Minecraft adiada por ${(waitMs / 1000).toFixed(1)}s (${persistedReason || reason}).`);
    clearReconnectTimer();
    reconnectTimeout = setTimeout(() => {
      reconnectCooldownUntil = 0;
      requestMinecraftConnect('cooldown-expired');
    }, waitMs);
    return;
  }

  clearReconnectCooldown();
  sendToMinecraft({ type: 'mc:connect' });
}

function scheduleReconnect(reason) {
  if (!mcEnabled) return;
  if (isReconnecting) return;

  lastReconnectionStart = Date.now();

  const reasonStr = String(reason || '');
  let isRestarting = false;
  if (/já está conectado no servidor/i.test(reasonStr) || /already (?:logged|connected)/i.test(reasonStr)) {
    // Evita loop: o servidor ainda mantém a sessão antiga por um tempo.
    reconnectCooldownUntil = Date.now() + SESSION_COOLDOWN_MS;
  } else if (/reiniciando|reiniciar|restarting|restart/i.test(reasonStr)) {
    // Servidor reiniciando: aguarda um tempo maior para o servidor voltar antes de tentar reconectar
    reconnectCooldownUntil = Date.now() + RESTART_COOLDOWN_MS;
    isRestarting = true;
  }

  if (reconnectCooldownUntil && Date.now() < reconnectCooldownUntil) {
    const waitMs = reconnectCooldownUntil - Date.now();
    if (isRestarting) {
      console.log(`⏸️ Servidor reiniciando. Reconexão suspensa em cooldown por ${(waitMs / 1000).toFixed(1)}s.`);
    } else {
      console.log(`⏸️ Reconexão em cooldown por ${(waitMs / 1000).toFixed(1)}s (evita loop infinito).`);
    }
    saveReconnectCooldown(reasonStr);
    clearReconnectTimer();
    reconnectTimeout = setTimeout(() => scheduleReconnect('cooldown-expired'), waitMs);
    return;
  }

  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    reconnectCooldownUntil = Date.now() + RECONNECT_COOLDOWN_MS;
    console.log(`⏸️ Atingiu ${MAX_RECONNECT_ATTEMPTS} tentativas. Pausando reconexão por ${(RECONNECT_COOLDOWN_MS / 1000).toFixed(1)}s...`);
    reconnectAttempts = 0;
    saveReconnectCooldown('max-attempts');
    clearReconnectTimer();
    reconnectTimeout = setTimeout(() => scheduleReconnect('cooldown'), RECONNECT_COOLDOWN_MS);
    return;
  }

  isReconnecting = true;
  reconnectAttempts++;

  const lastSocketClosedTime = global.__MC_LAST_SOCKET_CLOSED_TIME || 0;
  if (lastSocketClosedTime && (Date.now() - lastSocketClosedTime < SOCKET_CLOSED_RESET_THRESHOLD)) {
    socketClosedConsecutive++;
  } else {
    socketClosedConsecutive = 0;
  }

  let delay;
  if (socketClosedConsecutive > 3) {
    console.log(`⚠️ Múltiplos socketClosed detectados (${socketClosedConsecutive}x). Fazendo reset completo do worker...`);
    try { mcProc && mcProc.kill('SIGTERM'); } catch {}
    delay = 10000 + Math.random() * 5000;
  } else {
    delay = Math.min(RECONNECT_BASE_DELAY * Math.pow(1.3, reconnectAttempts - 1), MAX_RECONNECT_DELAY) + (Math.random() * 3000);
  }

  console.log(`🔄 Reconectando em ${(delay / 1000).toFixed(1)}s (tentativa ${reconnectAttempts})... (${reason || 'unknown'})`);

  clearReconnectTimer();
  reconnectTimeout = setTimeout(() => {
    isReconnecting = false;
    requestMinecraftConnect(reason || 'reconnect');
  }, delay);
}

function resetReconnectState() {
  reconnectAttempts = 0;
  isReconnecting = false;
  socketClosedConsecutive = 0;
  lastReconnectionStart = 0;
  clearReconnectCooldown();
  clearReconnectTimer();
}

function startDiscord() {
  if (discordProc && !discordProc.killed) return;
  discordProc = fork(DISCORD_CHILD, [], { stdio: ['inherit', 'inherit', 'inherit', 'ipc'] });

  discordProc.on('message', (msg) => {
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'mc:connect') {
      requestMinecraftConnect('discord-ready');
      return;
    }
    if (msg.type === 'mc:disconnect') {
      resetReconnectState();
      sendToMinecraft({ type: 'mc:disconnect' });
      return;
    }
    if (msg.type === 'mc:send') {
      sendToMinecraft({ type: 'mc:send', text: msg.text });
      return;
    }
    if (msg.type === 'mc:status') {
      sendToMinecraft({ type: 'mc:status', requestId: msg.requestId });
      return;
    }
    if (msg.type === 'mc:clanMembers') {
      sendToMinecraft({ type: 'mc:clanMembers', requestId: msg.requestId });
      return;
    }
  });

  discordProc.on('exit', (code, signal) => {
    console.log(`⚠️ [MANAGER] Discord worker saiu (code=${code} signal=${signal}). Reiniciando...`);
    setTimeout(startDiscord, 3000);
  });
}

function startMinecraft() {
  if (!mcEnabled) {
    console.log('[MC] Sem credenciais (MC_EMAIL/MC_USERNAME). Minecraft worker desativado.');
    return;
  }

  if (mcProc && !mcProc.killed) return;
  mcProc = fork(MINECRAFT_CHILD, [], { stdio: ['inherit', 'inherit', 'inherit', 'ipc'] });
  if (!minecraftStartedOnce) {
    minecraftStartedOnce = true;
    setTimeout(() => requestMinecraftConnect('manager-boot'), 1000);
  }

  mcProc.on('message', (msg) => {
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'mc:state') {
      if (msg.lastSocketClosedTime) global.__MC_LAST_SOCKET_CLOSED_TIME = msg.lastSocketClosedTime;
      if (msg.connected) {
        resetReconnectState();
      }
      sendToDiscord(msg);
      return;
    }

    if (msg.type === 'mc:disconnected') {
      sendToDiscord(msg);
      scheduleReconnect(msg.reason || 'disconnected');
      return;
    }

    if (msg.type === 'mc:connected') {
      resetReconnectState();
      sendToDiscord(msg);
      return;
    }

    // Eventos do Minecraft para o Discord
    sendToDiscord(msg);
  });

  mcProc.on('exit', (code, signal) => {
    console.log(`⚠️ [MANAGER] Minecraft worker saiu (code=${code} signal=${signal}).`);
    mcProc = null;
    sendToDiscord({ type: 'mc:state', connected: false, lastEventTime: 0 });
    scheduleReconnect(`worker-exit:${code || signal || 'unknown'}`);
    setTimeout(startMinecraft, 5000);
  });
}

startDiscord();
startMinecraft();

// Watchdog: evita reconexão travada por muito tempo
setInterval(() => {
  if (!mcEnabled) return;
  if (isReconnecting && lastReconnectionStart > 0 && (Date.now() - lastReconnectionStart > 600000)) {
    console.log('⚠️ [WATCHDOG] Reconexão travada há 10min. Resetando estado...');
    isReconnecting = false;
    reconnectAttempts = 0;
    scheduleReconnect('watchdog-reset');
  }
}, 60000);

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
