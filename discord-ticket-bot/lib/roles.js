// Role configuration - maps role names to ticket counts
// The bot matches Discord role names (case-insensitive) to these entries.
// "Server Booster" is additive — it adds +1 on TOP of whatever other role tickets a user gets.

const ROLE_CONFIG = [
  {
    name: 'Banned Gang',
    envKey: 'ROLE_BANNED_GANG',
    tickets: 1,
    color: '#ff4444',
    additive: false
  },
  {
    name: 'Server Booster',
    envKey: 'ROLE_SERVER_BOOSTER',
    tickets: 1,
    color: '#f47fff',
    additive: true  // This stacks on top of other roles
  },
  {
    name: 'Scooter Gang',
    envKey: 'ROLE_SCOOTER_GANG',
    tickets: 1,
    color: '#44bbff',
    additive: false
  },
  {
    name: 'Short Shorts Gang',
    envKey: 'ROLE_SHORT_SHORTS_GANG',
    tickets: 4,
    color: '#44ff88',
    additive: false
  },
  {
    name: '1% Gang',
    envKey: 'ROLE_ONE_PERCENT_GANG',
    tickets: 6,
    color: '#ffcc00',
    additive: false
  }
];

/**
 * Determines how many tickets a member gets based on their roles.
 * Takes the HIGHEST non-additive role, then adds any additive roles on top.
 * @param {GuildMember} member - Discord.js GuildMember
 * @returns {{ totalTickets: number, primaryRole: string, hasBooster: boolean } | null}
 */
function calculateTickets(member) {
  const memberRoleIds = member.roles.cache.map(r => r.id);
  const memberRoleNames = member.roles.cache.map(r => r.name.toLowerCase());

  let bestNonAdditive = null;
  let additiveTotal = 0;
  let hasBooster = false;

  for (const role of ROLE_CONFIG) {
    const roleId = process.env[role.envKey];
    // Match by role ID (from env) or by role name (case-insensitive fallback)
    const hasRole = (roleId && memberRoleIds.includes(roleId)) ||
                    memberRoleNames.includes(role.name.toLowerCase());

    if (!hasRole) continue;

    if (role.additive) {
      additiveTotal += role.tickets;
      if (role.name === 'Server Booster') hasBooster = true;
    } else {
      if (!bestNonAdditive || role.tickets > bestNonAdditive.tickets) {
        bestNonAdditive = role;
      }
    }
  }

  if (!bestNonAdditive && additiveTotal === 0) return null;

  const baseTickets = bestNonAdditive ? bestNonAdditive.tickets : 0;
  // Only give additive tickets if user has a base qualifying role
  const total = bestNonAdditive ? baseTickets + additiveTotal : 0;

  if (total === 0) return null;

  return {
    totalTickets: total,
    primaryRole: bestNonAdditive ? bestNonAdditive.name : 'Server Booster',
    hasBooster
  };
}

function getRoleColor(roleName) {
  const role = ROLE_CONFIG.find(r => r.name.toLowerCase() === roleName.toLowerCase());
  return role ? role.color : '#888888';
}

module.exports = { ROLE_CONFIG, calculateTickets, getRoleColor };
