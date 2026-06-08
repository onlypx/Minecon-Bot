const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'data', 'tickets.json');

function ensureStore() {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify({ counter: 0, tickets: {} }, null, 2));
  }
}

function readStore() {
  ensureStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return {
      counter: Number(parsed.counter) || 0,
      tickets: parsed.tickets && typeof parsed.tickets === 'object' ? parsed.tickets : {}
    };
  } catch {
    return { counter: 0, tickets: {} };
  }
}

function writeStore(store) {
  ensureStore();
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2));
}

function getOpenTickets(guildId) {
  const store = readStore();
  return Object.values(store.tickets).filter(ticket => ticket.guildId === guildId && ticket.status === 'open');
}

function getOpenTicketByUser(guildId, userId) {
  return getOpenTickets(guildId).find(ticket => ticket.userId === userId) || null;
}

function getTicketByChannel(channelId) {
  const store = readStore();
  return Object.values(store.tickets).find(ticket => ticket.channelId === channelId && ticket.status === 'open') || null;
}

function createTicket(ticket) {
  const store = readStore();
  store.counter += 1;
  const id = String(store.counter).padStart(4, '0');
  store.tickets[id] = {
    id,
    status: 'open',
    claimedBy: null,
    createdAt: Date.now(),
    ...ticket
  };
  writeStore(store);
  return store.tickets[id];
}

function updateTicket(id, patch) {
  const store = readStore();
  if (!store.tickets[id]) return null;
  store.tickets[id] = { ...store.tickets[id], ...patch, updatedAt: Date.now() };
  writeStore(store);
  return store.tickets[id];
}

function countOpenTickets(guildId) {
  return getOpenTickets(guildId).length;
}

module.exports = {
  countOpenTickets,
  createTicket,
  getOpenTicketByUser,
  getOpenTickets,
  getTicketByChannel,
  updateTicket
};
