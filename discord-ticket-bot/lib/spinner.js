const crypto = require('crypto');
const seedrandom = require('seedrandom');

/**
 * Generates a cryptographically random seed string
 * Format: 16 hex characters
 */
function generateSeed() {
  return crypto.randomBytes(8).toString('hex').toUpperCase();
}

/**
 * Deterministically picks a winner from a list of entries using a seed.
 * Anyone can re-run this with the same seed + entries to verify.
 * 
 * @param {string} seed - The seed string
 * @param {Array} entries - Array of { id, username, ticketNumber, roleName }
 * @returns {{ winner: object, index: number }}
 */
function spinWithSeed(seed, entries) {
  if (!entries || entries.length === 0) return null;
  
  const rng = seedrandom(seed);
  const index = Math.floor(rng() * entries.length);
  
  return {
    winner: entries[index],
    index
  };
}

/**
 * Verifies a spin result - given the same seed and entries,
 * should produce the same winner index.
 */
function verifySpin(seed, entries, expectedIndex) {
  const result = spinWithSeed(seed, entries);
  return result && result.index === expectedIndex;
}

module.exports = { generateSeed, spinWithSeed, verifySpin };
