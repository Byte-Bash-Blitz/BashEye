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
            const date = new Date(point.updated_at);
            const dateKey = date.toISOString().split('T')[0]; // YYYY-MM-DD format
            
            if (!dailySubmissions[dateKey]) {
                dailySubmissions[dateKey] = [];
            }
            dailySubmissions[dateKey].push(point);
        });

        return dailySubmissions;
    }

    calculateConsecutiveStreak(dailySubmissions) {
        const now = new Date();
        let streak = 0;
        let lastSubmissionTime = null;

        // Get all submission dates sorted in descending order
        const sortedDates = Object.keys(dailySubmissions).sort().reverse();
        
        console.log(`Checking streak with ${this.streakThresholdHours}-hour window...`);
        
        for (let i = 0; i < sortedDates.length; i++) {
            const dateKey = sortedDates[i];
            const submissions = dailySubmissions[dateKey];
            
            if (submissions && submissions.length > 0) {
                // Get the latest submission time for this date
                const latestSubmission = submissions.reduce((latest, current) => {
                    const currentTime = new Date(current.updated_at);
                    const latestTime = new Date(latest.updated_at);
                    return currentTime > latestTime ? current : latest;
                });
                
                const submissionTime = new Date(latestSubmission.updated_at);
                
                if (streak === 0) {
                    // First submission found - start the streak
                    streak = 1;
                    lastSubmissionTime = submissionTime;
                    console.log(`Starting streak from ${dateKey} at ${submissionTime.toISOString()}`);
                } else {
                    // Check if this submission is within the threshold window
                    const timeDiff = lastSubmissionTime.getTime() - submissionTime.getTime();
                    const hoursDiff = timeDiff / (1000 * 60 * 60);
                    
                    console.log(`Time difference: ${hoursDiff.toFixed(2)} hours (threshold: ${this.streakThresholdHours})`);
                    
                    if (hoursDiff <= this.streakThresholdHours) {
                        // Within threshold - continue streak
                        streak++;
                        lastSubmissionTime = submissionTime;
                        console.log(`Streak continued: ${streak} days`);
                    } else {
                        // Outside threshold - break streak
                        console.log(`Streak broken: ${hoursDiff.toFixed(2)} hours exceeds ${this.streakThresholdHours}-hour threshold`);
                        break;
                    }
                }
            }
        }

        // Check if the most recent submission is too old (beyond threshold from now)
        if (lastSubmissionTime) {
            const timeSinceLastSubmission = now.getTime() - lastSubmissionTime.getTime();
            const hoursSinceLastSubmission = timeSinceLastSubmission / (1000 * 60 * 60);
            
            if (hoursSinceLastSubmission > this.streakThresholdHours) {
                console.log(`Last submission was ${hoursSinceLastSubmission.toFixed(2)} hours ago - beyond ${this.streakThresholdHours}-hour window`);
                // Note: We don't reset streak to 0 here as they might post later today
                // The streak represents consecutive days they've posted, even if not recent
            }
        }

        console.log(`Final calculated streak with ${this.streakThresholdHours}-hour window: ${streak} days`);
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