// src/bot/client.js
const { Client, GatewayIntentBits } = require('discord.js');
const config = require('../config/config');
const messageHandler = require('../handlers/messageHandler');

class DiscordClient {
    constructor() {
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.GuildMessageReactions
            ]
        });

        this.setupEventHandlers();
    }

    setupEventHandlers() {
        this.client.once('clientReady', () => {
            console.log(`🤖 Bot logged in as ${this.client.user.tag}`);
            console.log(`📊 Connected to ${this.client.guilds.cache.size} guilds`);
            console.log(`👥 Monitoring ${this.client.users.cache.size} users`);
            
            // Set bot activity
            this.client.user.setActivity('for progress posts! 📈', { type: 'WATCHING' });
        });

        this.client.on('messageCreate', async (message) => {
            try {
                await messageHandler.handleMessage(message);
            } catch (error) {
                console.error('Error in messageCreate handler:', error);
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