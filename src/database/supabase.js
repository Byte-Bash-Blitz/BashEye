// src/database/supabase.js
const { createClient } = require('@supabase/supabase-js');
const config = require('../config/config');

class SupabaseService {
    constructor() {
        this.client = createClient(config.supabase.url, config.supabase.key);
    }

    // Member operations
    async getMemberByDiscordUsername(discordUsername) {
        try {
            const { data, error } = await this.client
                .from('members')
                .select('id')
                .eq('discord_username', discordUsername)
                .single();

            if (error) {
                console.error('Error fetching member:', error);
                return null;
            }

            return data?.id || null;
        } catch (error) {
            console.error('Error in getMemberByDiscordUsername:', error);
            return null;
        }
    }

    // Points operations
    async checkDailyPointsAwarded(memberId, description) {
        try {
            const { data, error } = await this.client
                .from('points')
                .select('id')
                .eq('member_id', memberId)
                .eq('organiser_id', config.points.organiserIdBot)
                .eq('description', description)
                .limit(1);

            if (error) {
                console.error('Error checking daily points:', error);
                return false;
            }

            return data && data.length > 0;
        } catch (error) {
            console.error('Error in checkDailyPointsAwarded:', error);
            return false;
        }
    }

    // Check for recent submissions (deployment-safe spam prevention)
    async checkRecentSubmission(memberId, minutesWindow = 2) {
        try {
            const windowStart = new Date();
            windowStart.setMinutes(windowStart.getMinutes() - minutesWindow);

            const { data, error } = await this.client
                .from('points')
                .select('id, updated_at')
                .eq('member_id', memberId)
                .eq('organiser_id', config.points.organiserIdBot)
                .gte('updated_at', windowStart.toISOString())
                .limit(1);

            if (error) {
                console.error('Error checking recent submissions:', error);
                return false;
            }

            const hasRecentSubmission = data && data.length > 0;
            if (hasRecentSubmission) {
                console.log(`Recent submission found within ${minutesWindow} minutes for member ${memberId}`);
            }
            
            return hasRecentSubmission;
        } catch (error) {
            console.error('Error in checkRecentSubmission:', error);
            return false;
        }
    }

    async awardPoints(memberId, points, description) {
        try {
            const { data, error } = await this.client
                .from('points')
                .insert({
                    member_id: memberId,
                    organiser_id: config.points.organiserIdBot,
                    points: points,
                    description: description
                });

            if (error) {
                console.error('Error inserting points:', error);
                return false;
            }

            return true;
        } catch (error) {
            console.error('Error in awardPoints:', error);
            return false;
        }
    }

    // Member stats operations
    async getMemberStats(memberId) {
        try {
            const { data, error } = await this.client
                .from('member_stats')
                .select('*')
                .eq('member_id', memberId)
                .single();

            if (error && error.code !== 'PGRST116') { // PGRST116 = no rows found
                console.error('Error fetching member stats:', error);
                return null;
            }

            return data;
        } catch (error) {
            console.error('Error in getMemberStats:', error);
            return null;
        }
    }

    async createMemberStats(memberId) {
        try {
            const { data, error } = await this.client
                .from('member_stats')
                .insert({
                    member_id: memberId,
                    discord_streak: 1,
                    last_updated_at: new Date().toISOString()
                })
                .select()
                .single();

            if (error) {
                console.error('Error creating member stats:', error);
                return null;
            }

            return data;
        } catch (error) {
            console.error('Error in createMemberStats:', error);
            return null;
        }
    }

    async updateDiscordStreak(memberId, newStreak) {
        try {
            const { data, error } = await this.client
                .from('member_stats')
                .update({
                    discord_streak: newStreak,
                    last_updated_at: new Date().toISOString()
                })
                .eq('member_id', memberId)
                .select()
                .single();

            if (error) {
                console.error('Error updating discord streak:', error);
                return null;
            }

            return data;
        } catch (error) {
            console.error('Error in updateDiscordStreak:', error);
            return null;
        }
    }

    async getStreakData(memberId) {
        try {
            // Get the last 30 days of points to calculate streak
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

            const { data, error } = await this.client
                .from('points')
                .select('description, updated_at')
                .eq('member_id', memberId)
                .eq('organiser_id', config.points.organiserIdBot)
                .like('description', 'PU-%')
                .gte('updated_at', thirtyDaysAgo.toISOString())
                .order('updated_at', { ascending: false });

            if (error) {
                console.error('Error fetching streak data:', error);
                return [];
            }

            return data || [];
        } catch (error) {
            console.error('Error in getStreakData:', error);
            return [];
        }
    }

    async getPointsByMember(memberId) {
        try {
            // Get the last 365 days of points for comprehensive streak calculation
            const oneYearAgo = new Date();
            oneYearAgo.setDate(oneYearAgo.getDate() - 365);

            const { data, error } = await this.client
                .from('points')
                .select('description, updated_at')
                .eq('member_id', memberId)
                .eq('organiser_id', config.points.organiserIdBot)
                .like('description', 'PU-%')
                .gte('updated_at', oneYearAgo.toISOString())
                .order('updated_at', { ascending: false });

            if (error) {
                console.error('Error fetching points by member:', error);
                return [];
            }

            return data || [];
        } catch (error) {
            console.error('Error in getPointsByMember:', error);
            return [];
        }
    }
}

module.exports = new SupabaseService();