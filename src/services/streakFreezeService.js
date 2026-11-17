// src/services/streakFreezeService.js
const cron = require('node-cron');
const database = require('../database/supabase');
const config = require('../config/config');
const streakFreezeUtils = require('../utils/streakFreezeUtils');

class StreakFreezeService {
    constructor() {
        this.client = null;
        this.cronJob = null;
        this.isProcessing = false;
    }

    /**
     * Initialize scheduler with Discord client
     * @param {object} client Discord.js Client
     */
    initialize(client) {
        this.client = client;
        this.setupCronJob();

        // Run recovery check on startup in background
        setTimeout(async () => {
            try {
                console.log('🔄 Running initial Streak Freeze recovery check...');
                await this.processMissedDeadlines();
            } catch (err) {
                console.warn('⚠️ Streak Freeze startup check warning:', err.message);
            }
        }, 5000);

        console.log('✅ Monthly Streak Freeze Service initialized');
    }

    /**
     * Sets up cron job to run at daily progress cutoff / midnight IST (00:00 IST)
     */
    setupCronJob() {
        // Daily progress cutoff: runs at 00:00 IST every midnight
        const cronExpression = '0 0 * * *';
        console.log(`⏰ Scheduling Streak Freeze evaluation at 00:00 IST (${cronExpression})`);

        this.cronJob = cron.schedule(cronExpression, async () => {
            console.log('\n🛡️ Running scheduled Streak Freeze evaluation for passed deadline...');
            try {
                await this.processMissedDeadlines();
            } catch (err) {
                console.error('❌ Error during scheduled Streak Freeze evaluation:', err);
            }
        }, {
            scheduled: true,
            timezone: 'Asia/Kolkata'
        });
    }

    /**
     * Get the monthly Freeze status for a member in a calendar month.
     * @param {number|string} memberId
     * @param {Date|string} date
     * @returns {Promise<{ available: boolean, used: boolean, record: object|null, month: number, year: number }>}
     */
    async getFreezeStatus(memberId, date = null) {
        const { month, year } = streakFreezeUtils.getCalendarMonthAndYear(date);
        const record = await database.getStreakFreeze(memberId, month, year);

        if (!record) {
            // Unused in current month → exactly 1 freeze is available
            return {
                available: true,
                used: false,
                record: null,
                month,
                year
            };
        }

        return {
            available: record.status === 'available',
            used: record.status === 'used',
            record,
            month,
            year
        };
    }

    /**
     * Consumes the member's monthly Streak Freeze for a specific missed date.
     * @param {object} params { memberId, date, protectedStreak }
     * @returns {Promise<object>} The updated freeze record
     */
    async consumeFreeze({ memberId, date, protectedStreak }) {
        const { month, year } = streakFreezeUtils.getCalendarMonthAndYear(date);

        const freezeRecord = {
            memberId: Number(memberId),
            month,
            year,
            status: 'used',
            usedOn: date,
            protectedStreak: Number(protectedStreak)
        };

        const result = await database.recordStreakFreeze(freezeRecord);
        console.log(`🛡️ [Streak Freeze] Consumed freeze for member ${memberId} on ${date} (Protected streak: ${protectedStreak})`);
        return result;
    }

    /**
     * Checks if a specific date was protected by an activated Streak Freeze.
     * @param {number|string} memberId
     * @param {string} dateString YYYY-MM-DD in IST
     * @returns {Promise<boolean>}
     */
    async isDateProtected(memberId, dateString) {
        if (!memberId || !dateString) return false;
        return await database.isDateProtectedByFreeze(memberId, dateString);
    }

    /**
     * Checks whether a member submitted valid progress on a specific calendar date in IST.
     * @param {number|string} memberId
     * @param {string} dateString YYYY-MM-DD
     * @param {string|null} discordUserId
     * @returns {Promise<boolean>}
     */
    async hasSubmittedOnDate(memberId, dateString, discordUserId = null) {
        try {
            // 1. Check points table with dateString format PU-DDMon'YY
            const istDate = new Date(`${dateString}T12:00:00+05:30`);
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const formattedDateString = `${istDate.getUTCDate()}${months[istDate.getUTCMonth()]}'${istDate.getUTCFullYear().toString().slice(-2)}`;
            const pointDesc = `PU-${formattedDateString}`;

            const pointsAwarded = await database.checkDailyPointsAwarded(memberId, pointDesc);
            if (pointsAwarded) return true;

            // 2. Check clan progress store
            const clanStore = database.readClanStore ? database.readClanStore() : { submissions: [] };
            const foundInClan = clanStore.submissions.some(s => {
                const matchesMember = s.member_id && Number(s.member_id) === Number(memberId);
                const matchesUser = discordUserId && String(s.user_id) === String(discordUserId);
                return (matchesMember || matchesUser) && s.submission_date === dateString;
            });
            if (foundInClan) return true;

            // 3. Check streak data timestamps
            const streakData = await database.getStreakData(memberId);
            if (streakData && streakData.length > 0) {
                const foundInStreak = streakData.some(entry => {
                    if (!entry.updated_at) return false;
                    const entryIST = config.convertToIST(new Date(entry.updated_at));
                    const entryDateStr = config.getISTDateString(entryIST);
                    return entryDateStr === dateString;
                });
                if (foundInStreak) return true;
            }

            return false;
        } catch (err) {
            console.error(`Error checking submission for member ${memberId} on ${dateString}:`, err);
            return false;
        }
    }

    /**
     * Evaluates missed progress for a passed deadline date across all active streak members.
     * Activates freeze if available, or resets streak if already used.
     * 
     * @param {string|null} targetDate Optional target date YYYY-MM-DD (defaults to yesterday in IST)
     * @param {object} options Optional settings { dryRun: boolean, specificMemberId: number }
     * @returns {Promise<object>} Summary of actions taken
     */
    async processMissedDeadlines(targetDate = null, options = {}) {
        if (this.isProcessing) {
            console.log('⏳ Streak Freeze evaluation already in-progress, skipping concurrent run.');
            return { skipped: true, reason: 'CONCURRENT_RUN' };
        }

        this.isProcessing = true;

        try {
            const dateToEvaluate = targetDate || streakFreezeUtils.getYesterdayIST();
            const dryRun = !!options.dryRun;
            const targetMemberId = options.specificMemberId ? Number(options.specificMemberId) : null;

            console.log(`📋 [Streak Freeze] Evaluating missed progress for date: ${dateToEvaluate} (Dry run: ${dryRun})`);

            const summary = {
                date: dateToEvaluate,
                evaluated: 0,
                submitted: 0,
                freezesActivated: 0,
                streaksBroken: 0,
                details: []
            };

            // Get all members who had an active streak (> 0)
            let activeMembers = await database.getActiveStreakMembers();
            if (targetMemberId) {
                activeMembers = activeMembers.filter(m => Number(m.member_id) === targetMemberId);
            }

            summary.evaluated = activeMembers.length;

            for (const memberStat of activeMembers) {
                const memberId = Number(memberStat.member_id);
                const currentStreak = Number(memberStat.discord_streak || 0);

                if (currentStreak <= 0) {
                    continue; // No active streak to protect
                }

                // Check if date is already protected by freeze
                const alreadyProtected = await this.isDateProtected(memberId, dateToEvaluate);
                if (alreadyProtected) {
                    console.log(`ℹ️ Member ${memberId} already has an active Freeze for ${dateToEvaluate}.`);
                    continue;
                }

                // Check if member submitted progress on the target date
                const hasSubmitted = await this.hasSubmittedOnDate(memberId, dateToEvaluate);

                if (hasSubmitted) {
                    summary.submitted++;
                    continue;
                }

                // Member missed their required daily progress!
                console.log(`⚠️ Member ${memberId} missed daily progress on ${dateToEvaluate} with active streak: ${currentStreak}`);

                // Check if freeze is available for the calendar month of targetDate
                const freezeStatus = await this.getFreezeStatus(memberId, dateToEvaluate);

                if (freezeStatus.available) {
                    // 1. Activate Streak Freeze
                    if (!dryRun) {
                        await this.consumeFreeze({
                            memberId,
                            date: dateToEvaluate,
                            protectedStreak: currentStreak
                        });

                        // Preserve streak: currentStreak remains intact
                        // Send optional DM notification
                        await this.notifyMember(memberId, currentStreak);
                    }

                    summary.freezesActivated++;
                    summary.details.push({
                        memberId,
                        action: 'FREEZE_ACTIVATED',
                        protectedStreak: currentStreak,
                        date: dateToEvaluate
                    });
                } else {
                    // 2. Freeze already consumed this month → break streak
                    console.log(`❌ Member ${memberId} already used monthly Freeze for month ${freezeStatus.month}/${freezeStatus.year}. Streak broken.`);
                    if (!dryRun) {
                        await database.updateDiscordStreak(memberId, 0);
                    }

                    summary.streaksBroken++;
                    summary.details.push({
                        memberId,
                        action: 'STREAK_BROKEN',
                        oldStreak: currentStreak,
                        date: dateToEvaluate
                    });
                }
            }

            console.log(`📊 [Streak Freeze] Completed evaluation for ${dateToEvaluate}: ${summary.freezesActivated} frozen, ${summary.streaksBroken} broken, ${summary.submitted} submitted`);
            return summary;
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Sends an optional DM notification to the member when a Freeze activates.
     * @param {number} memberId
     * @param {number} protectedStreak
     */
    async notifyMember(memberId, protectedStreak) {
        if (!this.client) return;

        try {
            // Find Discord username for memberId
            const client = await database.getClient();
            const { data: memberData } = await client
                .from('members')
                .select('discord_username, user_id')
                .eq('id', memberId)
                .maybeSingle();

            if (!memberData) return;

            const message = streakFreezeUtils.formatFreezeNotification(protectedStreak);

            // Try sending DM via user_id or cached guild user
            let targetUser = null;
            if (memberData.user_id && this.client.users) {
                targetUser = await this.client.users.fetch(memberData.user_id).catch(() => null);
            }

            if (!targetUser && memberData.discord_username && this.client.users) {
                targetUser = this.client.users.cache.find(
                    u => u.username.toLowerCase() === memberData.discord_username.toLowerCase()
                );
            }

            if (targetUser && typeof targetUser.send === 'function') {
                await targetUser.send(message);
                console.log(`📨 [Streak Freeze] DM sent to ${memberData.discord_username} for streak ${protectedStreak}`);
            }
        } catch (dmErr) {
            console.warn(`⚠️ [Streak Freeze] Could not send DM to member ${memberId}:`, dmErr.message);
        }
    }

    /**
     * Stop the scheduled cron job
     */
    stop() {
        if (this.cronJob) {
            this.cronJob.stop();
            this.cronJob = null;
        }
    }
}

module.exports = new StreakFreezeService();
