// src/bot/client.js
const { Client, GatewayIntentBits, ActivityType } = require('discord.js');
const config = require('../config/config');
const messageHandler = require('../handlers/messageHandler');
const slashCommands = require('../handlers/slashCommands');

class DiscordClient {
    constructor() {
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.GuildMessageReactions,
                GatewayIntentBits.GuildVoiceStates  // Required for voice channel tracking
            ]
        });

        this.setupEventHandlers();
    }

    setupEventHandlers() {
        this.client.once('clientReady', async () => {
            console.log(`🤖 Bot logged in as ${this.client.user.tag}`);
            console.log(`🆔 Application ID: ${this.client.user.id}`);
            console.log(`📊 Connected to ${this.client.guilds.cache.size} guilds`);
            console.log(`👥 Monitoring ${this.client.users.cache.size} users`);
            
            // Set bot activity
            this.client.user.setActivity('for progress posts! 📈', { type: ActivityType.Watching });
            
            // Auto-deploy slash commands on startup
            console.log('🔧 Deploying slash commands...');
            try {
                const { deployCommands } = require('../commands/deploy');
                await deployCommands();
                console.log('✅ Slash commands deployed successfully');
            } catch (error) {
                console.error('❌ Failed to deploy slash commands:', error);
            }

            // Initialize and post scheduler message
            console.log('📅 Initializing meeting scheduler...');
            try {
                const meetingScheduler = require('../handlers/meetingScheduler');
                await meetingScheduler.initialize(this.client);
                await meetingScheduler.postSchedulerMessage(this.client);
            } catch (error) {
                console.error('❌ Failed to initialize scheduler:', error);
            }
        });

        this.client.on('messageCreate', async (message) => {
            try {
                await messageHandler.handleMessage(message);
            } catch (error) {
                console.error('Error in messageCreate handler:', error);
            }
        });

        // Handle slash command and button interactions
        this.client.on('interactionCreate', async (interaction) => {
            try {
                // Check if it's a meeting scheduler interaction (button or modal)
                if ((interaction.isButton() && ['schedule_meeting', 'view_meetings', 'cancel_meeting'].includes(interaction.customId)) ||
                    (interaction.isModalSubmit() && ['schedule_modal', 'cancel_modal'].includes(interaction.customId))) {
                    const meetingScheduler = require('../handlers/meetingScheduler');
                    await meetingScheduler.handleInteraction(interaction);
                } else {
                    // Handle slash commands
                    await slashCommands.handleInteraction(interaction);
                }
            } catch (error) {
                console.error('Error in interactionCreate handler:', error);
            }
        });

        this.client.on('error', (error) => {
            console.error('Discord client error:', error);
        });

        this.client.on('warn', (warning) => {
            console.warn('Discord client warning:', warning);
        });

        this.client.on('disconnect', () => {
            console.log('🔌 Bot disconnected');
        });

        this.client.on('reconnecting', () => {
            console.log('🔄 Bot reconnecting...');
        });
    }

    async start() {
        try {
            console.log('🚀 Starting Discord bot...');
            await this.client.login(config.discord.token);
            return this.client;
        } catch (error) {
            console.error('Failed to start Discord bot:', error);
            throw error;
        }
    }

    async stop() {
        try {
            console.log('🛑 Stopping Discord bot...');
            if (this.client) {
                await this.client.destroy();
                console.log('✅ Discord bot stopped');
            }
        } catch (error) {
            console.error('Error stopping Discord bot:', error);
            throw error;
        }
    }

    isReady() {
        return this.client && this.client.isReady();
    }

    getClient() {
        return this.client;
    }

    // Get bot statistics
    getStats() {
        if (!this.client || !this.client.isReady()) {
            return {
                status: 'offline',
                guilds: 0,
                users: 0,
                uptime: 0
            };
        }

        return {
            status: 'online',
            guilds: this.client.guilds.cache.size,
            users: this.client.users.cache.size,
            uptime: this.client.uptime,
            ping: this.client.ws.ping
        };
    }
}

// Export singleton instance
module.exports = new DiscordClient();