// src/config/config.js
require('dotenv').config();

// Helper function to get today's date in format for description (matching bot.js)
function getTodayDateString() {
    const today = new Date();
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                   'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const day = today.getDate();
    const month = months[today.getMonth()];
    const year = today.getFullYear().toString().slice(-2);
    return `${day}${month}'${year}`;
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
    // Helper functions
    getTodayDateString
};