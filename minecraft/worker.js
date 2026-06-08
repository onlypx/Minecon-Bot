require('dotenv').config();

const { MinecraftBot } = require('../services/minecraft');
const { AsyncQueue, sleep } = require('../utils/asyncQueue');

const mcBot = new MinecraftBot();

let lastStateSentAt = 0;

const outgoingToMinecraftQueue = new AsyncQueue();
const mcSendDelayMs = Math.max(0, parseInt(process.env.MC_SEND_DELAY_MS || '2000', 10) || 2000);

function sendToManager(msg) {
  if (!process.send) return;
  try { process.send(msg); } catch {}
}

function sendState(extra = {}) {
  const now = Date.now();
  // evita flood de IPC
  if (now - lastStateSentAt < 500 && !extra.force) return;
  lastStateSentAt = now;
  sendToManager({
    type: 'mc:state',
    connected: mcBot.isConnected(),
    lastEventTime: mcBot.lastEventTime || 0,
    lastPacketTime: mcBot.lastPacketTime || 0,
    lastNetworkActivityTime: mcBot.getLastNetworkActivityTime ? mcBot.getLastNetworkActivityTime() : (mcBot.lastEventTime || 0),
    lastSocketClosedTime: mcBot._lastSocketClosedTime || 0,
    ...extra
  });
}

mcBot.onCommand = (comando, jogador) => {
  sendToManager({ type: 'mc:onCommand', comando, jogador });
};

mcBot.onClanEvent = (evento) => {
  sendToManager({ type: 'mc:clanEvent', eventoTipo: evento && evento.tipo, mensagem: evento && evento.mensagem });
};

mcBot.onClanChat = (username, message) => {
  sendToManager({ type: 'mc:clanChat', username, message });
};

mcBot.onBotMessage = (message) => {
  sendToManager({ type: 'mc:botMessage', message });
};

mcBot.onDisconnect = (reason) => {
  sendState({ force: true });
  sendToManager({ type: 'mc:disconnected', reason: String(reason || 'socketClosed') });
};

async function connect() {
  if (mcBot.isConnected()) {
    sendState({ force: true });
    return true;
  }

  if (mcBot.isConnecting()) {
    sendState({ force: true });
    return false;
  }

  try {
    const connected = await mcBot.conectar();
    sendState({ force: true });
    if (connected && mcBot.isConnected()) {
      sendToManager({ type: 'mc:connected' });
      return true;
    }

    sendToManager({ type: 'mc:disconnected', reason: 'connect-returned-false' });
    return false;
  } catch (err) {
    sendState({ force: true });
    const msg = err && err.message ? err.message : String(err);
    sendToManager({ type: 'mc:disconnected', reason: msg });
    return false;
  }
}

function disconnect() {
  try { mcBot.desconectar(); } catch {}
  sendState({ force: true });
}

async function minecraftSendWorker() {
  // Loop infinito: consome 1 item por vez, respeita delay e não consome se estiver desconectado.
  while (true) {
    await outgoingToMinecraftQueue.waitForItem();

    if (!mcBot.isConnected()) {
      await sleep(1000);
      continue;
    }

    const item = outgoingToMinecraftQueue.shift();
    if (item === undefined) continue;

    try {
      mcBot.enviarMensagem(String(item));
    } catch {}

    await sleep(mcSendDelayMs);
  }
}

process.on('message', async (msg) => {
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'mc:connect') {
    await connect();
    return;
  }

  if (msg.type === 'mc:disconnect') {
    disconnect();
    return;
  }

  if (msg.type === 'mc:send') {
    if (!msg.text) return;
    outgoingToMinecraftQueue.enqueue(String(msg.text));
    return;
  }

  if (msg.type === 'mc:status') {
    sendToManager({
      type: 'mc:status:reply',
      requestId: msg.requestId,
      connected: mcBot.isConnected(),
      lastEventTime: mcBot.lastEventTime || 0,
      lastPacketTime: mcBot.lastPacketTime || 0,
      lastNetworkActivityTime: mcBot.getLastNetworkActivityTime ? mcBot.getLastNetworkActivityTime() : (mcBot.lastEventTime || 0)
    });
    return;
  }

  if (msg.type === 'mc:clanMembers') {
    const requestId = msg.requestId;
    try {
      const members = await mcBot.buscarMembrosDoClan();
      sendToManager({ type: 'mc:clanMembers:reply', requestId, ok: true, members });
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      sendToManager({ type: 'mc:clanMembers:reply', requestId, ok: false, error: message, members: [] });
    }
    return;
  }
});

// Start worker
minecraftSendWorker();

// Watchdog: freeze/ram -> sair para o manager reiniciar
const MAX_RSS_MB = parseInt(process.env.MC_MAX_RSS_MB || '380', 10);
const FREEZE_MS = parseInt(process.env.MC_FREEZE_MS || '180000', 10); // 3min
const SIMPLE_MODE = String(process.env.MC_SIMPLE || '').trim() === '1';
const NETWORK_FREEZE_MS = parseInt(process.env.MC_NETWORK_FREEZE_MS || String(FREEZE_MS), 10);

setInterval(() => {
  const rssMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
  if (MAX_RSS_MB > 0 && rssMb > MAX_RSS_MB) {
    console.log(`⚠️ [MC_WATCHDOG] RSS ${rssMb}MB > ${MAX_RSS_MB}MB. Encerrando worker para restart...`);
    process.exit(42);
  }

  if (mcBot.isConnected()) {
    // Em modo simples (MC_SIMPLE=1), não registramos listeners de chat/mensagem,
    // então "sem eventos" é esperado. Nesse caso, não encerra o worker por freeze.
    if (!SIMPLE_MODE) {
      const last = mcBot.getLastNetworkActivityTime ? mcBot.getLastNetworkActivityTime() : (mcBot.lastEventTime || 0);
      if (last && Date.now() - last > NETWORK_FREEZE_MS) {
        console.log(`⚠️ [MC_WATCHDOG] Sem atividade de rede há ${(NETWORK_FREEZE_MS / 1000).toFixed(0)}s. Encerrando worker para destravar...`);
        process.exit(43);
      }
    }
  }

  sendState();
}, 30000);

// Boot standalone: quando há manager/IPC, ele é o único dono do agendamento de conexão.
if (!process.send && (process.env.MC_EMAIL || process.env.MC_USERNAME)) {
  connect();
}

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
