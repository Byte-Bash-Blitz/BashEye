// src/config/config.js
require('dotenv').config();

module.exports = {
    discord: {
        token: process.env.DISCORD_BOT_TOKEN,
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
    }
};