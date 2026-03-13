const crypto = require('crypto');

/**
 * Generates a unique randomized ticket number.
 * Format: XXXX-XXXX-XXXX (alphanumeric, uppercase)
 */
function generateTicketNumber() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // removed ambiguous chars
  const segments = [];
  for (let s = 0; s < 3; s++) {
    let segment = '';
    const bytes = crypto.randomBytes(4);
    for (let i = 0; i < 4; i++) {
      segment += chars[bytes[i] % chars.length];
    }
    segments.push(segment);
  }
  return segments.join('-');
}

/**
 * Generates multiple unique ticket numbers
 */
function generateTicketNumbers(count) {
  const tickets = new Set();
  while (tickets.size < count) {
    tickets.add(generateTicketNumber());
  }
  return [...tickets];
}

module.exports = { generateTicketNumber, generateTicketNumbers };
