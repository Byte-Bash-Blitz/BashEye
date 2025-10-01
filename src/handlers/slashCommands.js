// src/handlers/slashCommands.js
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const database = require('../database/supabase');
const streakService = require('../services/streakService');
const config = require('../config/config');

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
        const targetUser = interaction.options.getUser('user') || interaction.user;
        const username = targetUser.username;

        try {
            // Get member ID from database
            const memberId = await database.getMemberByDiscordUsername(username);
            if (!memberId) {
                await interaction.reply({ 
                    content: `❌ **Member Not Found**\n\n${username} is not registered in our system yet.\n\n*Please contact an administrator to register.*`,
                    ephemeral: true 
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

            await interaction.reply({ embeds: [embed], ephemeral: true });

        } catch (error) {
            console.error('Error in streak command:', error);
            await interaction.reply({ 
                content: '❌ **Error**\n\nThere was an error retrieving streak information. Please try again later.',
                ephemeral: true 
            });
        }
    }

    async executeMystatsCommand(interaction) {
        const username = interaction.user.username;

        try {
            // Get member ID from database
            const memberId = await database.getMemberByDiscordUsername(username);
            if (!memberId) {
                await interaction.reply({ 
                    content: `❌ **Member Not Found**\n\nYou are not registered in our system yet.\n\n*Please contact an administrator to register your Discord account.*`,
                    ephemeral: true 
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

            await interaction.reply({ embeds: [embed], ephemeral: true });

        } catch (error) {
            console.error('Error in mystats command:', error);
            await interaction.reply({ 
                content: '❌ **Error**\n\nThere was an error retrieving your statistics. Please try again later.',
                ephemeral: true 
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

        try {
            await command.execute(interaction);
            console.log(`✅ Executed /${interaction.commandName} for ${interaction.user.username}`);
        } catch (error) {
            console.error(`Error executing /${interaction.commandName}:`, error);
            
            const errorMessage = { 
                content: '❌ There was an error while executing this command!', 
                ephemeral: true 
            };

            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(errorMessage);
            } else {
                await interaction.reply(errorMessage);
            }
        }
    }
}

module.exports = new SlashCommandHandler();