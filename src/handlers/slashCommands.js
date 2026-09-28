// src/handlers/slashCommands.js
const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const database = require('../database/supabase');
const streakService = require('../services/streakService');
const config = require('../config/config');
const clanConfig = require('../config/clanConfig');
const clanProgressService = require('../services/clanProgressService');
const clanReminderService = require('../services/clanReminderService');

class SlashCommandHandler {
    constructor() {
        this.commands = new Map();
        this.setupCommands();
    }

    setupCommands() {
        // Help command
        this.commands.set('help', {
            data: new SlashCommandBuilder()
                .setName('help')
                .setDescription('Show help information about the bot'),
            async execute(interaction) {
                const embed = new EmbedBuilder()
                    .setColor('#0099ff')
                    .setTitle('🤖 BashEye Bot Help')
                    .setDescription('I help track your daily progress and maintain streaks!')
                    .addFields(
                        { 
                            name: '📈 Daily Progress', 
                            value: `• Post in basher-progress category with:\n• Screenshot/image attachment\n• At least ${config.points.minimumWords} words description\n• Earn ${config.points.dailyAmount} points daily!`, 
                            inline: false 
                        },
                        { 
                            name: '🔥 Streak System', 
                            value: '• Maintain daily posts to build streaks\n• Must post before 11:59 PM each day\n• Streaks persist across deployments', 
                            inline: false 
                        },
                        { 
                            name: '⚡ Commands', 
                            value: '• `/help` - Show this help message\n• `/streak` - Check your current streak\n• `/mystats` - View your detailed statistics', 
                            inline: false 
                        },
                        { 
                            name: '📋 Requirements', 
                            value: '• Must be registered in the system\n• Post in your own thread (thread owner only)\n• One progress post per day maximum', 
                            inline: false 
                        }
                    )
                    .setFooter({ text: 'Keep up the great progress! 🚀' })
                    .setTimestamp();

                await interaction.reply({ embeds: [embed], ephemeral: true });
            }
        });

        // Streak command
        this.commands.set('streak', {
            data: new SlashCommandBuilder()
                .setName('streak')
                .setDescription('Check your current streak')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('Check another user\'s streak (optional)')
                        .setRequired(false)
                ),
            execute: (interaction) => this.executeStreakCommand(interaction)
        });

        // My stats command
        this.commands.set('mystats', {
            data: new SlashCommandBuilder()
                .setName('mystats')
                .setDescription('View your detailed progress statistics'),
            execute: (interaction) => this.executeMystatsCommand(interaction)
        });

        // Ping command for testing
        this.commands.set('ping', {
            data: new SlashCommandBuilder()
                .setName('ping')
                .setDescription('Check bot latency and status'),
            execute: (interaction) => this.executePingCommand(interaction)
        });

        // Restore streak command (organizer only)
        this.commands.set('restore-streak', {
            data: new SlashCommandBuilder()
                .setName('restore-streak')
                .setDescription('🔧 [Organizer] Restore a member\'s missing streak day')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('The member whose streak to restore')
                        .setRequired(true)
                )
                .addIntegerOption(option =>
                    option.setName('streak')
                        .setDescription('The correct streak BEFORE today\'s post (e.g., 20)')
                        .setRequired(true)
                        .setMinValue(1)
                ),
            execute: (interaction) => this.executeRestoreStreakCommand(interaction)
        });

        // List streaks command (organizer only)
        this.commands.set('list-streaks', {
            data: new SlashCommandBuilder()
                .setName('list-streaks')
                .setDescription('🔧 [Organizer] List all members with >1 streak'),
            execute: (interaction) => this.executeListStreaksCommand(interaction)
        });

        // Force push / reminder test command - ONLY user and clan options as requested
        const forcePushOptions = (builder) => builder
            .addUserOption(option =>
                option.setName('user')
                    .setDescription('Member to check progress for (defaults to you)')
                    .setRequired(false)
            )
            .addStringOption(option =>
                option.setName('clan')
                    .setDescription('Clan name or ALL CLANS (optional, defaults to member\'s clan)')
                    .setRequired(false)
                    .addChoices(
                        { name: '🌟 ALL CLANS', value: 'all' },
                        { name: 'AURA 7F', value: 'aura7f' },
                        { name: 'BELMONT', value: 'belmont' },
                        { name: 'LUMINA', value: 'lumina' },
                        { name: 'SHADASTRIA', value: 'shadastria' }
                    )
            );

        this.commands.set('forcepush', {
            data: forcePushOptions(
                new SlashCommandBuilder()
                    .setName('forcepush')
                    .setDescription('🔔 Check daily progress and send DM reminder if not submitted')
            ),
            execute: (interaction) => this.executeForcePushCommand(interaction)
        });
    }

    async executeListStreaksCommand(interaction) {
        // ── 1. Organizer role check ──────────────────────────────────────────
        const hasRole = interaction.member.roles.cache.has(config.discord.organizerRoleId);
        if (!hasRole) {
            return await interaction.reply({ content: '🚫 Access Denied.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            const client = await database.getClient();
            const { data, error } = await client
                .from('member_stats')
                .select('discord_streak, members(discord_username)')
                .gt('discord_streak', 1);

            if (error) throw error;

            let message = "🔥 **Members with >1 Streak:**\n\n";
            data.forEach(item => {
                message += `• **${item.members.discord_username}**: ${item.discord_streak} days\n`;
            });

            await interaction.editReply({ content: message });
        } catch (error) {
            console.error('Error in list-streaks:', error);
            await interaction.editReply({ content: '❌ Error fetching streaks.' });
        }
    }

    getStreakStatusMessage(streak) {
        if (streak === 0) return '😴 No streak yet - start posting daily!';
        if (streak === 1) return '🌱 Just getting started!';
        if (streak < 3) return '🔥 Building momentum!';
        if (streak < 7) return '💪 Keep it up!';
        if (streak < 14) return '🏆 Amazing consistency!';
        if (streak < 30) return '⭐ Streak master!';
        return '🚀 Legendary dedication!';
    }

    getProgressStatusMessage(streak, daysActive) {
        const consistency = daysActive >= 20 ? 'Exceptional' : 
                          daysActive >= 15 ? 'Great' : 
                          daysActive >= 10 ? 'Good' : 
                          daysActive >= 5 ? 'Getting Started' : 'New';
        
        return `${consistency} consistency with ${streak} day streak! 🎯`;
    }

    // Command execution methods with proper context
    async executeStreakCommand(interaction) {
        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        } catch (deferErr) {
            if (deferErr.code === 10062) return;
            throw deferErr;
        }

        const targetUser = interaction.options.getUser('user') || interaction.user;
        const username = targetUser.username;

        try {
            // Get member ID from database
            const memberId = await database.getMemberByDiscordUsername(username);
            if (!memberId) {
                await interaction.editReply({ 
                    content: `❌ **Member Not Found**\n\n${username} is not registered in our system yet.\n\n*Please contact an administrator to register.*`
                });
                return;
            }

            // Get streak information
            const streakInfo = await streakService.getStreakInfo(memberId);

            const embed = new EmbedBuilder()
                .setColor(streakInfo.currentStreak >= 7 ? '#FFD700' : streakInfo.currentStreak >= 3 ? '#FF6B35' : '#4ECDC4')
                .setTitle(`🔥 Streak Information for ${username}`)
                .addFields(
                    { 
                        name: '📊 Current Streak', 
                        value: `**${streakInfo.currentStreak} day${streakInfo.currentStreak !== 1 ? 's' : ''}**`, 
                        inline: true 
                    },
                    { 
                        name: '📅 Last Updated', 
                        value: streakInfo.lastUpdated ? 
                            new Date(streakInfo.lastUpdated).toLocaleDateString() : 
                            'Never', 
                        inline: true 
                    },
                    { 
                        name: '💡 Status', 
                        value: this.getStreakStatusMessage(streakInfo.currentStreak),
                        inline: false
                    }
                )
                .setFooter({ text: 'Keep posting daily to maintain your streak! 🚀' })
                .setTimestamp();

            if (targetUser.id !== interaction.user.id) {
                embed.setDescription(`Streak information for ${targetUser.toString()}`);
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Error in streak command:', error);
            await interaction.editReply({ 
                content: '❌ **Error**\n\nThere was an error retrieving streak information. Please try again later.'
            });
        }
    }

    async executeMystatsCommand(interaction) {
        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        } catch (deferErr) {
            if (deferErr.code === 10062) return;
            throw deferErr;
        }

        const username = interaction.user.username;

        try {
            // Get member ID from database
            const memberId = await database.getMemberByDiscordUsername(username);
            if (!memberId) {
                await interaction.editReply({ 
                    content: `❌ **Member Not Found**\n\nYou are not registered in our system yet.\n\n*Please contact an administrator to register your Discord account.*`
                });
                return;
            }

            // Get comprehensive stats
            const streakInfo = await streakService.getStreakInfo(memberId);
            const recentPoints = await database.getStreakData(memberId);

            // Calculate total points from recent data
            const totalRecentPoints = recentPoints.reduce((sum, point) => sum + (point.points || config.points.dailyAmount), 0);
            const daysActive = recentPoints.length;

            const embed = new EmbedBuilder()
                .setColor('#9B59B6')
                .setTitle(`📊 Progress Statistics for ${username}`)
                .setThumbnail(interaction.user.displayAvatarURL())
                .addFields(
                    { 
                        name: '🔥 Current Streak', 
                        value: `**${streakInfo.currentStreak} day${streakInfo.currentStreak !== 1 ? 's' : ''}**`, 
                        inline: true 
                    },
                    { 
                        name: '📈 Days Active (30d)', 
                        value: `**${daysActive} days**`, 
                        inline: true 
                    },
                    { 
                        name: '💰 Points Earned (30d)', 
                        value: `**${totalRecentPoints} points**`, 
                        inline: true 
                    },
                    { 
                        name: '📅 Last Activity', 
                        value: streakInfo.lastUpdated ? 
                            new Date(streakInfo.lastUpdated).toLocaleDateString() : 
                            'No recent activity', 
                        inline: true 
                    },
                    { 
                        name: '⚡ Daily Points', 
                        value: `**${config.points.dailyAmount} points**`, 
                        inline: true 
                    },
                    { 
                        name: '📝 Word Requirement', 
                        value: `**${config.points.minimumWords}+ words**`, 
                        inline: true 
                    },
                    { 
                        name: '🎯 Progress Status', 
                        value: this.getProgressStatusMessage(streakInfo.currentStreak, daysActive),
                        inline: false
                    }
                )
                .setFooter({ text: 'Keep up the amazing progress! 🌟' })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('Error in mystats command:', error);
            await interaction.editReply({ 
                content: '❌ **Error**\n\nThere was an error retrieving your statistics. Please try again later.'
            });
        }
    }

    async executeRestoreStreakCommand(interaction) {
        // ── 1. Organizer role check ──────────────────────────────────────────
        const member = interaction.member;
        const hasRole = member.roles.cache.has(config.discord.organizerRoleId);
        if (!hasRole) {
            await interaction.reply({
                content: '🚫 **Access Denied**\nOnly organizers can use this command.',
                ephemeral: true
            });
            return;
        }

        await interaction.deferReply();

        const targetUser = interaction.options.getUser('user');
        const targetStreak = interaction.options.getInteger('streak');
        const username = targetUser.username;

        try {
            // ── 2. Resolve member ID ─────────────────────────────────────────
            const memberId = await database.getMemberByDiscordUsername(username);
            if (!memberId) {
                await interaction.editReply({
                    content: `❌ **Member Not Found**\n\n\`${username}\` is not registered in the system.`
                });
                return;
            }

            // ── 3. Compute targeted date strings (Today, Yesterday, 2 days ago)
            const todayIST = config.convertToIST(new Date());
            const todayISTString = todayIST.toISOString().split('T')[0];
            // By default, if we award points now, we just use a recent UTC timestamp
            const nowUTC = new Date().toISOString();

            const yesterdayIST = new Date(todayIST.getTime());
            yesterdayIST.setUTCDate(yesterdayIST.getUTCDate() - 1);
            const yesterdayISTString = yesterdayIST.toISOString().split('T')[0]; // YYYY-MM-DD
            // Yesterday's backdated timestamp set to 14:30 UTC = 20:00 IST
            const yesterdayUTC = new Date(`${yesterdayISTString}T14:30:00.000Z`);

            const twoDaysAgoIST = new Date(todayIST.getTime());
            twoDaysAgoIST.setUTCDate(twoDaysAgoIST.getUTCDate() - 2);

            const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

            // ── 4. Verify 1-day gap (or if we already restored yesterday) ────
            const twoDaysAgoDescription = `PU-${twoDaysAgoIST.getUTCDate()}${months[twoDaysAgoIST.getUTCMonth()]}'${twoDaysAgoIST.getUTCFullYear().toString().slice(-2)}`;
            const hasTwoDaysAgoPoints = await database.checkDailyPointsAwarded(memberId, twoDaysAgoDescription);

            if (!hasTwoDaysAgoPoints) {
                await interaction.editReply({
                    content: `❌ **Restore Failed:** \`${username}\` missed more than 1 day (No points found for \`${twoDaysAgoDescription}\`). You can only restore streaks with exactly a 1-day gap.`
                });
                return;
            }

            // ── 5. Fix Out-of-Order Logs (If user posted today but missed yesterday)
            const todayDescription = `PU-${todayIST.getUTCDate()}${months[todayIST.getUTCMonth()]}'${todayIST.getUTCFullYear().toString().slice(-2)}`;
            const missedDayDescription = `PU-${yesterdayIST.getUTCDate()}${months[yesterdayIST.getUTCMonth()]}'${yesterdayIST.getUTCFullYear().toString().slice(-2)}`;

            const hasTodayPoints = await database.checkDailyPointsAwarded(memberId, todayDescription);
            const alreadyHasMissedPoints = await database.checkDailyPointsAwarded(memberId, missedDayDescription);

            // If they posted today, but actually missed yesterday...
            // We must rewrite today's points into yesterday's slot to preserve chronological order,
            // then award them fresh points for today.
            if (hasTodayPoints && !alreadyHasMissedPoints) {
                // Change the existing "Today" row to "Yesterday" with yesterday's timestamp
                await database.getClient().then(client => 
                    client.from('points')
                          .update({ description: missedDayDescription, updated_at: yesterdayUTC.toISOString() })
                          .eq('member_id', memberId)
                          .eq('description', todayDescription)
                );
                
                // Now give them their points for Today back, using the current timestamp
                await database.awardPointsBackdated(
                    memberId,
                    config.points.dailyAmount,
                    todayDescription,
                    nowUTC
                );

                // Update their last stat timestamp to Right Now since they effectively posted today
                await database.backdateLastUpdated(memberId, nowUTC);
            } else if (!alreadyHasMissedPoints) {
                // They didn't post today either, so just directly fill yesterday's gap
                await database.awardPointsBackdated(
                    memberId,
                    config.points.dailyAmount,
                    missedDayDescription,
                    yesterdayUTC.toISOString()
                );
                
                // Backdate last_updated_at to yesterday so today is still pending
                await database.backdateLastUpdated(memberId, yesterdayUTC.toISOString());
            }

            // ── 6. Set the streak to exactly what the organizer requested
            await database.updateDiscordStreak(memberId, targetStreak);

            console.log(`🔧 Organizer ${interaction.user.username} restored streak for ${username} to ${targetStreak} days.`);

            // ── 7. Confirmation message as requested ──────────────────────────
            await interaction.editReply({
                content: `streak restored by organizer ${interaction.user.toString()} and post todays progress for maintain todays progress ${targetUser.toString()}`
            });
        } catch (error) {
            console.error('Error in restore-streak command:', error);
            await interaction.editReply({
                content: '❌ An error occurred while restoring the streak. Please try again.'
            });
        }
    }


    async executePingCommand(interaction) {
        const sent = await interaction.reply({ content: '🏓 Pinging...', fetchReply: true, ephemeral: true });
        const latency = sent.createdTimestamp - interaction.createdTimestamp;
        const apiLatency = Math.round(interaction.client.ws.ping);

        const embed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('🏓 Pong!')
            .addFields(
                { name: '📡 Bot Latency', value: `${latency}ms`, inline: true },
                { name: '💻 API Latency', value: `${apiLatency}ms`, inline: true },
                { name: '✅ Status', value: 'Online & Ready', inline: true }
            )
            .setTimestamp();

        await interaction.editReply({ content: null, embeds: [embed] });
    }

    async executeForcePuchCommand(interaction) {
        return this.executeForcePushCommand(interaction);
    }

    async executeForcePushCommand(interaction) {
        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        } catch (deferErr) {
            if (deferErr.code === 10062) return;
            throw deferErr;
        }

        try {
            const action = (interaction.options && typeof interaction.options.getString === 'function' ? interaction.options.getString('action') : null);
            const rawUserOption = (interaction.options && typeof interaction.options.getUser === 'function' ? interaction.options.getUser('user') : null);
            const targetUser = rawUserOption || interaction.user;
            const clanOption = (interaction.options && typeof interaction.options.getString === 'function' ? interaction.options.getString('clan') : null);
            const customStreak = (interaction.options && typeof interaction.options.getInteger === 'function' ? interaction.options.getInteger('streak') : null);
            const customPoints = (interaction.options && typeof interaction.options.getInteger === 'function' ? interaction.options.getInteger('points') : null);
            const todayIST = config.getISTDateString();

            const isAllClans = !!(clanOption && ['all', 'all_clans', 'all clan', 'all clans', 'allclans'].includes(clanOption.toLowerCase()));

            // 1. Optional test support for clear action if explicitly requested via code/options
            if (action === 'clear') {
                if (clanOption && !isAllClans) {
                    const singleClan = clanConfig.getClanById(clanOption) || clanConfig.CLANS.aura7f;
                    await clanProgressService.clearTodaySubmission(singleClan.id, targetUser.id, todayIST);
                } else {
                    for (const clan of Object.values(clanConfig.CLANS)) {
                        await clanProgressService.clearTodaySubmission(clan.id, targetUser.id, todayIST);
                    }
                }

                const embed = new EmbedBuilder()
                    .setColor('#FFA500')
                    .setTitle('🧪 [Force Clear] Progress Reset for Testing')
                    .setDescription(`Cleared progress record for ${targetUser.toString()} on **${todayIST}**.\nYou can now test daily progress checks or DM reminders.`)
                    .addFields(
                        { name: '👤 Target User', value: `${targetUser.username} (<@${targetUser.id}>)`, inline: true },
                        { name: '🛡️ Clan Scope', value: (clanOption && !isAllClans) ? (clanConfig.getClanById(clanOption)?.name || clanOption) : 'All 4 Clans', inline: true },
                        { name: '📅 Date', value: todayIST, inline: true }
                    )
                    .setTimestamp();

                return await interaction.editReply({ embeds: [embed] });
            }

            // 2. ALL CLANS WORKFLOW: Scans all 4 clans (or checks target user across all 4 clans)
            if (isAllClans && action !== 'punch') {
                // Case A: All clans across all tracked members (no specific user)
                if (!rawUserOption) {
                    const summary = await clanReminderService.runReminders(interaction.client, {
                        guild: interaction.guild,
                        dryRun: false
                    });

                    if (summary.error) {
                        return await interaction.editReply({
                            content: `❌ Could not run all-clan check: ${summary.error}`
                        });
                    }

                    let totalTracked = 0;
                    let totalCompleted = 0;
                    let totalMissing = 0;
                    let totalSent = 0;
                    let totalFailed = 0;

                    const embed = new EmbedBuilder()
                        .setColor('#5865F2')
                        .setTitle('🌟 [All Clans] Daily Progress Check & DM Reminders')
                        .setDescription(
                            `Scanned all 4 clans for **${todayIST}**.\n` +
                            `DM reminders have been dispatched to members who haven't submitted today's progress.`
                        )
                        .setTimestamp()
                        .setFooter({ text: 'BashEye Multi-Clan Progress System' });

                    for (const clan of Object.values(clanConfig.CLANS)) {
                        const clanRes = summary[clan.id] || { totalMembers: 0, completedMembers: 0, missingMembers: 0, remindersSent: 0, remindersFailed: 0, details: [] };
                        totalTracked += clanRes.totalMembers;
                        totalCompleted += clanRes.completedMembers;
                        totalMissing += clanRes.missingMembers;
                        totalSent += clanRes.remindersSent;
                        totalFailed += clanRes.remindersFailed;

                        let clanStatusText = `👥 **Tracked:** ${clanRes.totalMembers}\n` +
                            `✅ **Submitted:** ${clanRes.completedMembers}\n` +
                            `⏳ **Missing:** ${clanRes.missingMembers}\n` +
                            `📬 **DMs Sent:** ${clanRes.remindersSent}` + (clanRes.remindersFailed > 0 ? ` (${clanRes.remindersFailed} failed)` : '');

                        if (clanRes.totalMembers === 0) {
                            clanStatusText += `\n*No members tracked in role*`;
                        } else if (clanRes.missingMembers === 0) {
                            clanStatusText += `\n🎉 *All members completed!*`;
                        } else if (clanRes.details && clanRes.details.length > 0) {
                            const remindedTags = clanRes.details.map(d => `<@${d.userId}>`).slice(0, 5).join(', ');
                            const overflow = clanRes.details.length > 5 ? ` +${clanRes.details.length - 5} more` : '';
                            clanStatusText += `\n🔔 **Reminded:** ${remindedTags}${overflow}`;
                        }

                        embed.addFields({
                            name: `🛡️ ${clan.name} (<#${clan.progressChannelId}>)`,
                            value: clanStatusText,
                            inline: true
                        });
                    }

                    embed.addFields({
                        name: '📊 Overall Progress Summary',
                        value: `• **Total Members Tracked:** ${totalTracked}\n` +
                               `• **Completed Today:** ${totalCompleted}\n` +
                               `• **Pending / Missing:** ${totalMissing}\n` +
                               `• **DM Reminders Sent:** ${totalSent}` + (totalFailed > 0 ? ` (${totalFailed} failed)` : ''),
                        inline: false
                    });

                    return await interaction.editReply({ embeds: [embed] });
                }

                // Case B: All clans check for a specific target member (e.g. /forcepush clan:all user:@zenitzu)
                let targetMember = null;
                if (interaction.member && interaction.member.user && interaction.member.user.id === targetUser.id) {
                    targetMember = interaction.member;
                } else if (interaction.guild && interaction.guild.members) {
                    try {
                        targetMember = interaction.guild.members.cache.get(targetUser.id) || await interaction.guild.members.fetch(targetUser.id);
                    } catch (err) {
                        targetMember = interaction.member;
                    }
                }

                // Detect member's primary/assigned clan
                let assignedClan = null;
                if (targetMember) {
                    const detected = clanConfig.detectMemberClan(targetMember);
                    if (detected.clan) {
                        assignedClan = detected.clan;
                    }
                }

                const clanStatuses = [];
                for (const clan of Object.values(clanConfig.CLANS)) {
                    let hasRole = false;
                    if (targetMember && targetMember.roles && targetMember.roles.cache && typeof targetMember.roles.cache.has === 'function') {
                        hasRole = targetMember.roles.cache.has(clan.roleId);
                    } else if (targetMember && Array.isArray(targetMember.roles)) {
                        hasRole = targetMember.roles.includes(clan.roleId);
                    }

                    const hasSubmitted = await clanProgressService.hasSubmittedToday(clan.id, targetUser.id, todayIST, targetUser.username);
                    clanStatuses.push({
                        clan,
                        hasRole,
                        hasSubmitted
                    });
                }

                const primaryClan = assignedClan || (clanStatuses.find(s => s.hasRole)?.clan) || clanConfig.CLANS.aura7f;
                const primaryStatus = clanStatuses.find(s => s.clan.id === primaryClan.id);

                let dmSent = false;
                let dmError = null;
                let reminderMsg = null;

                if (primaryStatus && !primaryStatus.hasSubmitted) {
                    reminderMsg = clanReminderService.formatReminderMessage(primaryClan);
                    try {
                        await targetUser.send(reminderMsg);
                        dmSent = true;
                    } catch (dmErr) {
                        dmError = dmErr.message;
                    }
                }

                const embed = new EmbedBuilder()
                    .setColor(primaryStatus?.hasSubmitted ? '#00FF7F' : (dmSent ? '#5865F2' : '#ED4245'))
                    .setTitle(`🌟 [All Clans] Progress Check: ${targetUser.username}`)
                    .setDescription(
                        `Checked **${targetUser.username}** (<@${targetUser.id}>) across all 4 clans for **${todayIST}**.\n\n` +
                        (primaryStatus?.hasSubmitted
                            ? `✅ **Already submitted today's progress for ${primaryClan.name}!** No DM reminder needed.`
                            : dmSent
                                ? `📨 **DM reminder was sent to ${targetUser.toString()} for ${primaryClan.name}!**`
                                : `❌ **Pending submission for ${primaryClan.name}, but DM failed:** ${dmError || 'DMs closed'}`)
                    )
                    .setTimestamp()
                    .setFooter({ text: 'BashEye Multi-Clan Progress System' });

                for (const status of clanStatuses) {
                    const isAssigned = (assignedClan && status.clan.id === assignedClan.id) || status.hasRole;
                    const statusText = status.hasSubmitted
                        ? '✅ Submitted'
                        : (isAssigned ? '⏳ Missing (Pending)' : '⚪ Not in Clan');

                    embed.addFields({
                        name: `🛡️ ${status.clan.name}`,
                        value: `**Status:** ${statusText}\n**Channel:** <#${status.clan.progressChannelId}>\n**Role:** ${isAssigned ? 'Assigned' : 'None'}`,
                        inline: true
                    });
                }

                embed.addFields({
                    name: '📬 DM Delivery Status',
                    value: primaryStatus?.hasSubmitted
                        ? '⏭️ Not Needed (Already submitted)'
                        : (dmSent ? '✅ Delivered to user DMs' : `❌ Failed (${dmError || 'Closed DMs'})`),
                    inline: false
                });

                if (reminderMsg && dmSent) {
                    embed.addFields({
                        name: '📝 Message Sent',
                        value: `\`\`\`\n${reminderMsg}\n\`\`\``,
                        inline: false
                    });
                }

                return await interaction.editReply({ embeds: [embed] });
            }

            // Fetch target member context if available
            let targetMember = null;
            if (interaction.member && interaction.member.user && interaction.member.user.id === targetUser.id) {
                targetMember = interaction.member;
            } else if (interaction.guild && interaction.guild.members) {
                try {
                    targetMember = interaction.guild.members.cache.get(targetUser.id) || await interaction.guild.members.fetch(targetUser.id);
                } catch (err) {
                    targetMember = interaction.member;
                }
            }

            // Resolve target clan for single clan check or punch
            let targetClan = null;
            let clanSource = 'role';
            if (clanOption && !isAllClans) {
                targetClan = clanConfig.getClanById(clanOption);
                clanSource = 'option';
            } else if (targetMember) {
                const detected = clanConfig.detectMemberClan(targetMember);
                if (detected.clan) {
                    targetClan = detected.clan;
                    clanSource = `role (${targetClan.name})`;
                }
            }

            // Fallback to AURA 7F if user has no clan assigned yet
            if (!targetClan) {
                targetClan = clanConfig.CLANS.aura7f;
                clanSource = 'default (AURA 7F)';
            }

            // 3. Optional test support for punch action if explicitly requested via code/options
            if (action === 'punch') {
                const pointsToAward = (customPoints !== null && customPoints !== undefined) ? customPoints : config.points.dailyAmount;

                let memberId = null;
                let currentStreak = 1;
                try {
                    memberId = await database.getMemberByDiscordUsername(targetUser.username);
                    if (memberId) {
                        const dateString = config.getTodayDateString();
                        const description = `PU-${targetClan.id}-${dateString}`;
                        await database.awardPoints(memberId, pointsToAward, description);
                        if (customStreak !== null && customStreak !== undefined) {
                            await database.updateDiscordStreak(memberId, customStreak);
                            currentStreak = customStreak;
                        } else {
                            const streakInfo = await streakService.handleDailySubmission(memberId);
                            currentStreak = streakInfo.currentStreak || 1;
                        }
                    } else if (customStreak !== null && customStreak !== undefined) {
                        currentStreak = customStreak;
                    }
                } catch (dbErr) {
                    console.warn('[ForcePunch] Database record warning:', dbErr.message);
                    if (customStreak !== null && customStreak !== undefined) currentStreak = customStreak;
                }

                await clanProgressService.recordSubmission({
                    userId: targetUser.id,
                    username: targetUser.username,
                    memberId: memberId,
                    clanId: targetClan.id,
                    clanName: targetClan.name,
                    channelId: targetClan.progressChannelId,
                    submissionDate: todayIST,
                    pointsAwarded: pointsToAward,
                    streak: currentStreak
                });

                const embed = new EmbedBuilder()
                    .setColor('#00FF7F')
                    .setTitle('🧪 [Force Punch] Progress Recorded')
                    .setDescription(`Forced daily progress submission for ${targetUser.toString()} on **${todayIST}**.`)
                    .addFields(
                        { name: '👤 User', value: `${targetUser.username} (<@${targetUser.id}>)`, inline: true },
                        { name: '🛡️ Clan', value: `${targetClan.name} *(${clanSource})*`, inline: true },
                        { name: '📍 Progress Channel', value: `<#${targetClan.progressChannelId}>`, inline: true },
                        { name: '💎 Points Awarded', value: `+${pointsToAward} pts`, inline: true },
                        { name: '🔥 Current Streak', value: `${currentStreak} days`, inline: true },
                        { name: '⚙️ Status', value: '✅ Completed & Saved', inline: true }
                    )
                    .setFooter({ text: 'BashEye Multi-Clan Progress Testing' })
                    .setTimestamp();

                return await interaction.editReply({ embeds: [embed] });
            }

            // 3. MAIN WORKFLOW: Check today's progress & send DM reminder if not submitted!
            const hasSubmitted = await clanProgressService.hasSubmittedToday(targetClan.id, targetUser.id, todayIST, targetUser.username);

            if (hasSubmitted) {
                const embed = new EmbedBuilder()
                    .setColor('#00FF7F')
                    .setTitle('✅ [Daily Progress] Already Submitted')
                    .setDescription(
                        `**${targetUser.username}** (<@${targetUser.id}>) has **already submitted** today's progress for **${targetClan.name}** on **${todayIST}**.\n\n` +
                        `✨ No DM reminder is needed because progress is already completed!`
                    )
                    .addFields(
                        { name: '👤 Member', value: `${targetUser.username} (<@${targetUser.id}>)`, inline: true },
                        { name: '🛡️ Clan', value: `${targetClan.name} *(${clanSource})*`, inline: true },
                        { name: '📍 Progress Channel', value: `<#${targetClan.progressChannelId}>`, inline: true },
                        { name: '📅 Date', value: todayIST, inline: true },
                        { name: '📊 Progress Status', value: '✅ Completed Today', inline: true },
                        { name: '📬 DM Reminder', value: '⏭️ Not Needed (Already submitted)', inline: true }
                    )
                    .setFooter({ text: 'Daily Progress & DM Reminder System' })
                    .setTimestamp();

                return await interaction.editReply({ embeds: [embed] });
            } else {
                const reminderMsg = clanReminderService.formatReminderMessage(targetClan);
                let dmSuccess = false;
                let dmError = null;

                try {
                    await targetUser.send(reminderMsg);
                    dmSuccess = true;
                } catch (dmErr) {
                    dmError = dmErr.message;
                }

                const embed = new EmbedBuilder()
                    .setColor(dmSuccess ? '#5865F2' : '#ED4245')
                    .setTitle(dmSuccess ? '🔔 [DM Reminder] Sent Successfully' : '⚠️ [DM Reminder] Failed to Send')
                    .setDescription(
                        `**${targetUser.username}** (<@${targetUser.id}>) **has NOT submitted** today's progress for **${targetClan.name}** on **${todayIST}**.\n\n` +
                        (dmSuccess
                            ? `📨 **A DM reminder was sent to ${targetUser.toString()}!**`
                            : `❌ **Could not send DM:** ${dmError}\n*(User may have DMs disabled or closed)*`)
                    )
                    .addFields(
                        { name: '👤 Member', value: `${targetUser.username} (<@${targetUser.id}>)`, inline: true },
                        { name: '🛡️ Clan', value: `${targetClan.name} *(${clanSource})*`, inline: true },
                        { name: '📍 Progress Channel', value: `<#${targetClan.progressChannelId}>`, inline: true },
                        { name: '📅 Date', value: todayIST, inline: true },
                        { name: '📊 Progress Status', value: '⏳ Pending (Not Submitted)', inline: true },
                        { name: '📬 DM Delivery', value: dmSuccess ? '✅ Delivered to user DMs' : `❌ Failed (${dmError})`, inline: true },
                        { name: '📝 Message Sent', value: `\`\`\`\n${reminderMsg}\n\`\`\``, inline: false }
                    )
                    .setFooter({ text: 'Daily Progress & DM Reminder System' })
                    .setTimestamp();

                return await interaction.editReply({ embeds: [embed] });
            }

        } catch (error) {
            console.error('Error in executeForcePuchCommand:', error);
            await interaction.editReply({
                content: `❌ Error checking progress & sending reminder: ${error.message}`
            });
        }
    }

    // Get command data for registration
    getCommandData() {
        return Array.from(this.commands.values()).map(command => command.data.toJSON());
    }

    // Handle slash command interactions
    async handleInteraction(interaction) {
        if (!interaction.isChatInputCommand()) return;

        const command = this.commands.get(interaction.commandName);
        if (!command) {
            console.error(`No command matching ${interaction.commandName} was found.`);
            return;
        }

        console.log(`📩 Received /${interaction.commandName} from ${interaction.user.username}`);

        try {
            await command.execute(interaction);
            console.log(`✅ Executed /${interaction.commandName} for ${interaction.user.username}`);
        } catch (error) {
            if (error.code === 10062) {
                console.warn(`⚠️ Interaction /${interaction.commandName} timed out (Discord 10062).`);
                return;
            }
            console.error(`Error executing /${interaction.commandName}:`, error);
            
            const errorMessage = { 
                content: '❌ There was an error while executing this command!', 
                flags: MessageFlags.Ephemeral 
            };

            try {
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp(errorMessage);
                } else {
                    await interaction.reply(errorMessage);
                }
            } catch (err) {
                // Ignore if interaction is expired
            }
        }
    }
}

module.exports = new SlashCommandHandler();