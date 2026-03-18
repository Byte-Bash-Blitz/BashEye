// src/config/config.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');

// Load meeting channels configuration from JSON
function loadMeetingChannelsConfig() {
    const configPath = path.join(__dirname, 'meetingChannels.json');
    
    try {
        if (fs.existsSync(configPath)) {
            const fileContent = fs.readFileSync(configPath, 'utf8');
            return JSON.parse(fileContent);
        }
    } catch (error) {
        console.error('⚠️ Error loading meetingChannels.json:', error.message);
    }
    
    // Return default empty structure if file doesn't exist or has error
    return {
        meetingChannels: [],
        excludedChannels: [],
        textChannels: {
            meetSchedulerChannelId: '',
            meetStatsChannelId: '',
            generalVoiceChannelId: ''
        },
        roles: {
            clanRoleId: ''
        }
    };
}

// Load the JSON configuration
const meetingChannelsConfig = loadMeetingChannelsConfig();

// Helper function to get channel ID with priority: .env > JSON
function getChannelId(envVarName, jsonPath, defaultValue = '') {
    // Priority 1: Check .env file
    if (process.env[envVarName]) {
        return process.env[envVarName];
    }
    
    // Priority 2: Check JSON config
    const pathParts = jsonPath.split('.');
    let value = meetingChannelsConfig;
    for (const part of pathParts) {
        if (value && typeof value === 'object' && part in value) {
            value = value[part];
        } else {
            return defaultValue;
        }
    }
    
    return value || defaultValue;
}

// Build meeting channels array with .env priority
function buildMeetingChannels() {
    const channels = [];
    
    // Check for individual channel env vars first (MEETING_CHANNEL_1_ID, etc.)
    for (let i = 1; i <= 10; i++) {
        const envId = process.env[`MEETING_CHANNEL_${i}_ID`];
        const envName = process.env[`MEETING_CHANNEL_${i}_NAME`];
        
        if (envId) {
            channels.push({
                id: envId,
                name: envName || `Meeting Room ${i}`,
                description: process.env[`MEETING_CHANNEL_${i}_DESC`] || '',
                enabled: process.env[`MEETING_CHANNEL_${i}_ENABLED`] !== 'false',
                source: 'env'
            });
        }
    }
    
    // If no env channels found, use JSON config
    if (channels.length === 0 && meetingChannelsConfig.meetingChannels) {
        meetingChannelsConfig.meetingChannels.forEach((channel) => {
            if (channel.id && channel.enabled !== false) {
                channels.push({
                    ...channel,
                    source: 'json'
                });
            }
        });
    }
    
    return channels;
}

// Build excluded channels array
function buildExcludedChannels() {
    const channels = [];
    
    // Check for excluded channel env vars
    const excludedIds = process.env.EXCLUDED_CHANNEL_IDS?.split(',') || [];
    const excludedNames = process.env.EXCLUDED_CHANNEL_NAMES?.split(',') || [];
    
    if (excludedIds.length > 0) {
        excludedIds.forEach((id, index) => {
            if (id.trim()) {
                channels.push({
                    id: id.trim(),
                    name: excludedNames[index]?.trim() || `Excluded ${index + 1}`,
                    source: 'env'
                });
            }
        });
    }
    
    // If no env excluded channels, use JSON config
    if (channels.length === 0 && meetingChannelsConfig.excludedChannels) {
        meetingChannelsConfig.excludedChannels.forEach(channel => {
            if (channel.id) {
                channels.push({
                    ...channel,
                    source: 'json'
                });
            }
        });
    }
    
    return channels;
}

// Helper function to get today's date in IST timezone
function getTodayDateString() {
    const today = new Date();
    // Convert to IST (UTC+5:30)
    const istOffset = 5.5 * 60 * 60 * 1000; // 5.5 hours in milliseconds
    const istDate = new Date(today.getTime() + istOffset);
    
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                   'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const day = istDate.getUTCDate();
    const month = months[istDate.getUTCMonth()];
    const year = istDate.getUTCFullYear().toString().slice(-2);
    return `${day}${month}'${year}`;
}

// Helper function to get current time in IST
function getCurrentISTDate() {
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000; // 5.5 hours in milliseconds
    return new Date(now.getTime() + istOffset);
}

// Helper function to convert any date to IST
function convertToIST(date) {
    const istOffset = 5.5 * 60 * 60 * 1000; // 5.5 hours in milliseconds
    return new Date(date.getTime() + istOffset);
}

// Helper function to get date string in YYYY-MM-DD format for IST
function getISTDateString(date = null) {
    const targetDate = date || getCurrentISTDate();
    return targetDate.toISOString().split('T')[0];
}

module.exports = {
    discord: {
        token: process.env.DISCORD_BOT_TOKEN,
        clientId: '1192867500875063346',
        guildId: process.env.DISCORD_GUILD_ID,
        basherProgressCategoryId: '1351223065354178722', // Basher Progress category ID
        categoryName: 'Basher Progress',
        organizerRoleId: process.env.ORGANIZER_ROLE_ID || '1163059730042851418'
    },
    supabase: {
        url: process.env.SUPABASE_URL,
        key: process.env.SUPABASE_ANON_KEY
    },
    openrouter: {
        apiKey: process.env.OPENROUTER_API_KEY,
        model: 'google/gemini-2.5-flash'
    },
    points: {
        organiserIdBot: 77,
        dailyAmount: 5,
        minimumWords: 35
    },
    server: {
        port: process.env.PORT || 3000
    },
    timezone: {
        name: 'IST',
        offset: '+05:30',
        offsetHours: 5.5,
        cutoffHour: 23,    // 11 PM IST
        cutoffMinute: 59,  // 59 minutes
        cutoffSecond: 59   // 59 seconds
    },
    // Meeting tracking configuration
    meetings: {
        // Get all configured meeting channels (env has priority)
        channels: buildMeetingChannels(),
        
        // Get excluded channels (e.g., Lounge - tracked separately)
        excludedChannels: buildExcludedChannels(),
        
        // meet-scheduler channel (where scheduling forms/confirmations are posted)
        schedulerChannelId: '1448314979001565216',
        
        // meet-stats channel (where summaries and extended meeting notices are posted)
        statsChannelId: '1448314536623865907',
        
        // General channel (where meeting start announcements go)
        generalChannelId: '1163002452187033670',
        
        // Basher role ID (to mention when meeting starts)
        basherRoleId: '1163057919428939876',
        
        // Helper to get only enabled channels
        getEnabledChannels() {
            return this.channels.filter(ch => ch.enabled !== false);
        },
        
        // Helper to check if a channel is excluded
        isExcludedChannel(channelId) {
            return this.excludedChannels.some(ch => ch.id === channelId);
        },
        
        // Helper to get channel by ID
        getChannelById(channelId) {
            return this.channels.find(ch => ch.id === channelId);
        },
        
        // Helper to get channel by index (1-based for user input)
        getChannelByIndex(index) {
            const enabledChannels = this.getEnabledChannels();
            return enabledChannels[index - 1] || null;
        }
    },
    // Helper functions
    getTodayDateString,
    getCurrentISTDate,
    convertToIST,
    getISTDateString
};