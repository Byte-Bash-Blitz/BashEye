// src/services/streakService.js
const database = require('../database/supabase');

class StreakService {
    constructor() {
        this.streakThresholdHours = 25; // 25-hour window for daily posts
    }

    // Calculate current streak based on historical data
    async calculateStreak(memberId) {
        try {
            const pointsHistory = await database.getStreakData(memberId);
            
            if (!pointsHistory || pointsHistory.length === 0) {
                return 0;
            }

            // Group points by date (UTC)
            const dailySubmissions = this.groupPointsByDate(pointsHistory);
            
            // Calculate current streak
            const streak = this.calculateConsecutiveStreak(dailySubmissions);
            
            console.log(`Calculated streak for member ${memberId}: ${streak} days`);
            return streak;
        } catch (error) {
            console.error('Error calculating streak:', error);
            return 0;
        }
    }

    groupPointsByDate(pointsHistory) {
        const dailySubmissions = {};
        
        pointsHistory.forEach(point => {
            const date = new Date(point.created_at);
            const dateKey = date.toISOString().split('T')[0]; // YYYY-MM-DD format
            
            if (!dailySubmissions[dateKey]) {
                dailySubmissions[dateKey] = [];
            }
            dailySubmissions[dateKey].push(point);
        });

        return dailySubmissions;
    }

    calculateConsecutiveStreak(dailySubmissions) {
        const today = new Date();
        let streak = 0;
        let currentDate = new Date(today);

        // Start from today and work backwards
        while (true) {
            const dateKey = currentDate.toISOString().split('T')[0];
            
            if (dailySubmissions[dateKey] && dailySubmissions[dateKey].length > 0) {
                streak++;
                currentDate.setDate(currentDate.getDate() - 1);
            } else {
                // Check if we're looking at today - if no submission today, streak might still be valid
                const isToday = this.isSameDay(currentDate, today);
                const isYesterday = this.isSameDay(currentDate, new Date(today.getTime() - 24 * 60 * 60 * 1000));
                
                if (isToday || (isYesterday && streak === 0)) {
                    // No submission today, but check if we're still within the 25-hour window from yesterday
                    currentDate.setDate(currentDate.getDate() - 1);
                    continue;
                } else {
                    // Streak is broken
                    break;
                }
            }
        }

        return streak;
    }

    async updateStreak(memberId) {
        try {
            // Calculate current streak
            const currentStreak = await this.calculateStreak(memberId);
            
            // Get existing member stats
            let memberStats = await database.getMemberStats(memberId);
            
            if (!memberStats) {
                // Create new member stats record
                memberStats = await database.createMemberStats(memberId);
                return memberStats?.discord_streak || 1;
            } else {
                // Update existing record
                const updatedStats = await database.updateDiscordStreak(memberId, currentStreak);
                return updatedStats?.discord_streak || currentStreak;
            }
        } catch (error) {
            console.error('Error updating streak:', error);
            return 0;
        }
    }

    // Check if today's submission extends the streak
    async handleDailySubmission(memberId) {
        try {
            console.log(`🔄 Processing daily submission for member ${memberId}...`);
            
            // Force recalculation of streak based on all historical data
            const newStreak = await this.recalculateStreakFromHistory(memberId);
            
            console.log(`📊 Recalculated streak for member ${memberId}: ${newStreak} days`);
            
            // Return streak information for user feedback
            return {
                currentStreak: newStreak,
                isNewRecord: await this.isNewPersonalRecord(memberId, newStreak)
            };
        } catch (error) {
            console.error('Error handling daily submission:', error);
            return { currentStreak: 0, isNewRecord: false };
        }
    }

    // Force recalculation of streak from historical data (admin-friendly automation)
    async recalculateStreakFromHistory(memberId) {
        try {
            console.log(`🔍 Performing full streak recalculation for member ${memberId}...`);
            
            // Calculate current streak based on all historical data
            const currentStreak = await this.calculateStreak(memberId);
            
            // Get existing member stats
            let memberStats = await database.getMemberStats(memberId);
            
            if (!memberStats) {
                // Create new member stats record
                console.log(`📝 Creating new member stats record for member ${memberId}`);
                memberStats = await database.createMemberStats(memberId);
                return memberStats?.discord_streak || 1;
            } else {
                // Update existing record with recalculated streak
                const oldStreak = memberStats.discord_streak || 0;
                console.log(`📊 Updating streak from ${oldStreak} to ${currentStreak} for member ${memberId}`);
                const updatedStats = await database.updateDiscordStreak(memberId, currentStreak);
                return updatedStats?.discord_streak || currentStreak;
            }
        } catch (error) {
            console.error('Error recalculating streak from history:', error);
            return 0;
        }
    }

    async isNewPersonalRecord(memberId, currentStreak) {
        try {
            // For now, we'll assume this is based on the current streak
            // In the future, you might want to track historical max streaks
            return currentStreak > 0;
        } catch (error) {
            console.error('Error checking personal record:', error);
            return false;
        }
    }

    isSameDay(date1, date2) {
        return date1.toISOString().split('T')[0] === date2.toISOString().split('T')[0];
    }

    // Get streak information for a member
    async getStreakInfo(memberId) {
        try {
            const memberStats = await database.getMemberStats(memberId);
            
            if (!memberStats) {
                return {
                    currentStreak: 0,
                    lastUpdated: null
                };
            }

            return {
                currentStreak: memberStats.discord_streak || 0,
                lastUpdated: memberStats.last_updated_at
            };
        } catch (error) {
            console.error('Error getting streak info:', error);
            return { currentStreak: 0, lastUpdated: null };
        }
    }

    // Admin method: Force recalculation for any member (exposed for API use)
    async adminRecalculateStreak(memberId) {
        try {
            console.log(`🔧 Admin-triggered streak recalculation for member ${memberId}`);
            return await this.recalculateStreakFromHistory(memberId);
        } catch (error) {
            console.error('Error in admin streak recalculation:', error);
            return 0;
        }
    }
}

module.exports = new StreakService();