// src/services/clanProgressService.js
const { ChannelType } = require('discord.js');
const clanConfig = require('../config/clanConfig');
const database = require('../database/supabase');
const config = require('../config/config');

class ClanProgressService {
    constructor() {
        this.clans = clanConfig.CLANS;
    }

    /**
     * Resolves the primary progress channel ID for a message,
     * accounting for regular text channels, forum channels, and threads.
     * 
     * @param {object} channel Discord channel object
     * @returns {string|null}
     */
    resolveProgressChannelId(channel) {
        if (!channel) return null;

        // If channel is a thread, the progress channel is the thread's parent
        if (
            (typeof channel.isThread === 'function' && channel.isThread()) ||
            channel.type === ChannelType.PublicThread ||
            channel.type === ChannelType.PrivateThread
        ) {
            return channel.parentId || channel.parent?.id || null;
        }

        return channel.id;
    }

    /**
     * Validates whether a message is in a monitored clan progress channel,
     * detects the author's clan role, and verifies the clan-channel match.
     * 
     * @param {object} message Discord message object
     * @returns {Promise<{
     *   isMonitoredClanChannel: boolean,
     *   valid: boolean,
     *   clan?: object,
     *   channelClan?: object,
     *   reason?: string
     * }>}
     */
    async validateClanSubmission(message) {
        try {
            const targetChannelId = this.resolveProgressChannelId(message.channel);

            // Check if this channel is one of the 4 configured clan progress channels
            if (!clanConfig.isClanProgressChannel(targetChannelId)) {
                return {
                    isMonitoredClanChannel: false,
                    valid: false,
                    reason: 'NOT_A_CLAN_PROGRESS_CHANNEL'
                };
            }

            const channelClan = clanConfig.getClanByProgressChannelId(targetChannelId);

            // Fetch member if not already on message
            let member = message.member;
            if (!member && message.guild) {
                try {
                    member = await message.guild.members.fetch(message.author.id);
                } catch (err) {
                    console.warn(`[Clan Progress] Could not fetch member for ${message.author.username}:`, err.message);
                }
            }

            if (!member) {
                return {
                    isMonitoredClanChannel: true,
                    valid: false,
                    channelClan,
                    reason: 'NO_MEMBER_CONTEXT'
                };
            }

            // Detect clan role
            const detection = clanConfig.detectMemberClan(member);

            if (detection.error === 'NO_CLAN_ROLE') {
                console.log(`[Clan Progress] Member ${message.author.username} (${message.author.id}) has no clan role. Skipping clan progress.`);
                return {
                    isMonitoredClanChannel: true,
                    valid: false,
                    channelClan,
                    reason: 'NO_CLAN_ROLE'
                };
            }

            if (detection.error === 'MULTIPLE_CLAN_ROLES') {
                const names = detection.conflictingClans ? detection.conflictingClans.map(c => c.name).join(', ') : 'Multiple';
                console.warn(`⚠️ [Clan Progress] Conflict: Member ${message.author.username} has multiple clan roles: [${names}]. Skipping to avoid duplicate processing.`);
                return {
                    isMonitoredClanChannel: true,
                    valid: false,
                    channelClan,
                    conflictingClans: detection.conflictingClans,
                    reason: 'MULTIPLE_CLAN_ROLES'
                };
            }

            const memberClan = detection.clan;
            console.log(`[Clan Progress] Clan detected: ${memberClan.name} for ${message.author.username}`);

            // Verify clan matches channel
            if (targetChannelId !== memberClan.progressChannelId) {
                console.log(`❌ [Clan Progress] Invalid clan/channel combination: Member ${message.author.username} (Clan: ${memberClan.name}) posted in channel ${targetChannelId} (${channelClan?.name || 'Unknown'}) instead of ${memberClan.progressChannelId}. Ignoring.`);
                return {
                    isMonitoredClanChannel: true,
                    valid: false,
                    clan: memberClan,
                    channelClan,
                    reason: 'CHANNEL_MISMATCH'
                };
            }

            console.log(`✅ [Clan Progress] Correct channel detected: ${message.author.username} in ${memberClan.name} progress channel (${memberClan.progressChannelId})`);
            return {
                isMonitoredClanChannel: true,
                valid: true,
                clan: memberClan,
                channelClan
            };

        } catch (error) {
            console.error('Error in validateClanSubmission:', error);
            return {
                isMonitoredClanChannel: false,
                valid: false,
                reason: 'ERROR'
            };
        }
    }

    /**
     * Checks if a member has already submitted today's progress for a specific clan.
     * Checks both the clan progress store/table and the Supabase daily points table.
     * 
     * @param {string} clanId Clan identifier (e.g. 'aura7f')
     * @param {string} userId Discord user ID
     * @param {string} dateString Date string (YYYY-MM-DD in IST)
     * @param {string|null} username Optional Discord username
     * @returns {Promise<boolean>}
     */
    async hasSubmittedToday(clanId, userId, dateString = null, username = null) {
        const targetDate = dateString || config.getISTDateString();
        
        // 1. Direct check in clan store / clan_progress table
        const submittedClan = await database.hasClanSubmittedToday(clanId, userId, targetDate);
        if (submittedClan) return true;

        // 2. Check points table if member has username or previous store submission
        try {
            let targetUsername = username;
            if (!targetUsername && userId) {
                const store = database.readClanStore ? database.readClanStore() : null;
                if (store && store.submissions) {
                    const prev = store.submissions.find(s => String(s.user_id) === String(userId) && s.discord_username);
                    if (prev) targetUsername = prev.discord_username;
                }
            }

            if (targetUsername) {
                const memberId = await database.getMemberByDiscordUsername(targetUsername);
                if (memberId) {
                    const todayDateString = config.getTodayDateString();
                    const clanDesc = `PU-${clanId}-${todayDateString}`;
                    const generalDesc = `PU-${todayDateString}`;
                    const hasPoints = await database.checkDailyPointsAwarded(memberId, clanDesc) ||
                                      await database.checkDailyPointsAwarded(memberId, generalDesc);
                    if (hasPoints) {
                        // Automatically sync clan progress store
                        const clan = clanConfig.getClanById(clanId);
                        await this.recordSubmission({
                            userId: String(userId),
                            username: targetUsername,
                            memberId: memberId,
                            clanId: clanId,
                            clanName: clan?.name || clanId,
                            channelId: clan?.progressChannelId || '',
                            submissionDate: targetDate
                        });
                        return true;
                    }
                }
            }
        } catch (err) {
            console.warn('[ClanProgress] Fallback points check warning:', err.message);
        }

        return false;
    }

    /**
     * Records a successful clan progress submission.
     * 
     * @param {object} submissionData
     * @returns {Promise<boolean>}
     */
    async recordSubmission(submissionData) {
        const todayIST = submissionData.submissionDate || config.getISTDateString();
        return await database.recordClanProgress({
            userId: submissionData.userId,
            username: submissionData.username,
            memberId: submissionData.memberId,
            clanId: submissionData.clanId,
            clanName: submissionData.clanName,
            channelId: submissionData.channelId,
            submissionDate: todayIST,
            submissionStatus: 'completed',
            pointsAwarded: submissionData.pointsAwarded !== undefined ? submissionData.pointsAwarded : config.points.dailyAmount,
            streak: submissionData.streak || 1
        });
    }

    /**
     * Retrieves all submissions for a clan on a given date.
     * 
     * @param {string} clanId 
     * @param {string} dateString 
     * @returns {Promise<Array>}
     */
    async getClanDailySubmissions(clanId, dateString = null) {
        const targetDate = dateString || config.getISTDateString();
        return await database.getClanDailySubmissions(clanId, targetDate);
    }

    /**
     * Gets daily progress statistics for a clan.
     * 
     * @param {string} clanId 
     * @param {string} dateString 
     * @returns {Promise<object>}
     */
    async getClanStats(clanId, dateString = null) {
        const targetDate = dateString || config.getISTDateString();
        const submissions = await this.getClanDailySubmissions(clanId, targetDate);
        const clan = clanConfig.getClanById(clanId);

        return {
            clanId,
            clanName: clan?.name || clanId,
            date: targetDate,
            totalSubmissions: submissions.length,
            completedUserIds: submissions.map(s => s.user_id)
        };
    }

    /**
     * Clears a member's daily submission (useful for testing)
     * 
     * @param {string} clanId 
     * @param {string} userId 
     * @param {string} dateString 
     * @returns {Promise<boolean>}
     */
    async clearTodaySubmission(clanId, userId, dateString = null) {
        const targetDate = dateString || config.getISTDateString();
        return await database.clearClanProgress(clanId, userId, targetDate);
    }
}

module.exports = new ClanProgressService();
