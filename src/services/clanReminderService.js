// src/services/clanReminderService.js
const cron = require('node-cron');
const config = require('../config/config');
const clanConfig = require('../config/clanConfig');
const clanProgressService = require('./clanProgressService');

class ClanReminderService {
    constructor() {
        this.client = null;
        this.cronJobs = [];
        this.isRunning = false;
    }

    /**
     * Initialize scheduler with Discord client
     * @param {object} client Discord.js Client
     */
    initialize(client) {
        this.client = client;
        this.setupCronJobs();
        console.log('✅ Clan DM Reminder Service initialized');
    }

    /**
     * Sets up cron jobs for configured reminder times in IST
     */
    setupCronJobs() {
        if (!config.reminders.enabled) {
            console.log('ℹ️ Clan DM reminders are disabled in configuration');
            return;
        }

        const times = config.reminders.times || ['21:00', '23:00'];

        times.forEach(timeStr => {
            const [hourStr, minuteStr] = timeStr.split(':');
            const hour = parseInt(hourStr, 10);
            const minute = parseInt(minuteStr, 10);

            if (isNaN(hour) || isNaN(minute)) {
                console.warn(`⚠️ Invalid reminder time format: "${timeStr}", skipping`);
                return;
            }

            // node-cron pattern: minute hour * * *
            const cronExpression = `${minute} ${hour} * * *`;
            console.log(`⏰ Scheduling Clan DM reminder at ${timeStr} IST (${cronExpression})`);

            const job = cron.schedule(cronExpression, async () => {
                console.log(`\n🔔 Running scheduled Clan DM reminders for ${timeStr} IST...`);
                try {
                    await this.runReminders(this.client);
                } catch (err) {
                    console.error('❌ Error during scheduled reminder execution:', err);
                }
            }, {
                scheduled: true,
                timezone: 'Asia/Kolkata'
            });

            this.cronJobs.push(job);
        });
    }

    /**
     * Formats the clan-specific DM reminder message.
     * STRICTLY DM ONLY. Mentions the member's specific clan progress channel.
     * 
     * @param {object} clan Clan configuration object
     * @returns {string}
     */
    formatReminderMessage(clan) {
        return (
            `Hey! 👋\n` +
            `You haven't submitted your daily progress yet.\n\n` +
            `Please submit today's progress in the **${clan.name}** progress channel (<#${clan.progressChannelId}>).`
        );
    }

    /**
     * Executes the missing member detection and DM reminders
     * independently for each configured clan.
     * 
     * @param {object} client Discord client
     * @param {object} options Optional settings { dryRun: boolean, specificClanId: string, specificUserId: string }
     * @returns {Promise<object>} Summary of results per clan
     */
    async runReminders(client = this.client, options = {}) {
        if (!client) {
            console.error('❌ Discord client not available for clan reminders');
            return { error: 'NO_DISCORD_CLIENT' };
        }

        const dryRun = !!options.dryRun;
        const targetClanId = options.specificClanId ? options.specificClanId.toLowerCase() : null;
        const targetUserId = options.specificUserId || options.userId || null;
        const todayIST = config.getISTDateString();

        console.log(`📋 Starting independent Clan DM reminder check for ${todayIST} (Dry Run: ${dryRun}, User: ${targetUserId || 'all'})`);

        // Find the target guild
        let guild = options.guild || null;
        if (!guild && config.discord.guildId && client.guilds && client.guilds.cache) {
            guild = client.guilds.cache.get(config.discord.guildId);
        }
        if (!guild && client.guilds && client.guilds.cache && client.guilds.cache.size > 0) {
            guild = client.guilds.cache.first();
        }

        if (!guild) {
            console.warn('⚠️ No guild found to check clan members');
            return { error: 'NO_GUILD_FOUND' };
        }

        // Fetch all guild members to ensure accurate role detection
        try {
            await guild.members.fetch();
        } catch (fetchErr) {
            console.warn('⚠️ Could not fetch complete member list (will use cached members):', fetchErr.message);
        }

        const summary = {};

        // Run independently for each clan
        for (const [clanKey, clan] of Object.entries(clanConfig.CLANS)) {
            if (targetClanId && clanKey !== targetClanId && clan.id !== targetClanId) {
                continue;
            }

            summary[clan.id] = await this.processClanReminders(guild, clan, todayIST, dryRun, targetUserId);
        }

        console.log('✅ Completed Clan DM reminder check across all clans');
        return summary;
    }

    /**
     * Processes missing member detection and DMs for a single clan independently.
     * 
     * @param {object} guild Discord Guild
     * @param {object} clan Clan configuration
     * @param {string} todayIST Today's date YYYY-MM-DD
     * @param {boolean} dryRun If true, does not send actual DMs
     * @param {string|null} specificUserId Optional single member ID to target
     * @returns {Promise<object>}
     */
    async processClanReminders(guild, clan, todayIST, dryRun = false, specificUserId = null) {
        console.log(`\n🛡️ [Clan: ${clan.name}] Scanning tracked members...`);

        const clanSummary = {
            clanId: clan.id,
            clanName: clan.name,
            totalMembers: 0,
            completedMembers: 0,
            missingMembers: 0,
            remindersSent: 0,
            remindersFailed: 0,
            details: []
        };

        // Find all non-bot guild members who have this clan's role
        const allMembers = Array.from(guild.members.cache.values());
        const clanMembers = allMembers.filter(member => {
            if (member.user && member.user.bot) return false;
            if (specificUserId && member.id !== specificUserId && member.user?.id !== specificUserId) {
                return false;
            }
            if (member.roles && member.roles.cache && typeof member.roles.cache.has === 'function') {
                return member.roles.cache.has(clan.roleId);
            }
            if (Array.isArray(member.roles)) {
                return member.roles.includes(clan.roleId);
            }
            return false;
        });

        clanSummary.totalMembers = clanMembers.length;

        for (const member of clanMembers) {
            const detection = clanConfig.detectMemberClan(member);

            // If user has multiple conflicting clan roles, skip to avoid duplicate processing
            if (detection.error === 'MULTIPLE_CLAN_ROLES') {
                console.warn(`⚠️ [Clan Reminder] Member ${member.user.tag} has conflicting clan roles. Skipping.`);
                continue;
            }

            // Check if member already completed progress today for this clan
            const submitted = await clanProgressService.hasSubmittedToday(clan.id, member.id, todayIST, member.user?.username);

            if (submitted) {
                clanSummary.completedMembers++;
            } else {
                clanSummary.missingMembers++;
                const memberTag = member.user?.tag || member.user?.username || member.id;
                console.log(`⚠️ [Clan Reminder] Missing member detected: ${memberTag} (${member.id}) in ${clan.name}`);

                const reminderMessage = this.formatReminderMessage(clan);

                if (dryRun) {
                    console.log(`[Dry Run] Would send DM to ${memberTag} for ${clan.name}`);
                    clanSummary.remindersSent++;
                    clanSummary.details.push({ userId: member.id, tag: memberTag, status: 'dry_run' });
                } else {
                    try {
                        // Send DM ONLY
                        const targetRecipient = (member.user && typeof member.user.send === 'function') ? member.user : member;
                        await targetRecipient.send(reminderMessage);
                        console.log(`📨 [Clan Reminder] DM sent successfully to ${memberTag} (${clan.name})`);
                        clanSummary.remindersSent++;
                        clanSummary.details.push({ userId: member.id, tag: memberTag, status: 'sent' });
                    } catch (dmErr) {
                        // Safe error handling for disabled DMs
                        console.warn(`❌ [Clan Reminder] DM failed for ${memberTag} (${clan.name}): ${dmErr.message}. Member may have DMs closed.`);
                        clanSummary.remindersFailed++;
                        clanSummary.details.push({ userId: member.id, tag: memberTag, status: 'failed', error: dmErr.message });
                    }
                }
            }
        }

        console.log(`📊 [Clan: ${clan.name}] Summary: ${clanSummary.completedMembers} completed, ${clanSummary.missingMembers} missing, ${clanSummary.remindersSent} DMs sent, ${clanSummary.remindersFailed} DMs failed`);
        return clanSummary;
    }

    /**
     * Stop all scheduled cron jobs
     */
    stop() {
        this.cronJobs.forEach(job => job.stop());
        this.cronJobs = [];
        console.log('🛑 Clan DM Reminder Service stopped');
    }
}

module.exports = new ClanReminderService();
