const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const config = require('../config/config');
const supabaseAuth = require('./supabaseAuth');

class SupabaseService {
    constructor() {
        // Keep fallback client for non-authenticated operations if needed
        this.fallbackClient = (config.supabase.url && config.supabase.key)
            ? createClient(config.supabase.url, config.supabase.key)
            : null;
        
        // Initialize authentication when service starts
        this.initializeAuth();
    }

    async initializeAuth() {
        try {
            console.log('🔐 Initializing bot user authentication...');
            await supabaseAuth.authenticate();
        } catch (error) {
            console.error('❌ Failed to initialize authentication:', error);
        }
    }

    async getClient(requireAuth = false) {
        // Ensure we're authenticated before returning client
        let isAuth = await supabaseAuth.ensureAuthenticated();
        if (!isAuth) {
            console.warn('⚠️ First authentication check failed, retrying authentication...');
            isAuth = await supabaseAuth.authenticate();
        }

        if (!isAuth) {
            if (requireAuth) {
                throw new Error('Supabase authentication failed: unable to obtain authenticated client');
            }
            console.error('❌ Failed to authenticate bot user, falling back to anon client');
            return this.fallbackClient;
        }
        return supabaseAuth.getAuthenticatedClient();
    }

    // Member operations
    async getMemberByDiscordUsername(discordUsername) {
        try {
            const normalizedUsername = typeof discordUsername === 'string' ? discordUsername.trim() : '';
            if (!normalizedUsername) {
                return null;
            }

            console.log(`Looking up member by Discord username "${normalizedUsername}"`);

            const client = await this.getClient();

            const fetchMember = async (filterBuilder) => {
                const { data, error } = await filterBuilder;

                if (error) {
                    console.error('Error fetching member:', error);
                    return null;
                }

                if (!data || data.length === 0) {
                    return null;
                }

                if (data.length > 1) {
                    console.warn(`⚠️ Multiple members matched Discord username "${normalizedUsername}". Using the first match.`);
                }

                return data[0]?.id || null;
            };

            const exactMatch = await fetchMember(
                client
                    .from('members')
                    .select('id')
                    .eq('discord_username', normalizedUsername)
                    .limit(2)
            );

            if (exactMatch) {
                console.log(`✅ Exact Discord username match found for "${normalizedUsername}"`);
                return exactMatch;
            }

            const caseInsensitiveMatch = await fetchMember(
                client
                    .from('members')
                    .select('id')
                    .ilike('discord_username', normalizedUsername)
                    .limit(2)
            );

            if (caseInsensitiveMatch) {
                console.warn(`⚠️ Matched Discord username "${normalizedUsername}" using case-insensitive lookup.`);
                return caseInsensitiveMatch;
            }

            console.warn(`⚠️ No Supabase member row matched Discord username "${normalizedUsername}"`);
            return null;
        } catch (error) {
            console.error('Error in getMemberByDiscordUsername:', error);
            return null;
        }
    }

    // Points operations
    async checkDailyPointsAwarded(memberId, description) {
        try {
            const client = await this.getClient(true).catch(() => this.getClient());
            const { data, error } = await client
                .from('points')
                .select('id')
                .eq('member_id', memberId)
                .eq('organiser_id', config.points.organiserIdBot)
                .eq('description', description)
                .limit(1);

            if (error) {
                console.error('Error checking daily points:', error);
                // If it's an auth error, re-auth and try once more
                if (error.code === '42501' || error.code === 'PGRST301') {
                    await supabaseAuth.authenticate();
                    const retryClient = await this.getClient(true);
                    const retry = await retryClient
                        .from('points')
                        .select('id')
                        .eq('member_id', memberId)
                        .eq('organiser_id', config.points.organiserIdBot)
                        .eq('description', description)
                        .limit(1);
                    return retry.data && retry.data.length > 0;
                }
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

            const client = await this.getClient(true).catch(() => this.getClient());
            const { data, error } = await client
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
        const maxAttempts = 3;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                // 1. Idempotency check: if points already awarded today, succeed immediately
                const alreadyAwarded = await this.checkDailyPointsAwarded(memberId, description);
                if (alreadyAwarded) {
                    console.log(`ℹ️ Points already awarded for member ${memberId} (${description}) — skipping insert`);
                    return true;
                }

                // 2. Ensure fresh authenticated client (never fallback to anon client for writes)
                const client = await this.getClient(true);

                console.log(`🏆 Awarding ${points} points to member ${memberId} (${description}) [Attempt ${attempt}/${maxAttempts}]...`);
                const { data, error } = await client
                    .from('points')
                    .insert({
                        member_id: memberId,
                        organiser_id: config.points.organiserIdBot,
                        points: points,
                        description: description
                    })
                    .select();

                if (error) {
                    console.error(`⚠️ Error inserting points on attempt ${attempt}:`, error);

                    // Check if error is related to authentication / permission / JWT expiry
                    const isAuthError = error.code === '42501' || 
                                        error.code === 'PGRST301' || 
                                        (error.message && (
                                            error.message.includes('JWT') ||
                                            error.message.includes('permission denied') ||
                                            error.message.includes('Unauthorized') ||
                                            error.message.includes('session')
                                        ));

                    if (isAuthError) {
                        console.log('🔄 Auth error detected during awardPoints, forcing re-authentication...');
                        await supabaseAuth.authenticate();
                    }

                    // Check if despite error, the row was actually inserted (e.g. duplicate or network drop after commit)
                    const verified = await this.checkDailyPointsAwarded(memberId, description);
                    if (verified) {
                        console.log(`✅ Verified points record exists for member ${memberId} despite insert response error.`);
                        return true;
                    }

                    if (attempt < maxAttempts) {
                        const delayMs = attempt * 800;
                        console.log(`⏳ Retrying awardPoints in ${delayMs}ms...`);
                        await new Promise(r => setTimeout(r, delayMs));
                        continue;
                    }
                    return false;
                }

                console.log(`✅ Successfully awarded ${points} points to member ${memberId} (${description})`);
                return true;
            } catch (err) {
                console.error(`⚠️ Exception in awardPoints on attempt ${attempt}:`, err.message || err);

                // Attempt re-auth in case session was corrupted or expired
                try {
                    await supabaseAuth.authenticate();
                } catch (reauthErr) {
                    console.error('Failed to re-authenticate during exception recovery:', reauthErr.message);
                }

                // Verify if the record was inserted before the exception
                try {
                    const verified = await this.checkDailyPointsAwarded(memberId, description);
                    if (verified) {
                        console.log(`✅ Verified points record exists for member ${memberId} despite exception.`);
                        return true;
                    }
                } catch (_) {}

                if (attempt < maxAttempts) {
                    const delayMs = attempt * 800;
                    console.log(`⏳ Retrying awardPoints in ${delayMs}ms...`);
                    await new Promise(r => setTimeout(r, delayMs));
                    continue;
                }
                return false;
            }
        }
        return false;
    }

    // Member stats operations
    async getMemberStats(memberId) {
        try {
            const client = await this.getClient();
            const { data, error } = await client
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
            const client = await this.getClient();
            const { data, error } = await client
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
            const client = await this.getClient();
            const { data, error } = await client
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

            const client = await this.getClient();
            const { data, error } = await client
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

            const client = await this.getClient();
            const { data, error } = await client
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

    // Award points with a custom (backdated) timestamp
    async awardPointsBackdated(memberId, points, description, backdatedTimestamp) {
        try {
            const client = await this.getClient();
            const { data, error } = await client
                .from('points')
                .insert({
                    member_id: memberId,
                    organiser_id: config.points.organiserIdBot,
                    points: points,
                    description: description,
                    updated_at: backdatedTimestamp
                })
                .select()
                .single();

            if (error) {
                console.error('Error inserting backdated points:', error);
                return false;
            }

            return true;
        } catch (error) {
            console.error('Error in awardPointsBackdated:', error);
            return false;
        }
    }

    // Update member_stats.last_updated_at to a specific timestamp (for streak restoration)
    async backdateLastUpdated(memberId, timestamp) {
        try {
            const client = await this.getClient();
            const { data, error } = await client
                .from('member_stats')
                .update({ last_updated_at: timestamp })
                .eq('member_id', memberId)
                .select()
                .single();

            if (error) {
                console.error('Error backdating last_updated_at:', error);
                return false;
            }

            return true;
        } catch (error) {
            console.error('Error in backdateLastUpdated:', error);
            return false;
        }
    }

    // Update the updated_at timestamp of an existing points row (Option D backdate)
    async updatePointsRowTimestamp(memberId, description, newTimestamp) {
        try {
            const client = await this.getClient();
            const { data, error } = await client
                .from('points')
                .update({ updated_at: newTimestamp })
                .eq('member_id', memberId)
                .eq('organiser_id', config.points.organiserIdBot)
                .eq('description', description)
                .select()
                .single();

            if (error) {
                console.error('Error updating points row timestamp:', error);
                return false;
            }

            return true;
        } catch (error) {
            console.error('Error in updatePointsRowTimestamp:', error);
            return false;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Clan Progress Operations (Multi-Clan Support)
    // ─────────────────────────────────────────────────────────────────────────

    getClanStoreFilePath() {
        const dir = path.join(__dirname, '../../data');
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        return path.join(dir, 'clan_progress.json');
    }

    readClanStore() {
        try {
            const filePath = this.getClanStoreFilePath();
            if (fs.existsSync(filePath)) {
                const data = fs.readFileSync(filePath, 'utf8');
                return JSON.parse(data);
            }
        } catch (err) {
            console.error('⚠️ Error reading clan_progress.json store:', err.message);
        }
        return { submissions: [] };
    }

    writeClanStore(store) {
        try {
            const filePath = this.getClanStoreFilePath();
            fs.writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf8');
            return true;
        } catch (err) {
            console.error('⚠️ Error writing clan_progress.json store:', err.message);
            return false;
        }
    }

    async recordClanProgress(progressData) {
        try {
            const record = {
                id: progressData.id || `cp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                user_id: String(progressData.userId),
                discord_username: progressData.username || null,
                member_id: progressData.memberId || null,
                clan_id: progressData.clanId,
                clan_name: progressData.clanName,
                progress_channel_id: String(progressData.channelId),
                submission_date: progressData.submissionDate,
                submission_status: progressData.submissionStatus || 'completed',
                points_awarded: progressData.pointsAwarded !== undefined ? progressData.pointsAwarded : config.points.dailyAmount,
                streak: progressData.streak || 1,
                created_at: progressData.createdAt || new Date().toISOString()
            };

            // 1. Update persistent local store
            const store = this.readClanStore();
            const existingIdx = store.submissions.findIndex(
                s => s.clan_id === record.clan_id && s.user_id === record.user_id && s.submission_date === record.submission_date
            );
            if (existingIdx >= 0) {
                store.submissions[existingIdx] = record;
            } else {
                store.submissions.push(record);
            }
            this.writeClanStore(store);

            // 2. Try recording to Supabase clan_progress table (if table exists)
            try {
                const client = await this.getClient();
                if (client) {
                    const { error } = await client
                        .from('clan_progress')
                        .upsert(record, { onConflict: 'clan_id,user_id,submission_date' });
                    if (error && error.code !== 'PGRST205') {
                        console.warn('⚠️ Supabase clan_progress notice:', error.message);
                    }
                }
            } catch (dbErr) {
                // Soft fail if Supabase schema does not have clan_progress yet
                console.warn('⚠️ Note: Remote Supabase clan_progress table not reachable; local store preserved.');
            }

            console.log(`💾 Recorded clan progress for ${record.discord_username || record.user_id} (${record.clan_name}) on ${record.submission_date}`);
            return true;
        } catch (error) {
            console.error('❌ Error recording clan progress:', error);
            return false;
        }
    }

    async hasClanSubmittedToday(clanId, userId, dateString) {
        try {
            const strUserId = String(userId);
            // 1. Check local persistent store first (fast & reliable)
            const store = this.readClanStore();
            const foundLocal = store.submissions.some(
                s => s.clan_id === clanId && s.user_id === strUserId && s.submission_date === dateString
            );
            if (foundLocal) return true;

            // 2. Check Supabase clan_progress
            try {
                const client = await this.getClient();
                if (client) {
                    const { data, error } = await client
                        .from('clan_progress')
                        .select('id')
                        .eq('clan_id', clanId)
                        .eq('user_id', strUserId)
                        .eq('submission_date', dateString)
                        .limit(1);

                    if (!error && data && data.length > 0) {
                        return true;
                    }
                }
            } catch (err) {
                // Ignore remote check failure
            }

            return false;
        } catch (error) {
            console.error('Error in hasClanSubmittedToday:', error);
            return false;
        }
    }

    async getClanDailySubmissions(clanId, dateString) {
        try {
            const store = this.readClanStore();
            const localMatches = store.submissions.filter(
                s => s.clan_id === clanId && s.submission_date === dateString
            );

            // Attempt remote fetch
            try {
                const client = await this.getClient();
                if (client) {
                    const { data, error } = await client
                        .from('clan_progress')
                        .select('*')
                        .eq('clan_id', clanId)
                        .eq('submission_date', dateString);

                    if (!error && data && data.length > 0) {
                        const userMap = new Map();
                        localMatches.forEach(item => userMap.set(item.user_id, item));
                        data.forEach(item => userMap.set(item.user_id, item));
                        return Array.from(userMap.values());
                    }
                }
            } catch (err) {
                // Ignore remote fetch error
            }

            return localMatches;
        } catch (error) {
            console.error('Error in getClanDailySubmissions:', error);
            return [];
        }
    }

    async clearClanProgress(clanId, userId, dateString) {
        try {
            const strUserId = String(userId);
            const store = this.readClanStore();
            const initialLength = store.submissions.length;
            store.submissions = store.submissions.filter(
                s => !(s.clan_id === clanId && s.user_id === strUserId && s.submission_date === dateString)
            );
            const removed = initialLength - store.submissions.length;
            this.writeClanStore(store);

            try {
                const client = await this.getClient();
                if (client) {
                    await client
                        .from('clan_progress')
                        .delete()
                        .eq('clan_id', clanId)
                        .eq('user_id', strUserId)
                        .eq('submission_date', dateString);
                }
            } catch (err) {
                // Ignore remote delete errors
            }

            console.log(`🧹 Cleared ${removed} submission(s) for user ${userId} in clan ${clanId} on ${dateString}`);
            return true;
        } catch (error) {
            console.error('Error in clearClanProgress:', error);
            return false;
        }
    }
}
module.exports = new SupabaseService();