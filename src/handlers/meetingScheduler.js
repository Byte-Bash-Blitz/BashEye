// src/handlers/meetingScheduler.js
// 
// TIMEZONE HANDLING (IST - Indian Standard Time, UTC+5:30):
// =========================================================
// 1. User Input: Times are entered in IST (e.g., "9:35 PM")
// 2. Storage: Dates are stored as JavaScript Date objects (UTC internally)
// 3. Display: All times shown to users use { timeZone: 'Asia/Kolkata' }
// 4. Comparisons: Date.now() and date.getTime() work in UTC milliseconds
// 5. Cron Job: Runs with timezone: 'Asia/Kolkata' for accurate scheduling
// 6. Date Creation: ISO strings use +05:30 offset (e.g., "2026-01-10T21:35:00.000+05:30")
//
// This ensures meetings scheduled for "9:35 PM IST" start at exactly 9:35 PM IST,
// regardless of the server's system timezone (Render uses UTC).
//
const { 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    GuildScheduledEventPrivacyLevel,
    GuildScheduledEventEntityType,
    Events,
    MessageFlags
} = require('discord.js');
const config = require('../config/config');
const cron = require('node-cron');

class MeetingScheduler {
    constructor() {
        this.schedulerMessageId = null;
        this.scheduledMeetings = new Map();
        this.activeMeetings = new Map();
        this.messageDeletionTimers = new Map();
        this.client = null;
        this.cronJob = null;
    }

    async initialize(client) {
        this.client = client;
        this.setupVoiceStateHandler();
        this.startCronJob();
        await this.recoverScheduledEvents();
    }

    setupVoiceStateHandler() {
        this.client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
            await this.handleVoiceStateUpdate(oldState, newState);
        });
    }

    async handleVoiceStateUpdate(oldState, newState) {
        const userId = newState.id;
        const user = await this.client.users.fetch(userId).catch(() => null);
        if (!user || user.bot) return;

        // Get display name (server nickname or global display name)
        const member = newState.member || oldState.member;
        const displayName = member?.displayName || user.displayName || user.username;
        const username = user.username;
        const now = Date.now();

        console.log(`🎤 Voice update: ${displayName} | Old: ${oldState.channelId} | New: ${newState.channelId} | Active meetings: ${this.activeMeetings.size}`);

        for (const [meetingId, meeting] of this.activeMeetings.entries()) {
            console.log(`   Checking meeting: ${meeting.topic} in channel ${meeting.channelId}`);
            const oldChannelId = oldState.channelId;
            const newChannelId = newState.channelId;
            const meetingChannelId = meeting.channelId;

            if (newChannelId === meetingChannelId && oldChannelId !== meetingChannelId) {
                if (!meeting.participants.has(userId)) {
                    meeting.participants.set(userId, {
                        displayName: displayName,
                        username: username,
                        joinedAt: now,
                        leftAt: null,
                        totalSeconds: 0,
                        sessions: []
                    });
                    console.log(`➕ ${displayName} joined ${meeting.topic} (NEW participant)`);
                } else {
                    const participant = meeting.participants.get(userId);
                    participant.displayName = displayName; // Update in case name changed
                    participant.joinedAt = now;
                    participant.leftAt = null;
                    console.log(`➕ ${displayName} rejoined ${meeting.topic}`);
                }
            }

            if (oldChannelId === meetingChannelId && newChannelId !== meetingChannelId) {
                const participant = meeting.participants.get(userId);
                if (participant && !participant.leftAt) {
                    const sessionDuration = Math.floor((now - participant.joinedAt) / 1000);
                    participant.totalSeconds += sessionDuration;
                    participant.leftAt = now;
                    participant.sessions.push({
                        joinedAt: participant.joinedAt,
                        leftAt: now,
                        duration: sessionDuration
                    });
                    console.log(`➖ ${displayName} left ${meeting.topic} (${Math.floor(sessionDuration / 60)}m ${sessionDuration % 60}s)`);
                } else if (!participant) {
                    console.log(`⚠️ ${displayName} left ${meeting.topic} but wasn't tracked as participant`);
                }
            }
        }
    }

    startCronJob() {
        this.cronJob = cron.schedule('* * * * *', async () => {
            await this.checkScheduledMeetings();
        }, {
            timezone: 'Asia/Kolkata'
        });
        console.log('⏰ Cron job started for meeting scheduler');
    }

    async checkScheduledMeetings() {
        const now = Date.now();
        const nowIST = new Date(now).toLocaleString('en-IN', { 
            timeZone: 'Asia/Kolkata',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
            day: '2-digit',
            month: 'short'
        });

        // Only log if there are scheduled meetings to avoid spam
        if (this.scheduledMeetings.size > 0) {
            console.log(`⏰ Cron check at ${nowIST} IST - ${this.scheduledMeetings.size} scheduled meeting(s)`);
        }

        for (const [meetingId, meeting] of this.scheduledMeetings.entries()) {
            if (meeting.status === 'scheduled') {
                const meetingStartIST = meeting.startTime.toLocaleString('en-IN', { 
                    timeZone: 'Asia/Kolkata',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: true
                });
                const timeUntilStart = meeting.startTime.getTime() - now;
                
                if (timeUntilStart <= 0) {
                    console.log(`🎬 Starting meeting "${meeting.topic}" scheduled for ${meetingStartIST}`);
                    await this.startMeeting(meetingId, meeting);
                } else if (timeUntilStart < 60000) { // Less than 1 minute
                    console.log(`⏳ Meeting "${meeting.topic}" starts in ${Math.ceil(timeUntilStart / 1000)}s at ${meetingStartIST}`);
                }
            }
        }

        for (const [meetingId, activeMeeting] of this.activeMeetings.entries()) {
            const scheduledMeeting = this.scheduledMeetings.get(meetingId);
            if (!scheduledMeeting) continue;

            const channel = await this.client.channels.fetch(activeMeeting.channelId).catch(() => null);
            if (!channel) continue;

            const currentMembers = channel.members.filter(m => !m.user.bot);

            if (!activeMeeting.scheduledSummaryPosted && 
                scheduledMeeting.endTime.getTime() <= now) {
                
                await this.generateScheduledPeriodSummary(activeMeeting, meetingId, scheduledMeeting.endTime);
                activeMeeting.scheduledSummaryPosted = true;

                if (currentMembers.size > 0) {
                    activeMeeting.waitingForEmpty = true;
                    await this.postMeetingExtendedNotice(activeMeeting, currentMembers.size);
                } else {
                    // Generate final summary even if channel is empty
                    await this.generateFinalSummary(activeMeeting, meetingId);
                    await this.finalizeAndCleanup(meetingId);
                }
            }

            if (activeMeeting.waitingForEmpty && currentMembers.size === 0) {
                await this.generateFinalSummary(activeMeeting, meetingId);
                await this.finalizeAndCleanup(meetingId);
            }
        }
    }

    async startMeeting(meetingId, meeting) {
        console.log(`🎬 Starting meeting: ${meeting.topic}`);

        const channel = await this.client.channels.fetch(meeting.channelId).catch(() => null);
        if (!channel) {
            console.log(`❌ Channel not found: ${meeting.channelId}`);
            return;
        }

        console.log(`📍 Meeting channel: ${channel.name} (${channel.id})`);
        const startTime = Date.now();
        const presentMembers = channel.members;
        const participants = new Map();

        presentMembers.forEach(member => {
            if (!member.user.bot) {
                const displayName = member.displayName || member.user.displayName || member.user.username;
                participants.set(member.id, {
                    displayName: displayName,
                    username: member.user.username,
                    joinedAt: startTime,
                    leftAt: null,
                    totalSeconds: 0,
                    sessions: []
                });
                console.log(`👤 Initial participant: ${displayName}`);
            }
        });
        
        console.log(`👥 Meeting started with ${participants.size} participant(s)`);

        this.activeMeetings.set(meetingId, {
            ...meeting,
            actualStartTime: startTime,
            participants: participants,
            scheduledSummaryPosted: false,
            waitingForEmpty: false
        });

        meeting.status = 'active';

        // Schedule confirmation message deletion after 1 hour
        this.scheduleConfirmationDeletion(meetingId, meeting);

        if (meeting.eventId && meeting.guildId) {
            try {
                const guild = await this.client.guilds.fetch(meeting.guildId);
                const event = await guild.scheduledEvents.fetch(meeting.eventId);
                if (event && event.status === 1) {
                    await event.setStatus(2);
                }
            } catch (error) {
                console.error('Error updating event:', error);
            }
        }

        // Post meeting start announcement in general channel
        const generalChannelId = config.meetings.generalChannelId;
        const basherRoleId = config.meetings.basherRoleId;
        try {
            const generalChannel = await this.client.channels.fetch(generalChannelId).catch(() => null);
            if (generalChannel) {
                await generalChannel.send({
                    content: `<@&${basherRoleId}>`,
                    embeds: [new EmbedBuilder()
                        .setColor('#00FF00')
                        .setTitle('🎬 Meeting is Now Live!')
                        .setDescription(
                            `**${meeting.topic}**\n\n` +
                            `Join the meeting now in <#${meeting.channelId}>`
                        )
                        .setTimestamp()
                    ]
                });
                console.log(`📢 Posted meeting start announcement for: ${meeting.topic}`);
            }
        } catch (error) {
            console.error('Error posting meeting start announcement:', error);
        }
    }

    async generateScheduledPeriodSummary(meeting, meetingId, scheduledEndTime) {
        const statsChannelId = config.meetings.statsChannelId;
        if (!statsChannelId) return;

        const statsChannel = await this.client.channels.fetch(statsChannelId).catch(() => null);
        if (!statsChannel) return;

        const scheduledDuration = scheduledEndTime.getTime() - meeting.actualStartTime;
        const durationMinutes = Math.floor(scheduledDuration / (1000 * 60));

        const attendanceSnapshot = [];
        meeting.participants.forEach((participant) => {
            let timeInScheduledPeriod = 0;

            participant.sessions.forEach(session => {
                const effectiveStart = Math.max(session.joinedAt, meeting.actualStartTime);
                const effectiveEnd = Math.min(session.leftAt || Date.now(), scheduledEndTime.getTime());

                if (effectiveEnd > effectiveStart) {
                    timeInScheduledPeriod += Math.floor((effectiveEnd - effectiveStart) / 1000);
                }
            });

            if (!participant.leftAt) {
                const effectiveStart = Math.max(participant.joinedAt, meeting.actualStartTime);
                const effectiveEnd = scheduledEndTime.getTime();
                if (effectiveEnd > effectiveStart) {
                    timeInScheduledPeriod += Math.floor((effectiveEnd - effectiveStart) / 1000);
                }
            }

            if (timeInScheduledPeriod > 0) {
                attendanceSnapshot.push({
                    displayName: participant.displayName || participant.username,
                    seconds: timeInScheduledPeriod
                });
            }
        });

        attendanceSnapshot.sort((a, b) => b.seconds - a.seconds);

        let summary = `📊 **Meeting Summary - Scheduled Period**\n\n📝 **${meeting.topic}**\n`;
        summary += `🎙️ Channel: ${meeting.channelName}\n⏱️ Duration: ${Math.floor(durationMinutes / 60)}h ${durationMinutes % 60}m\n\n`;
        summary += `👥 **Attendance:**\n\n`;

        if (attendanceSnapshot.length === 0) {
            summary += `_No participants_\n`;
        } else {
            attendanceSnapshot.forEach(p => {
                const mins = Math.floor(p.seconds / 60);
                const percentage = Math.round((p.seconds / (scheduledDuration / 1000)) * 100);
                const badge = percentage >= 95 ? ' ⭐' : '';
                summary += `• **${p.displayName}** - ${mins}m (${percentage}%)${badge}\n`;
            });
        }

        await statsChannel.send(summary);
    }

    async postMeetingExtendedNotice(activeMeeting, memberCount) {
        const statsChannelId = config.meetings.statsChannelId;
        if (!statsChannelId) return;

        const statsChannel = await this.client.channels.fetch(statsChannelId).catch(() => null);
        if (!statsChannel) return;

        await statsChannel.send(
            `⏱️ **Meeting Extended**\n\n📝 ${activeMeeting.topic}\n👥 ${memberCount} member(s) still present\n\nTracking continues...`
        );
    }

    async generateFinalSummary(meeting, meetingId) {
        const statsChannelId = config.meetings.statsChannelId;
        if (!statsChannelId) return;

        const statsChannel = await this.client.channels.fetch(statsChannelId).catch(() => null);
        if (!statsChannel) return;

        const scheduledMeeting = this.scheduledMeetings.get(meetingId);
        const actualEndTime = Date.now();
        const totalDuration = actualEndTime - meeting.actualStartTime;
        const totalMinutes = Math.floor(totalDuration / (1000 * 60));

        const finalAttendance = [];
        meeting.participants.forEach((participant) => {
            let totalSeconds = participant.totalSeconds;

            if (!participant.leftAt) {
                totalSeconds += Math.floor((actualEndTime - participant.joinedAt) / 1000);
            }

            if (totalSeconds > 0) {
                finalAttendance.push({
                    displayName: participant.displayName || participant.username,
                    seconds: totalSeconds
                });
            }
        });

        finalAttendance.sort((a, b) => b.seconds - a.seconds);

        let summary = `📊 **Final Meeting Report**\n\n📝 **${meeting.topic}**\n`;
        summary += `🎙️ Channel: ${meeting.channelName}\n⏱️ Total: ${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m\n`;

        if (scheduledMeeting) {
            const scheduledDuration = scheduledMeeting.endTime.getTime() - scheduledMeeting.startTime.getTime();
            const overtimeMs = totalDuration - scheduledDuration;
            if (overtimeMs > 0) {
                summary += `⏱️ Overtime: ${Math.floor(overtimeMs / (1000 * 60))}m\n`;
            }
        }

        summary += `\n👥 **Complete Attendance:**\n\n`;

        if (finalAttendance.length === 0) {
            summary += `_No participants_\n`;
        } else {
            finalAttendance.forEach(p => {
                const mins = Math.floor(p.seconds / 60);
                const percentage = Math.round((p.seconds / (totalDuration / 1000)) * 100);
                const badge = percentage >= 95 ? ' ⭐' : '';
                summary += `• **${p.displayName}** - ${mins}m (${percentage}%)${badge}\n`;
            });

            const fullAttendance = finalAttendance.filter(p => p.seconds >= (totalDuration / 1000) * 0.95).length;
            summary += `\n📈 Total: ${finalAttendance.length} | Full (95%+): ${fullAttendance}\n`;
        }

        await statsChannel.send(summary);
    }

    async finalizeAndCleanup(meetingId) {
        const meeting = this.activeMeetings.get(meetingId);
        if (!meeting) return;

        this.activeMeetings.delete(meetingId);

        const scheduledMeeting = this.scheduledMeetings.get(meetingId);
        if (scheduledMeeting) {
            scheduledMeeting.status = 'completed';

            if (scheduledMeeting.eventId && scheduledMeeting.guildId) {
                try {
                    const guild = await this.client.guilds.fetch(scheduledMeeting.guildId);
                    const event = await guild.scheduledEvents.fetch(scheduledMeeting.eventId);
                    if (event) {
                        // Must set to COMPLETED before deletion (Discord API requirement)
                        if (event.status !== 3 && event.status !== 4) {
                            await event.setStatus(3);
                            console.log(`✅ Event status set to COMPLETED: ${scheduledMeeting.topic}`);
                        }
                        // Delete event to clean up server's Events tab
                        await event.delete();
                        console.log(`🗑️ Event deleted: ${scheduledMeeting.topic}`);
                    }
                } catch (error) {
                    console.error('Error finalizing event:', error);
                }
            }

            // Cancel any pending message deletion timer
            if (this.messageDeletionTimers.has(meetingId)) {
                clearTimeout(this.messageDeletionTimers.get(meetingId));
                this.messageDeletionTimers.delete(meetingId);
            }
        }

        console.log(`✅ Meeting completed: ${meeting.topic}`);
    }

    async handleInteraction(interaction) {
        try {
            if (interaction.isButton()) {
                if (interaction.customId === 'schedule_meeting') {
                    await this.showScheduleModal(interaction);
                } else if (interaction.customId === 'view_meetings') {
                    await this.showScheduledMeetings(interaction);
                } else if (interaction.customId === 'cancel_meeting') {
                    await this.showCancelMeetingModal(interaction);
                }
                return;
            }

            if (interaction.isModalSubmit()) {
                if (interaction.customId === 'schedule_modal') {
                    await this.handleScheduleSubmission(interaction);
                } else if (interaction.customId === 'cancel_modal') {
                    await this.handleCancelSubmission(interaction);
                }
                return;
            }
        } catch (error) {
            // Check if error is due to expired interaction
            if (error.code === 10062 || error.code === 40060) {
                console.error('⏱️ Interaction expired or already acknowledged - this is normal on slow networks');
                return;
            }
            
            console.error('❌ Error handling interaction:', error);
            
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: '❌ An error occurred. Please try again.',
                    flags: MessageFlags.Ephemeral
                }).catch(console.error);
            }
        }
    }

    async showScheduleModal(interaction) {
        const voiceChannels = Array.from(interaction.guild.channels.cache
            .filter(ch => ch.type === 2).values());
        
        const channelList = voiceChannels.map((ch, idx) => `${idx + 1}. ${ch.name}`).join('\n');

        const modal = new ModalBuilder()
            .setCustomId('schedule_modal')
            .setTitle('📅 Schedule Meeting');

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('meeting_topic')
                    .setLabel('Meeting Topic')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('e.g., Weekly Sync')
                    .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('meeting_date')
                    .setLabel('Date (DD/MM/YYYY) - Empty for today')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('meeting_start_time')
                    .setLabel('Start Time (e.g., 2:30 PM)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('meeting_end_time')
                    .setLabel('End Time (e.g., 3:30 PM)')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('meeting_channel')
                    .setLabel('Voice Channel Number')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder(channelList.substring(0, 100))
                    .setRequired(true)
            )
        );

        try {
            await interaction.showModal(modal);
        } catch (error) {
            // Interaction expired before modal could be shown
            if (error.code === 10062) {
                console.log('⏱️ Button interaction expired before showModal');
                return;
            }
            throw error;
        }
    }

    async handleScheduleSubmission(interaction) {
        try {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        } catch (error) {
            // Interaction expired before we could defer
            if (error.code === 10062) {
                console.log('⏱️ Modal submission interaction expired before deferReply');
                return;
            }
            throw error;
        }

        try {
            const topic = interaction.fields.getTextInputValue('meeting_topic');
            const dateStr = interaction.fields.getTextInputValue('meeting_date').trim();
            const startTimeStr = interaction.fields.getTextInputValue('meeting_start_time').trim();
            const endTimeStr = interaction.fields.getTextInputValue('meeting_end_time').trim();
            const channelNumStr = interaction.fields.getTextInputValue('meeting_channel').trim();

            const voiceChannels = Array.from(interaction.guild.channels.cache
                .filter(ch => ch.type === 2).values());

            const channelNum = parseInt(channelNumStr);
            if (isNaN(channelNum) || channelNum < 1 || channelNum > voiceChannels.length) {
                await interaction.editReply(`❌ Invalid channel number (1-${voiceChannels.length})`);
                return;
            }

            const channel = voiceChannels[channelNum - 1];

            // Get current IST date
            let dateObj;
            if (dateStr) {
                const [day, month, year] = dateStr.split('/');
                dateObj = { year: parseInt(year), month: parseInt(month), day: parseInt(day) };
                if (isNaN(dateObj.year) || isNaN(dateObj.month) || isNaN(dateObj.day)) {
                    await interaction.editReply('❌ Invalid date format');
                    return;
                }
            } else {
                // Use current IST date when date field is empty
                const now = new Date();
                // Get current date in IST timezone
                const istDateStr = now.toLocaleString('en-CA', { 
                    timeZone: 'Asia/Kolkata',
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit'
                }); // Format: YYYY-MM-DD
                const [year, month, day] = istDateStr.split('-');
                dateObj = {
                    year: parseInt(year),
                    month: parseInt(month),
                    day: parseInt(day)
                };
                console.log(`📅 Using current IST date: ${day}/${month}/${year}`);
            }

            const startTime = this.parseTime(startTimeStr, dateObj);
            const endTime = this.parseTime(endTimeStr, dateObj);

            console.log(`📅 Debug - Date object:`, dateObj);
            console.log(`📅 Debug - Start time string: "${startTimeStr}"`);
            console.log(`📅 Debug - Parsed start time:`, startTime);
            console.log(`📅 Debug - Start time ISO:`, startTime?.toISOString());
            console.log(`📅 Debug - End time ISO:`, endTime?.toISOString());

            if (!startTime || !endTime) {
                await interaction.editReply('❌ Invalid time format');
                return;
            }

            if (endTime <= startTime) {
                await interaction.editReply('❌ End time must be after start time');
                return;
            }

            // Allow 1 minute grace period for scheduling (to account for processing time)
            const gracePeriod = 60 * 1000; // 1 minute
            if (startTime.getTime() <= (Date.now() - gracePeriod)) {
                const nowIST = new Date().toLocaleString('en-IN', { 
                    timeZone: 'Asia/Kolkata',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: true
                });
                console.log(`⏰ Start time check - Meeting: ${startTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}, Current IST: ${nowIST}`);
                await interaction.editReply(`❌ Start time must be in the future (Current IST time: ${nowIST})`);
                return;
            }

            const guild = interaction.guild;
            const scheduledEvent = await guild.scheduledEvents.create({
                name: topic,
                scheduledStartTime: startTime,
                scheduledEndTime: endTime,
                privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
                entityType: GuildScheduledEventEntityType.Voice,
                channel: channel.id,
                description: `Automated attendance tracking enabled`
            });

            const duration = Math.round((endTime - startTime) / (1000 * 60));
            const meetingId = `meeting_${scheduledEvent.id}`;

            // Post confirmation message to stats channel FIRST
            const statsChannelId = config.meetings.statsChannelId;
            let confirmationMsg = null;
            if (statsChannelId) {
                const statsChannel = await guild.channels.fetch(statsChannelId).catch(() => null);
                if (statsChannel) {
                    confirmationMsg = await statsChannel.send({
                        embeds: [new EmbedBuilder()
                            .setColor('#5865F2')
                            .setTitle('📅 Meeting Scheduled')
                            .setDescription(`**${topic}**`)
                            .addFields(
                                { name: '👤 Scheduled By', value: `<@${interaction.user.id}>`, inline: true },
                                { name: '📍 Location', value: `<#${channel.id}>`, inline: true },
                                { name: '📅 Date', value: startTime.toLocaleDateString('en-IN', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Kolkata' }), inline: false },
                                { name: '🕐 Time', value: `${startTime.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })} - ${endTime.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}`, inline: true },
                                { name: '⏱️ Duration', value: `${Math.floor(duration / 60)}h ${duration % 60}m`, inline: true }
                            )
                            .setFooter({ text: `Meeting ID: ${meetingId}` })
                            .setTimestamp()
                        ]
                    });
                }
            }

            // Now store meeting with confirmation message reference
            this.scheduledMeetings.set(meetingId, {
                id: meetingId,
                topic,
                channelId: channel.id,
                channelName: channel.name,
                guildId: guild.id,
                startTime,
                endTime,
                createdBy: interaction.user.id,
                createdByName: interaction.user.username,
                status: 'scheduled',
                eventId: scheduledEvent.id,
                confirmationMsgId: confirmationMsg?.id,
                confirmationChannelId: confirmationMsg?.channel.id
            });

            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setColor('#00FF00')
                    .setTitle('✅ Meeting Scheduled Successfully')
                    .setDescription(
                        `Your meeting has been scheduled and automated attendance tracking is now enabled.\n\n` +
                        `**${topic}**\n` +
                        `📍 ${channel.name}\n` +
                        `🕐 ${startTime.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}`
                    )
                    .setFooter({ text: `Meeting ID: ${meetingId}` })
                ]
            });

        } catch (error) {
            console.error('❌ Error scheduling:', error);
            await interaction.editReply('❌ Error scheduling meeting').catch(console.error);
        }
    }

    parseTime(timeStr, dateObj) {
        const match = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
        if (!match) return null;

        let hours = parseInt(match[1]);
        const minutes = parseInt(match[2]);
        const period = match[3].toUpperCase();

        // Validate time components
        if (hours < 1 || hours > 12 || minutes < 0 || minutes > 59) {
            console.log(`❌ Invalid time values: ${hours}:${minutes} ${period}`);
            return null;
        }

        // Convert to 24-hour format
        if (period === 'PM' && hours !== 12) hours += 12;
        if (period === 'AM' && hours === 12) hours = 0;

        // Create date string in ISO format for IST timezone
        // This creates a Date object that represents the IST time
        const year = dateObj.year;
        const month = String(dateObj.month).padStart(2, '0');
        const day = String(dateObj.day).padStart(2, '0');
        const hourStr = String(hours).padStart(2, '0');
        const minStr = String(minutes).padStart(2, '0');
        
        // Create ISO string with IST offset (+05:30)
        // This tells JavaScript: "This time is in IST timezone"
        const istDateStr = `${year}-${month}-${day}T${hourStr}:${minStr}:00.000+05:30`;
        const date = new Date(istDateStr);
        
        console.log(`🕐 Parsing time: ${timeStr} on ${day}/${month}/${year}`);
        console.log(`🕐 Created IST string: ${istDateStr}`);
        console.log(`🕐 Resulting UTC timestamp: ${date.getTime()}`);
        console.log(`🕐 Resulting IST display: ${date.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true })}`);
        
        return date;
    }

    async showScheduledMeetings(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const meetings = Array.from(this.scheduledMeetings.values())
            .filter(m => m.status === 'scheduled')
            .sort((a, b) => a.startTime - b.startTime);

        if (meetings.length === 0) {
            await interaction.editReply('📋 No scheduled meetings');
            return;
        }

        const embed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('📋 Scheduled Meetings');

        meetings.forEach(m => {
            const duration = Math.round((m.endTime - m.startTime) / (1000 * 60));
            embed.addFields({
                name: `📝 ${m.topic}`,
                value: `🆔 \`${m.id}\`\n📍 ${m.channelName}\n📅 ${m.startTime.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })} ${m.startTime.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}\n⏱️ ${Math.floor(duration / 60)}h ${duration % 60}m`,
                inline: false
            });
        });

        await interaction.editReply({ embeds: [embed] });
    }

    async showCancelMeetingModal(interaction) {
        const modal = new ModalBuilder()
            .setCustomId('cancel_modal')
            .setTitle('❌ Cancel Meeting');

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('cancel_meeting_id')
                    .setLabel('Meeting ID')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
            )
        );

        await interaction.showModal(modal);
    }

    async handleCancelSubmission(interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            const meetingId = interaction.fields.getTextInputValue('cancel_meeting_id').trim();
            const meeting = this.scheduledMeetings.get(meetingId);

            if (!meeting || meeting.status !== 'scheduled') {
                await interaction.editReply('❌ Meeting not found');
                return;
            }

            meeting.status = 'cancelled';
            this.scheduledMeetings.delete(meetingId);

            if (meeting.eventId) {
                try {
                    const event = await interaction.guild.scheduledEvents.fetch(meeting.eventId);
                    if (event) await event.delete();
                } catch (e) {}
            }

            // Delete confirmation message if it exists
            if (meeting.confirmationMsgId && meeting.confirmationChannelId) {
                try {
                    const confChannel = await interaction.guild.channels.fetch(meeting.confirmationChannelId).catch(() => null);
                    if (confChannel) {
                        const confMsg = await confChannel.messages.fetch(meeting.confirmationMsgId).catch(() => null);
                        if (confMsg) await confMsg.delete();
                    }
                } catch (e) {}
            }

            const statsChannelId = config.meetings.statsChannelId;
            if (statsChannelId) {
                const statsChannel = await interaction.guild.channels.fetch(statsChannelId).catch(() => null);
                if (statsChannel) {
                    const cancelMsg = await statsChannel.send({
                        embeds: [new EmbedBuilder()
                            .setColor('#FF6B6B')
                            .setTitle('🚫 Meeting Cancelled')
                            .setDescription(`**${meeting.topic}**`)
                            .addFields(
                                { name: '📍 Location', value: meeting.channelName, inline: true },
                                { name: '👤 Cancelled By', value: `<@${interaction.user.id}>`, inline: true }
                            )
                            .setFooter({ text: 'This message will be deleted in 5 minutes' })
                            .setTimestamp()
                        ]
                    });

                    // Delete cancellation message after 5 minutes
                    setTimeout(async () => {
                        try {
                            await cancelMsg.delete();
                            console.log(`🗑️ Deleted cancellation message for: ${meeting.topic}`);
                        } catch (e) {
                            console.error('Error deleting cancellation message:', e);
                        }
                    }, 5 * 60 * 1000); // 5 minutes
                }
            }

            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setColor('#FFA500')
                    .setTitle('✅ Meeting Cancelled')
                    .setDescription(`The meeting "**${meeting.topic}**" has been successfully cancelled.`)
                ]
            });

        } catch (error) {
            console.error('❌ Error cancelling:', error);
            await interaction.editReply('❌ Error cancelling meeting').catch(console.error);
        }
    }

    async postSchedulerMessage(client) {
        try {
            const schedulerChannelId = config.meetings.schedulerChannelId;
            if (!schedulerChannelId) return;

            const schedulerChannel = await client.channels.fetch(schedulerChannelId);
            if (!schedulerChannel) return;

            const voiceChannelArray = Array.from(schedulerChannel.guild.channels.cache
                .filter(ch => ch.type === 2)
                .values());
            
            const voiceChannels = voiceChannelArray
                .map((ch, idx) => `${idx + 1}. ${ch.name}`)
                .join('\n') || 'No voice channels';

            const embed = new EmbedBuilder()
                .setColor('#5865F2')
                .setTitle('📅 Meeting Scheduler')
                .setDescription(
                    '**Automated attendance tracking enabled!**\n\n' +
                    '✨ **Features:**\n' +
                    '• Discord Events\n' +
                    '• Real-time tracking\n' +
                    '• Dual summaries\n' +
                    '• Overtime detection\n\n' +
                    '📍 **Voice Channels:**\n' +
                    `${voiceChannels}`
                )
                .setTimestamp();

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('schedule_meeting')
                        .setLabel('📅 Schedule')
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId('view_meetings')
                        .setLabel('📋 View')
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId('cancel_meeting')
                        .setLabel('❌ Cancel')
                        .setStyle(ButtonStyle.Danger)
                );

            await schedulerChannel.send({ embeds: [embed], components: [row] });
            console.log(`✅ Scheduler posted in #${schedulerChannel.name}`);

        } catch (error) {
            console.error('❌ Error posting scheduler:', error);
        }
    }

    async recoverScheduledEvents() {
        console.log('🔄 Recovering scheduled events from Discord...');
        
        try {
            const guilds = this.client.guilds.cache;
            let recoveredCount = 0;
            let cleanedCount = 0;

            for (const guild of guilds.values()) {
                const events = await guild.scheduledEvents.fetch().catch(() => null);
                if (!events) continue;

                for (const event of events.values()) {
                    // Only recover events created by this bot (check description or name pattern)
                    if (!event.description?.includes('Automated attendance tracking')) continue;

                    const meetingId = `meeting_${event.id}`;
                    const now = Date.now();

                    // Clean up stale ACTIVE events that ended in the past
                    if (event.status === 2 && event.scheduledEndAt.getTime() < now) {
                        console.log(`🧹 Cleaning stale active event: ${event.name}`);
                        try {
                            await event.setStatus(3);
                            await event.delete();
                            cleanedCount++;
                        } catch (err) {
                            console.error('Error cleaning stale event:', err);
                        }
                        continue;
                    }

                    // Clean up old COMPLETED events
                    if (event.status === 3 || event.status === 4) {
                        console.log(`🧹 Cleaning completed/canceled event: ${event.name}`);
                        try {
                            await event.delete();
                            cleanedCount++;
                        } catch (err) {
                            console.error('Error cleaning completed event:', err);
                        }
                        continue;
                    }

                    // Recover SCHEDULED events
                    if (event.status === 1) {
                        this.scheduledMeetings.set(meetingId, {
                            id: meetingId,
                            topic: event.name,
                            channelId: event.channelId,
                            channelName: event.channel?.name || 'Unknown',
                            guildId: guild.id,
                            startTime: event.scheduledStartAt,
                            endTime: event.scheduledEndAt,
                            createdBy: event.creatorId,
                            createdByName: 'Unknown',
                            status: 'scheduled',
                            eventId: event.id,
                            // Note: confirmation message references are lost on restart
                            confirmationMsgId: null,
                            confirmationChannelId: null
                        });
                        recoveredCount++;
                        console.log(`✅ Recovered scheduled meeting: ${event.name}`);
                    }

                    // Resume tracking ACTIVE events
                    if (event.status === 2) {
                        const channel = await this.client.channels.fetch(event.channelId).catch(() => null);
                        if (channel) {
                            const participants = new Map();
                            const now = Date.now();

                            channel.members.forEach(member => {
                                if (!member.user.bot) {
                                    participants.set(member.id, {
                                        username: member.user.username,
                                        joinedAt: now,
                                        leftAt: null,
                                        totalSeconds: 0,
                                        sessions: []
                                    });
                                }
                            });

                            const meetingData = {
                                id: meetingId,
                                topic: event.name,
                                channelId: event.channelId,
                                channelName: event.channel?.name || 'Unknown',
                                guildId: guild.id,
                                startTime: event.scheduledStartAt,
                                endTime: event.scheduledEndAt,
                                createdBy: event.creatorId,
                                createdByName: 'Unknown',
                                status: 'active',
                                eventId: event.id
                            };

                            this.scheduledMeetings.set(meetingId, meetingData);
                            this.activeMeetings.set(meetingId, {
                                ...meetingData,
                                actualStartTime: event.scheduledStartAt.getTime(),
                                participants: participants,
                                scheduledSummaryPosted: false,
                                waitingForEmpty: false
                            });

                            recoveredCount++;
                            console.log(`✅ Resumed active meeting: ${event.name} (${participants.size} participants)`);
                        }
                    }
                }
            }

            console.log(`✅ Event recovery complete: ${recoveredCount} recovered, ${cleanedCount} cleaned`);
        } catch (error) {
            console.error('❌ Error recovering events:', error);
        }
    }

    scheduleConfirmationDeletion(meetingId, meeting) {
        // Delete confirmation message 1 hour after meeting START time
        const oneHour = 60 * 60 * 1000; // 3,600,000 milliseconds
        
        const timer = setTimeout(async () => {
            try {
                if (meeting.confirmationMsgId && meeting.confirmationChannelId) {
                    const channel = await this.client.channels.fetch(meeting.confirmationChannelId).catch(() => null);
                    if (channel) {
                        const message = await channel.messages.fetch(meeting.confirmationMsgId).catch(() => null);
                        if (message) {
                            await message.delete();
                            console.log(`🗑️ Deleted confirmation message for: ${meeting.topic}`);
                        }
                    }
                }
                this.messageDeletionTimers.delete(meetingId);
            } catch (error) {
                console.error('Error deleting confirmation message:', error);
            }
        }, oneHour);

        this.messageDeletionTimers.set(meetingId, timer);
        console.log(`⏰ Scheduled confirmation deletion in 1 hour for: ${meeting.topic}`);
    }
}

module.exports = new MeetingScheduler();
