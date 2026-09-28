// src/config/clanConfig.js

/**
 * Centralized Clan Configuration
 * 
 * Supports dynamic configuration and easy addition of future clans (CLAN 5, CLAN 6, etc.)
 */
const CLANS = {
    aura7f: {
        id: 'aura7f',
        name: 'AURA 7F',
        roleId: process.env.CLAN_AURA7F_ROLE_ID || '1364585878282043479',
        progressChannelId: process.env.CLAN_AURA7F_PROGRESS_CHANNEL_ID || '1351223274750869554'
    },
    belmont: {
        id: 'belmont',
        name: 'BELMONT',
        roleId: process.env.CLAN_BELMONT_ROLE_ID || '1364584863880974386',
        progressChannelId: process.env.CLAN_BELMONT_PROGRESS_CHANNEL_ID || '1351223371987161179'
    },
    lumina: {
        id: 'lumina',
        name: 'LUMINA',
        roleId: process.env.CLAN_LUMINA_ROLE_ID || '1364586296055431229',
        progressChannelId: process.env.CLAN_LUMINA_PROGRESS_CHANNEL_ID || '1351223462554763414'
    },
    shadastria: {
        id: 'shadastria',
        name: 'SHADASTRIA',
        roleId: process.env.CLAN_SHADASTRIA_ROLE_ID || '1364586658628108390',
        progressChannelId: process.env.CLAN_SHADASTRIA_PROGRESS_CHANNEL_ID || '1351223714355744828'
    }
};

/**
 * Get clan object by clan key or ID (case-insensitive)
 * @param {string} clanId 
 * @returns {object|null}
 */
function getClanById(clanId) {
    if (!clanId) return null;
    const normalized = clanId.toLowerCase().trim();
    return CLANS[normalized] || Object.values(CLANS).find(c => c.id.toLowerCase() === normalized || c.name.toLowerCase() === normalized) || null;
}

/**
 * Get clan by its Discord role ID
 * @param {string} roleId 
 * @returns {object|null}
 */
function getClanByRoleId(roleId) {
    if (!roleId) return null;
    return Object.values(CLANS).find(c => c.roleId === roleId) || null;
}

/**
 * Get clan by its Discord progress channel ID
 * @param {string} channelId 
 * @returns {object|null}
 */
function getClanByProgressChannelId(channelId) {
    if (!channelId) return null;
    return Object.values(CLANS).find(c => c.progressChannelId === channelId) || null;
}

/**
 * Check whether a channel ID is one of the configured clan progress channels
 * @param {string} channelId 
 * @returns {boolean}
 */
function isClanProgressChannel(channelId) {
    if (!channelId) return false;
    return Object.values(CLANS).some(c => c.progressChannelId === channelId);
}

/**
 * Get all configured clan progress channel IDs
 * @returns {string[]}
 */
function getAllProgressChannelIds() {
    return Object.values(CLANS).map(c => c.progressChannelId);
}

/**
 * Detect clan for a Discord guild member based on roles.
 * Safely handles:
 * - 0 clan roles: returns { clan: null, error: 'NO_CLAN_ROLE' }
 * - >1 clan roles: returns { clan: null, error: 'MULTIPLE_CLAN_ROLES', conflictingClans: [...] }
 * - 1 clan role: returns { clan, error: null }
 * 
 * @param {object} member Discord GuildMember or member-like object with roles
 * @returns {{ clan: object|null, error: string|null, conflictingClans?: object[] }}
 */
function detectMemberClan(member) {
    if (!member) {
        return { clan: null, error: 'NO_MEMBER_CONTEXT' };
    }

    // Support both Discord.js GuildMember (roles.cache) and raw role ID array
    let memberRoleIds = [];
    if (member.roles && member.roles.cache) {
        memberRoleIds = Array.from(member.roles.cache.keys());
    } else if (Array.isArray(member.roles)) {
        memberRoleIds = member.roles;
    } else if (member._roles && Array.isArray(member._roles)) {
        memberRoleIds = member._roles;
    }

    const matchedClans = [];
    for (const clan of Object.values(CLANS)) {
        if (memberRoleIds.includes(clan.roleId)) {
            matchedClans.push(clan);
        }
    }

    if (matchedClans.length === 0) {
        return { clan: null, error: 'NO_CLAN_ROLE' };
    }

    if (matchedClans.length > 1) {
        return { 
            clan: null, 
            error: 'MULTIPLE_CLAN_ROLES', 
            conflictingClans: matchedClans 
        };
    }

    return { clan: matchedClans[0], error: null };
}

module.exports = {
    CLANS,
    getClanById,
    getClanByRoleId,
    getClanByProgressChannelId,
    isClanProgressChannel,
    getAllProgressChannelIds,
    detectMemberClan
};
