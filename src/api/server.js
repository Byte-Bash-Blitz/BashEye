// src/api/server.js
const express = require('express');
const cors = require('cors');
const database = require('../database/supabase');
const streakService = require('../services/streakService');
const config = require('../config/config');

class APIServer {
    constructor() {
        this.app = express();
        this.setupMiddleware();
        this.setupRoutes();
    }

    setupMiddleware() {
        this.app.use(cors());
        this.app.use(express.json());
        
        // Request logging
        this.app.use((req, res, next) => {
            console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
            next();
        });

        // Self-ping to prevent Render sleep (runs every 5 minutes)
        setInterval(async () => {
            try {
                const url = `https://basheye-j0jl.onrender.com/health`;
                const response = await fetch(url);
                console.log(`[Self-Ping] Ping sent to ${url}, status: ${response.status}`);
            } catch (err) {
                console.error(`[Self-Ping] Error: ${err.message}`);
            }
        }, 300000);


    }

    setupRoutes() {
        // Health check
        this.app.get('/', (req, res) => {
            res.status(200).send('BashEye Bot is running! 🤖');
        });

        this.app.get('/health', (req, res) => {
            res.status(200).json({
                status: 'healthy',
                bot: 'BashEye',
                service: 'Discord Bot API',
                uptime: process.uptime(),
                timestamp: new Date().toISOString(),
                version: '2.0.0'
            });
        });

        // Bot status
        this.app.get('/status', (req, res) => {
            const discordClient = require('../bot/client');
            const client = discordClient.getClient();
            
            res.json({
                status: discordClient.isReady() ? 'online' : 'offline',
                uptime: process.uptime(),
                guilds: client && client.guilds ? client.guilds.cache.size : 0,
                users: client && client.users ? client.users.cache.size : 0,
                ping: client && client.ws ? client.ws.ping : null,
                timestamp: new Date().toISOString()
            });
        });

        // Authentication status
        this.app.get('/auth/status', (req, res) => {
            const supabaseAuth = require('../database/supabaseAuth');
            const authStatus = supabaseAuth.getAuthStatus();
            
            res.json({
                ...authStatus,
                timestamp: new Date().toISOString()
            });
        });

        // Get member streak information
        this.app.get('/streak/:discordUsername', async (req, res) => {
            try {
                const { discordUsername } = req.params;
                
                // Get member ID
                const memberId = await database.getMemberByDiscordUsername(discordUsername);
                if (!memberId) {
                    return res.status(404).json({
                        error: 'Member not found',
                        message: 'Discord username not registered in system'
                    });
                }

                // Get streak information
                const streakInfo = await streakService.getStreakInfo(memberId);
                const memberStats = await database.getMemberStats(memberId);

                res.json({
                    discordUsername,
                    memberId,
                    currentStreak: streakInfo.currentStreak,
                    lastUpdated: streakInfo.lastUpdated,
                    memberStats: memberStats || null,
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                console.error('Error getting streak info:', error);
                res.status(500).json({
                    error: 'Internal server error',
                    message: 'Failed to retrieve streak information'
                });
            }
        });

        // Recalculate streak for a member (admin endpoint)
        this.app.post('/streak/:discordUsername/recalculate', async (req, res) => {
            try {
                const { discordUsername } = req.params;
                
                // Get member ID
                const memberId = await database.getMemberByDiscordUsername(discordUsername);
                if (!memberId) {
                    return res.status(404).json({
                        error: 'Member not found',
                        message: 'Discord username not registered in system'
                    });
                }

                // Get old streak for comparison
                const oldStreakInfo = await streakService.getStreakInfo(memberId);
                
                // Recalculate and update streak using the same method as auto-recalculation
                const newStreak = await streakService.recalculateStreakFromHistory(memberId);
                
                res.json({
                    discordUsername,
                    memberId,
                    oldStreak: oldStreakInfo.currentStreak,
                    newStreak,
                    streakChanged: oldStreakInfo.currentStreak !== newStreak,
                    message: 'Streak recalculated successfully using historical data',
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                console.error('Error recalculating streak:', error);
                res.status(500).json({
                    error: 'Internal server error',
                    message: 'Failed to recalculate streak'
                });
            }
        });

        // Bulk recalculate streaks for all members (admin endpoint)
        this.app.post('/streak/recalculate-all', async (req, res) => {
            try {
                // This would require a method to get all members, implementing basic version
                res.json({
                    message: 'Bulk recalculation endpoint - implement based on your members table structure',
                    note: 'Use individual recalculation endpoints for now',
                    individualEndpoint: 'POST /streak/:discordUsername/recalculate',
                    timestamp: new Date().toISOString()
                });
            } catch (error) {
                console.error('Error in bulk recalculation:', error);
                res.status(500).json({
                    error: 'Internal server error',
                    message: 'Failed to perform bulk recalculation'
                });
            }
        });

        // Get bot configuration (non-sensitive info only)
        this.app.get('/config', (req, res) => {
            res.json({
                pointsPerDay: config.points.dailyAmount,
                minimumWords: config.points.minimumWords,
                serverPort: config.server.port,
                features: {
                    streakTracking: true,
                    pointsAwarding: true,
                    spamPrevention: true,
                    apiEndpoints: true
                },
                timestamp: new Date().toISOString()
            });
        });

        // Get API statistics
        this.app.get('/stats', (req, res) => {
            const messageHandler = require('../handlers/messageHandler');
            
            res.json({
                uptime: process.uptime(),
                memoryUsage: process.memoryUsage(),
                messageHandler: messageHandler.getStats(),
                timestamp: new Date().toISOString()
            });
        });

        // Self-ping to prevent Render sleep (runs every 5 minutes)
        // Error handling middleware
        this.app.use((error, req, res, next) => {
            console.error('API Error:', error);
            res.status(500).json({
                error: 'Internal server error',
                message: 'An unexpected error occurred'
            });
        });

        // 404 handler
        this.app.use((req, res) => {
            res.status(404).json({
                error: 'Not found',
                message: 'Endpoint not found'
            });
        });
    }

    start() {
        return new Promise((resolve, reject) => {
            try {
                this.server = this.app.listen(config.server.port, '0.0.0.0', () => {
                    console.log(`🚀 API Server running on http://localhost:${config.server.port}`);
                    resolve(this.server);
                });
            } catch (error) {
                console.error('Failed to start API server:', error);
                reject(error);
            }
        });
    }

    stop() {
        return new Promise((resolve) => {
            if (this.server) {
                this.server.close(() => {
                    console.log('API Server stopped');
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }
}

module.exports = new APIServer();