const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Pick database location:
// 1. DATABASE_PATH env var (if set)
// 2. /tmp/giveaway.db (works on Railway without a volume)
// 3. ./data/giveaway.db (local development)
function getDbPath() {
  if (process.env.DATABASE_PATH) return process.env.DATABASE_PATH;
  if (process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_SERVICE_ID) return '/tmp/giveaway.db';
  return path.join(__dirname, '..', 'data', 'giveaway.db');
}

const DB_PATH = getDbPath();

// Auto-create the directory if it doesn't exist
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

console.log(`📂 Database path: ${DB_PATH}`);

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    initTables();
  }
  return db;
}

function initTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS giveaways (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      status TEXT DEFAULT 'open',
      seed TEXT,
      winner_user_id TEXT,
      winner_username TEXT,
      winner_role TEXT,
      winner_ticket_number TEXT
    );

    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      giveaway_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      display_name TEXT,
      role_name TEXT NOT NULL,
      ticket_number TEXT NOT NULL UNIQUE,
      assigned_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (giveaway_id) REFERENCES giveaways(id)
    );

    CREATE TABLE IF NOT EXISTS spin_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      giveaway_id INTEGER NOT NULL,
      seed TEXT NOT NULL,
      winner_ticket_id INTEGER,
      spun_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (giveaway_id) REFERENCES giveaways(id),
      FOREIGN KEY (winner_ticket_id) REFERENCES tickets(id)
    );
  `);
}

// --- Giveaway CRUD ---

function createGiveaway(name) {
  const stmt = getDb().prepare('INSERT INTO giveaways (name) VALUES (?)');
  const result = stmt.run(name);
  return result.lastInsertRowid;
}

function getGiveaway(id) {
  return getDb().prepare('SELECT * FROM giveaways WHERE id = ?').get(id);
}

function getAllGiveaways() {
  return getDb().prepare('SELECT * FROM giveaways ORDER BY created_at DESC').all();
}

function updateGiveawayStatus(id, status) {
  getDb().prepare('UPDATE giveaways SET status = ? WHERE id = ?').run(status, id);
}

function setGiveawayWinner(id, seed, userId, username, role, ticketNumber) {
  getDb().prepare(`
    UPDATE giveaways SET status = 'completed', seed = ?, winner_user_id = ?, 
    winner_username = ?, winner_role = ?, winner_ticket_number = ? WHERE id = ?
  `).run(seed, userId, username, role, ticketNumber, id);
}

// --- Ticket CRUD ---

function addTicket(giveawayId, userId, username, displayName, roleName, ticketNumber) {
  const stmt = getDb().prepare(`
    INSERT INTO tickets (giveaway_id, user_id, username, display_name, role_name, ticket_number)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  return stmt.run(giveawayId, userId, username, displayName, roleName, ticketNumber);
}

function getTicketsForGiveaway(giveawayId) {
  return getDb().prepare('SELECT * FROM tickets WHERE giveaway_id = ? ORDER BY role_name, username').all(giveawayId);
}

function getTicketByNumber(ticketNumber) {
  return getDb().prepare('SELECT * FROM tickets WHERE ticket_number = ?').get(ticketNumber);
}

function getUserTickets(giveawayId, userId) {
  return getDb().prepare('SELECT * FROM tickets WHERE giveaway_id = ? AND user_id = ?').all(giveawayId, userId);
}

// --- Spin History ---

function addSpinHistory(giveawayId, seed, winnerTicketId) {
  getDb().prepare('INSERT INTO spin_history (giveaway_id, seed, winner_ticket_id) VALUES (?, ?, ?)')
    .run(giveawayId, seed, winnerTicketId);
}

function getSpinHistory(giveawayId) {
  return getDb().prepare(`
    SELECT sh.*, t.username, t.ticket_number, t.role_name 
    FROM spin_history sh 
    LEFT JOIN tickets t ON sh.winner_ticket_id = t.id 
    WHERE sh.giveaway_id = ? 
    ORDER BY sh.spun_at DESC
  `).all(giveawayId);
}

module.exports = {
  getDb,
  createGiveaway,
  getGiveaway,
  getAllGiveaways,
  updateGiveawayStatus,
  setGiveawayWinner,
  addTicket,
  getTicketsForGiveaway,
  getTicketByNumber,
  getUserTickets,
  addSpinHistory,
  getSpinHistory
};
