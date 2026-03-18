// src/services/streakService.js
const database = require('../database/supabase');
const config = require('../config/config');

class StreakService {
    constructor() {
        this.dailyCutoffHour = config.timezone.cutoffHour;
        this.dailyCutoffMinute = config.timezone.cutoffMinute;
        this.dailyCutoffSecond = config.timezone.cutoffSecond;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Core: Incremental streak update — 2 DB calls, O(1)
    // ─────────────────────────────────────────────────────────────────────────

    async handleDailySubmission(memberId) {
        try {
            console.log(`🔄 Processing daily submission for member ${memberId}...`);

            const memberStats = await database.getMemberStats(memberId);
            const todayIST = config.getISTDateString(); // YYYY-MM-DD in IST

            if (!memberStats) {
                // Brand new member → start at 1
                console.log(`📝 New member ${memberId} — starting streak at 1`);
                await database.createMemberStats(memberId);
                return { currentStreak: 1, isNewRecord: false };
            }

            const oldStreak = memberStats.discord_streak || 0;
            const daysDiff = this._istDaysDiff(memberStats.last_updated_at, todayIST);

            let newStreak;
            if (daysDiff <= 1) {
                // daysDiff=0: last_updated_at is same IST day (old system artifact) — still count as new day
                // daysDiff=1: submitted yesterday — extend streak
                // The messageHandler's alreadyAwarded guard ensures we're never called twice in one day,
                // so daysDiff=0 here always means a stale timestamp from a previous system run, not a duplicate.
                newStreak = oldStreak + 1;
                console.log(`✅ Member ${memberId}: Streak ${oldStreak} → ${newStreak} (daysDiff=${daysDiff})`);
            } else {
                // Missed one or more days — reset
                newStreak = 1;
                console.log(`❌ Member ${memberId}: Missed ${daysDiff - 1} day(s). Streak reset to 1 (was ${oldStreak})`);
            }

            await database.updateDiscordStreak(memberId, newStreak);
            console.log(`📊 Streak updated for member ${memberId}: ${newStreak} days`);

            return {
                currentStreak: newStreak,
                isNewRecord: newStreak > oldStreak
            };
        } catch (error) {
            console.error('Error handling daily submission:', error);
            return { currentStreak: 0, isNewRecord: false };
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Returns the number of IST calendar days between the last submission
     * (UTC timestamp string) and today's IST date string (YYYY-MM-DD).
     */
    _istDaysDiff(lastUpdatedAt, todayISTString) {
        if (!lastUpdatedAt) return Infinity; // No prior submission → treat as very old

        const lastIST = config.convertToIST(new Date(lastUpdatedAt));
        const lastISTString = lastIST.toISOString().split('T')[0]; // YYYY-MM-DD

        const msPerDay = 24 * 60 * 60 * 1000;
        const diff = new Date(todayISTString).getTime() - new Date(lastISTString).getTime();
        return Math.round(diff / msPerDay);
    }

    async getStreakInfo(memberId) {
        try {
            const memberStats = await database.getMemberStats(memberId);
            if (!memberStats) return { currentStreak: 0, lastUpdated: null };
            return {
                currentStreak: memberStats.discord_streak || 0,
                lastUpdated: memberStats.last_updated_at
            };
        } catch (error) {
            console.error('Error getting streak info:', error);
            return { currentStreak: 0, lastUpdated: null };
        }
    }

    isNearDailyCutoff() {
        const now = config.getCurrentISTDate();
        const cutoffTime = new Date(now);
        cutoffTime.setUTCHours(this.dailyCutoffHour, this.dailyCutoffMinute, this.dailyCutoffSecond, 999);
        const twoHoursBefore = new Date(cutoffTime);
        twoHoursBefore.setUTCHours(twoHoursBefore.getUTCHours() - 2);
        return now >= twoHoursBefore && now <= cutoffTime;
    }

    getTimeUntilCutoff() {
        const now = config.getCurrentISTDate();
        const cutoffTime = new Date(now);
        cutoffTime.setUTCHours(this.dailyCutoffHour, this.dailyCutoffMinute, this.dailyCutoffSecond, 999);
        if (now > cutoffTime) cutoffTime.setUTCDate(cutoffTime.getUTCDate() + 1);
        const timeDiff = cutoffTime.getTime() - now.getTime();
        return {
            hours: Math.floor(timeDiff / (1000 * 60 * 60)),
            minutes: Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60)),
            cutoffTime
        };
    }
}

module.exports = new StreakService();