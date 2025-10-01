// src/services/streakService.js
const database = require('../database/supabase');
const config = require('../config/config');

class StreakService {
    constructor() {
        // Daily cutoff configuration (11:59 PM IST)
        this.dailyCutoffHour = config.timezone.cutoffHour;
        this.dailyCutoffMinute = config.timezone.cutoffMinute;
        this.dailyCutoffSecond = config.timezone.cutoffSecond;
    }

    // Calculate current streak based on historical data (using IST timezone)
    async calculateStreak(memberId) {
        try {
            console.log(`📊 Calculating streak for member ${memberId} using IST timezone...`);
            
            // Get all points records for this member
            const pointsRecords = await database.getPointsByMember(memberId);
            
            if (!pointsRecords || pointsRecords.length === 0) {
                console.log(`No points records found for member ${memberId}`);
                return 0;
            }

            // Group records by IST date (YYYY-MM-DD format)
            const dailySubmissions = {};
            pointsRecords.forEach(record => {
                // Convert UTC timestamp to IST date (using updated_at from points table)
                const recordDate = new Date(record.updated_at);
                const istDate = config.convertToIST(recordDate);
                const dateKey = istDate.toISOString().split('T')[0]; // YYYY-MM-DD format in IST
                
                if (!dailySubmissions[dateKey]) {
                    dailySubmissions[dateKey] = [];
                }
                dailySubmissions[dateKey].push(record);
            });

            console.log(`Found points records across ${Object.keys(dailySubmissions).length} different dates (IST)`);
            
            // Calculate consecutive streak from today backwards
            return this.calculateConsecutiveStreak(dailySubmissions);
        } catch (error) {
            console.error('Error calculating streak:', error);
            return 0;
        }
    }

    groupPointsByDate(pointsHistory) {
        const dailySubmissions = {};
        
        pointsHistory.forEach(point => {
            // Convert UTC timestamp to IST date
            const date = new Date(point.updated_at);
            const istDate = config.convertToIST(date);
            const dateKey = istDate.toISOString().split('T')[0]; // YYYY-MM-DD format in IST
            
            if (!dailySubmissions[dateKey]) {
                dailySubmissions[dateKey] = [];
            }
            dailySubmissions[dateKey].push(point);
        });

        return dailySubmissions;
    }

    calculateConsecutiveStreak(dailySubmissions) {
        const today = config.getCurrentISTDate();
        let streak = 0;
        let currentDate = new Date(today);

        console.log(`Checking streak with daily cutoff at 11:59 PM IST...`);
        
        // Start from today and work backwards, checking each day
        while (true) {
            const dateKey = currentDate.toISOString().split('T')[0]; // YYYY-MM-DD format in IST
            
            if (dailySubmissions[dateKey] && dailySubmissions[dateKey].length > 0) {
                // Found submission for this date - check if it was before midnight cutoff
                const submissions = dailySubmissions[dateKey];
                const validSubmission = submissions.some(submission => {
                    // Convert submission time to IST (using updated_at from points table)
                    const submissionTime = new Date(submission.updated_at);
                    const istSubmissionTime = config.convertToIST(submissionTime);
                    
                    // Create cutoff time for the submission date in IST
                    const cutoffTime = new Date(istSubmissionTime);
                    cutoffTime.setUTCHours(this.dailyCutoffHour, this.dailyCutoffMinute, this.dailyCutoffSecond, 999);
                    
                    // Check if submission was before the daily cutoff (11:59:59 PM IST)
                    return istSubmissionTime <= cutoffTime;
                });
                
                if (validSubmission) {
                    streak++;
                    console.log(`✅ Day ${dateKey}: Valid submission found (streak: ${streak})`);
                } else {
                    console.log(`❌ Day ${dateKey}: Submission found but after 11:59 PM cutoff - streak broken`);
                    break;
                }
            } else {
                // No submission found for this date
                const isToday = this.isSameDay(currentDate, today);
                
                if (isToday && streak === 0) {
                    // No submission today yet, but this could be the start
                    console.log(`📅 Today (${dateKey}): No submission yet, checking previous days...`);
                } else if (isToday) {
                    // Had streak going but no submission today - streak might continue if they post later
                    console.log(`📅 Today (${dateKey}): No submission yet, but streak continues (they can still post)`);
                } else {
                    // No submission on a past date - streak is broken
                    console.log(`❌ Day ${dateKey}: No submission found - streak broken`);
                    break;
                }
            }
            
            // Move to the previous day
            currentDate.setDate(currentDate.getDate() - 1);
            
            // Prevent infinite loop - only check last 365 days
            if (streak > 365) {
                console.log(`🎉 Streak limit reached: ${streak} days (stopping calculation)`);
                break;
            }
        }

        console.log(`Final calculated streak with daily 11:59 PM cutoff: ${streak} days`);
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

    // Check if current time is close to daily cutoff (within 2 hours) - IST
    isNearDailyCutoff() {
        const now = config.getCurrentISTDate();
        const cutoffTime = new Date(now);
        cutoffTime.setUTCHours(this.dailyCutoffHour, this.dailyCutoffMinute, this.dailyCutoffSecond, 999);
        
        const twoHoursBefore = new Date(cutoffTime);
        twoHoursBefore.setUTCHours(twoHoursBefore.getUTCHours() - 2);
        
        return now >= twoHoursBefore && now <= cutoffTime;
    }

    // Get time remaining until daily cutoff (IST)
    getTimeUntilCutoff() {
        const now = config.getCurrentISTDate();
        const cutoffTime = new Date(now);
        cutoffTime.setUTCHours(this.dailyCutoffHour, this.dailyCutoffMinute, this.dailyCutoffSecond, 999);
        
        // If current time is past cutoff, calculate for next day
        if (now > cutoffTime) {
            cutoffTime.setUTCDate(cutoffTime.getUTCDate() + 1);
        }
        
        const timeDiff = cutoffTime.getTime() - now.getTime();
        const hours = Math.floor(timeDiff / (1000 * 60 * 60));
        const minutes = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));
        
        return { hours, minutes, cutoffTime };
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