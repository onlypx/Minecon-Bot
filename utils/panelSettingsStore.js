const fs = require('fs');
const path = require('path');
const ticketConfig = require('../config/tickets');

const filePath = path.join(__dirname, '..', 'data', 'panelSettings.json');

function ensureStore() {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify({ guilds: {} }, null, 2));
  }
}

function readStore() {
  ensureStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return {
      guilds: parsed.guilds && typeof parsed.guilds === 'object' ? parsed.guilds : {}
    };
  } catch {
    return { guilds: {} };
  }
}

function writeStore(store) {
  ensureStore();
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2));
}

function getGuildSettings(guildId) {
  const store = readStore();
  const settings = store.guilds[guildId] || {};

  return {
    transcriptLogChannelId: settings.transcriptLogChannelId || ticketConfig.transcriptLogChannelId || null,
    mentionRoleIds: Array.isArray(settings.mentionRoleIds) ? settings.mentionRoleIds : [],
    updatedAt: settings.updatedAt || null,
    updatedBy: settings.updatedBy || null
  };
}

function updateGuildSettings(guildId, patch) {
  const store = readStore();
  store.guilds[guildId] = {
    ...(store.guilds[guildId] || {}),
    ...patch,
    updatedAt: Date.now()
  };
  writeStore(store);
  return getGuildSettings(guildId);
}

module.exports = {
  getGuildSettings,
  updateGuildSettings
};
