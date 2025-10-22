require('dotenv').config();
const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const express = require('express');
const cors = require('cors');

// Initialize Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions
    ]
});

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

// Configuration
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const BASHER_PROGRESS_CATEGORY_ID = '1351223065354178722';
const BASHER_PROGRESS_CATEGORY_NAME = 'Basher Progress';
const ORGANISER_ID = 77; // Bot's unique ID in your database
const DAILY_POINTS = 5;
const MIN_WORD_COUNT = 40;

// Bot status tracking
let botStatus = {
    online: false,
    username: null,
    guild: null,
    uptime: null,
    lastActivity: null,
    messagesProcessed: 0,
    pointsAwarded: 0,
    errors: 0
};

// Express server setup
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// API Endpoints
app.get('/', (req, res) => {
    res.json({
        message: 'BashEye Discord Bot API',
        version: '1.0.0',
        endpoints: {
            '/status': 'GET - Bot status information',
            '/health': 'GET - Health check',
            '/stats': 'GET - Bot statistics'
        }
    });
});

app.get('/status', (req, res) => {
    res.json({
        status: 'success',
        data: {
            ...botStatus,
            uptime: botStatus.online ? Date.now() - botStatus.uptime : null,
            uptimeFormatted: botStatus.online ? formatUptime(Date.now() - botStatus.uptime) : null
        }
    });
});

app.get('/health', (req, res) => {
    const isHealthy = botStatus.online && client.isReady();
    res.status(isHealthy ? 200 : 503).json({
        status: isHealthy ? 'healthy' : 'unhealthy',
        online: botStatus.online,
        ready: client.isReady(),
        timestamp: new Date().toISOString()
    });
});

app.get('/stats', (req, res) => {
    res.json({
        status: 'success',
        data: {
            messagesProcessed: botStatus.messagesProcessed,
            pointsAwarded: botStatus.pointsAwarded,
            errors: botStatus.errors,
            guild: botStatus.guild,
            monitoringCategory: BASHER_PROGRESS_CATEGORY_NAME,
            dailyPoints: DAILY_POINTS,
            minimumWords: MIN_WORD_COUNT
        }
    });
});

// Helper function to format uptime
function formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
    if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
}

// Helper function to get today's date in format for description
function getTodayDateString() {
    const today = new Date();
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                   'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const day = today.getDate();
    const month = months[today.getMonth()];
    const year = today.getFullYear().toString().slice(-2);
    return `${day}${month}'${year}`;
}

// Helper function to get today's date key for tracking
function getTodayKey() {
    return new Date().toDateString();
}

// Helper function to count words in text
function countWords(text) {
    return text.trim().split(/\s+/).filter(word => word.length > 0).length;
}

// Helper function to check if message has screenshot/image
function hasAttachment(message) {
    return message.attachments.size > 0 && 
           message.attachments.some(attachment => 
               attachment.contentType && attachment.contentType.startsWith('image/')
           );
}

// Function to get member ID from database by Discord username
async function getMemberIdByDiscordUsername(discordUsername) {
    try {
        const { data, error } = await supabase
            .from('members')
            .select('id')
            .eq('discord_username', discordUsername)
            .single();

        if (error) {
            console.error('Error fetching member:', error);
            return null;
        }

        return data?.id || null;
    } catch (error) {
        console.error('Error in getMemberIdByDiscordUsername:', error);
        return null;
    }
}

// Function to award points to member
async function awardPoints(memberId, date) {
    try {
        const description = `PU-${date}`;
        
        const { data, error } = await supabase
            .from('points')
            .insert({
                member_id: memberId,
                organiser_id: ORGANISER_ID,
                points: DAILY_POINTS,
                description: description
            });

        if (error) {
            console.error('Error inserting points:', error);
            return false;
        }

        console.log(`✅ Awarded ${DAILY_POINTS} points to member ${memberId} for ${description}`);
        return true;
    } catch (error) {
        console.error('Error in awardPoints:', error);
        return false;
    }
}

// Function to check if member already received points today (database-based)
async function hasReceivedPointsToday(discordUsername) {
    try {
        const today = new Date().toISOString().split('T')[0]; // Get today's date in YYYY-MM-DD format
        const todayDescription = `PU-${getTodayDateString()}`; // PU-20Sep25 format
        
        console.log(`🔍 Checking database for existing points today for ${discordUsername}`);
        console.log(`   Looking for description: ${todayDescription}`);
        
        // First get the member ID
        const memberId = await getMemberIdByDiscordUsername(discordUsername);
        if (!memberId) {
            console.log(`   ❌ Member not found in database`);
            return false;
        }
        
        // Check if there's already a point record for today
        const { data, error } = await supabase
            .from('points')
            .select('id')
            .eq('member_id', memberId)
            .eq('organiser_id', ORGANISER_ID)
            .eq('description', todayDescription)
            .limit(1);

        if (error) {
            console.error('Error checking daily points:', error);
            return false; // If error, allow the attempt (safer than blocking)
        }

        const hasPoints = data && data.length > 0;
        console.log(`   📊 Database check result: ${hasPoints ? 'ALREADY AWARDED' : 'NOT AWARDED YET'}`);
        return hasPoints;
    } catch (error) {
        console.error('Error in hasReceivedPointsToday:', error);
        return false; // If error, allow the attempt
    }
}

// Function to mark member as having received points today (no longer needed - database handles this)
function markPointsAwarded(userId) {
    // This function is now redundant since we're using database tracking
    // Keeping it for backwards compatibility but it does nothing
    console.log(`📝 Points marked in database for user ${userId}`);
}

// Function to check if channel is in basher-progress category
async function isInBasherProgressCategory(channel) {
    try {
        console.log(`🔍 Checking channel: ${channel.name} (ID: ${channel.id}, Type: ${channel.type})`);
        console.log(`📁 Channel parentId: ${channel.parentId}`);
        console.log(`🎯 Looking for category ID: ${BASHER_PROGRESS_CATEGORY_ID}`);
        
        // Direct category check - this is the key insight from your Python code!
        if (channel.parentId === BASHER_PROGRESS_CATEGORY_ID) {
            console.log(`✅ DIRECT MATCH: Channel is directly in basher-progress category!`);
            return true;
        }
        
        // For forum threads, check if the parent channel's category matches
        if ((channel.type === ChannelType.PublicThread || channel.type === ChannelType.PrivateThread) && channel.parent) {
            console.log(`📋 Thread detected. Parent: ${channel.parent.name} (ID: ${channel.parent.id})`);
            console.log(`📁 Parent's parentId: ${channel.parent.parentId}`);
            
            if (channel.parent.parentId === BASHER_PROGRESS_CATEGORY_ID) {
                console.log(`✅ THREAD MATCH: Parent channel is in basher-progress category!`);
                return true;
            }
        }

        console.log(`❌ No match found - parentId: ${channel.parentId}, thread parent's parentId: ${channel.parent?.parentId}`);
        return false;
    } catch (error) {
        console.error('Error checking channel category:', error);
        return false;
    }
}

// Main message handler
async function handleMessage(message) {
    // Ignore bot messages first (before any logging)
    if (message.author.bot) return;

    // Check if message is from the correct guild (before any logging)
    if (!message.guild || message.guild.id !== GUILD_ID) return;

    // Only log messages from basher-progress category now
    const isInCategory = await isInBasherProgressCategory(message.channel);
    if (!isInCategory) return;

    // Update activity tracking
    botStatus.lastActivity = new Date().toISOString();
    botStatus.messagesProcessed++;

    // Now log only relevant messages
    console.log(`\n🔗 MESSAGE IN BASHER-PROGRESS:`);
    console.log(`   Author: ${message.author.username}`);
    console.log(`   Channel: ${message.channel.name} (ID: ${message.channel.id})`);
    console.log(`   Channel Type: ${message.channel.type}`);
    console.log(`   Channel ParentId: ${message.channel.parentId}`);
    console.log(`   Content: "${message.content.substring(0, 100)}..."`);
    console.log(`   Attachments: ${message.attachments.size}`);

    console.log(`\n📩 Processing message from ${message.author.username} in #${message.channel.name}`);
    console.log(`✅ Message is in basher-progress category!`);

    // Check if message has an image attachment
    if (!hasAttachment(message)) {
        console.log(`❌ Message from ${message.author.username} has no image attachment`);
        try {
            await message.reply({
                content: `📸 **Missing Screenshot!**\n\nHi ${message.author}, your daily progress update needs to include a screenshot/image to earn points.\n\n*Please add an image and try again!*`,
                allowedMentions: { users: [message.author.id] }
            });
        } catch (error) {
            console.error('Error sending image requirement notification:', error);
        }
        return;
    }

    // Check if message has at least 35 words
    const wordCount = countWords(message.content);
    if (wordCount < MIN_WORD_COUNT) {
        console.log(`❌ Message from ${message.author.username} has only ${wordCount} words (minimum: ${MIN_WORD_COUNT})`);
        try {
            await message.reply({
                content: `📝 **Need More Details!**\n\nHi ${message.author}, your progress update needs at least  **${MIN_WORD_COUNT} words** to earn points.\n\n*Current word count: ${wordCount}*\n*Required: ${MIN_WORD_COUNT} words*\n\nPlease add more details about your progress!`,
                allowedMentions: { users: [message.author.id] }
            });
        } catch (error) {
            console.error('Error sending word count notification:', error);
        }
        return;
    }

    // Check if user already received points today
    if (await hasReceivedPointsToday(message.author.username)) {
        console.log(`ℹ️ ${message.author.username} already received points today`);
        try {
            await message.reply({
                content: `🕒 **Already Earned Today!**\n\nHi ${message.author}, you've already earned your daily points today!\n\n*Come back tomorrow for your next daily update.*`,
                allowedMentions: { users: [message.author.id] }
            });
        } catch (error) {
            console.error('Error sending daily limit notification:', error);
        }
        return;
    }

    // Get member ID from database
    const memberId = await getMemberIdByDiscordUsername(message.author.username);
    if (!memberId) {
        console.log(`❌ Member ${message.author.username} not found in database`);
        try {
            await message.reply({
                content: `🔍 **Member Not Found!**\n\nHi ${message.author}, you're not registered in our system yet.\n\n*Please contact an administrator to register your Discord account.*`,
                allowedMentions: { users: [message.author.id] }
            });
        } catch (error) {
            console.error('Error sending member not found notification:', error);
        }
        return;
    }

    // Award points
    const dateString = getTodayDateString();
    const success = await awardPoints(memberId, dateString);
    
    if (success) {
        // Points are automatically marked as awarded by the database insertion
        botStatus.pointsAwarded++;
        
        // React to the message to show it was processed
        try {
            await message.react('✅');
            console.log(`🎉 Successfully processed daily update from ${message.author.username}`);
        } catch (error) {
            console.error('Error reacting to message:', error);
            botStatus.errors++;
        }
    } else {
        botStatus.errors++;
        // Notify user of failure via reply
        try {
            await message.reply({
                content: `❌ **Failed to award points!**\n\nSorry ${message.author}, there was an error processing your daily update. Please contact an administrator for assistance.\n\n*Error: Unable to record points in the database*`,
                allowedMentions: { users: [message.author.id] }
            });
            console.log(`⚠️ Notified ${message.author.username} about point awarding failure`);
        } catch (replyError) {
            console.error('Error sending failure notification:', replyError);
            botStatus.errors++;
        }
    }
}

// Event handlers
client.once('clientReady', () => {
    const guild = client.guilds.cache.get(GUILD_ID);
    
    // Update bot status
    botStatus.online = true;
    botStatus.username = client.user.tag;
    botStatus.guild = guild ? guild.name : 'Unknown';
    botStatus.uptime = Date.now();
    botStatus.lastActivity = new Date().toISOString();
    
    console.log(`🚀 ${client.user.tag} is online and monitoring basher-progress!`);
    console.log(`📊 Monitoring guild: ${GUILD_ID}`);
    console.log(`📁 Looking for category ID: ${BASHER_PROGRESS_CATEGORY_ID}`);
    console.log(`📂 Category name: ${BASHER_PROGRESS_CATEGORY_NAME}`);
    console.log(`💰 Daily points: ${DAILY_POINTS}`);
    console.log(`📝 Minimum words: ${MIN_WORD_COUNT}`);
    console.log(`🌐 API server available at http://localhost:${PORT}`);
});
client.on('messageCreate', handleMessage);

// Also handle thread messages specifically
client.on('threadCreate', async (thread) => {
    console.log(`🧵 New thread created: ${thread.name} in ${thread.parent?.name || 'unknown'}`);
    if (thread.parent && thread.parent.parent) {
        console.log(`   Parent category: ${thread.parent.parent.name} (ID: ${thread.parent.parent.id})`);
    }
});

client.on('error', error => {
    console.error('Discord client error:', error);
    botStatus.errors++;
    botStatus.lastActivity = new Date().toISOString();
});

// Start Express server
app.listen(PORT, () => {
    console.log(`🌐 API server running on http://localhost:${PORT}`);
});

// Start the bot
client.login(process.env.DISCORD_BOT_TOKEN).catch(error => {
    console.error('Failed to login:', error);
    botStatus.errors++;
    process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('🛑 Shutting down bot...');
    botStatus.online = false;
    client.destroy();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('🛑 Shutting down bot...');
    botStatus.online = false;
    client.destroy();
    process.exit(0);
});
