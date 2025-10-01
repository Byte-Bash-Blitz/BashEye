// src/config/config.js
require('dotenv').config();

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
        clientId: process.env.DISCORD_CLIENT_ID,
        guildId: process.env.DISCORD_GUILD_ID,
        basherProgressCategoryId: '1351223065354178722', // Basher Progress category ID
        categoryName: 'Basher Progress'
    },
    supabase: {
        url: process.env.SUPABASE_URL,
        key: process.env.SUPABASE_ANON_KEY
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
    // Helper functions
    getTodayDateString,
    getCurrentISTDate,
    convertToIST,
    getISTDateString
};