require('dotenv').config();
const { Client, GatewayIntentBits, ChannelType } = require('discord.js');
const { createClient } = require('@supabase/supabase-js');

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
const MIN_WORD_COUNT = 50;

// Store daily submissions to prevent duplicate points
const dailySubmissions = new Map(); // Format: userId-date => true

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

// Function to check if member already received points today
function hasReceivedPointsToday(userId) {
    const todayKey = getTodayKey();
    const submissionKey = `${userId}-${todayKey}`;
    return dailySubmissions.has(submissionKey);
}

// Function to mark member as having received points today
function markPointsAwarded(userId) {
    const todayKey = getTodayKey();
    const submissionKey = `${userId}-${todayKey}`;
    dailySubmissions.set(submissionKey, true);
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
        return;
    }

    // Check if message has at least 50 words
    const wordCount = countWords(message.content);
    if (wordCount < MIN_WORD_COUNT) {
        console.log(`❌ Message from ${message.author.username} has only ${wordCount} words (minimum: ${MIN_WORD_COUNT})`);
        return;
    }

    // Check if user already received points today
    if (hasReceivedPointsToday(message.author.id)) {
        console.log(`ℹ️ ${message.author.username} already received points today`);
        return;
    }

    // Get member ID from database
    const memberId = await getMemberIdByDiscordUsername(message.author.username);
    if (!memberId) {
        console.log(`❌ Member ${message.author.username} not found in database`);
        return;
    }

    // Award points
    const dateString = getTodayDateString();
    const success = await awardPoints(memberId, dateString);
    
    if (success) {
        markPointsAwarded(message.author.id);
        
        // React to the message to show it was processed
        try {
            await message.react('✅');
            console.log(`🎉 Successfully processed daily update from ${message.author.username}`);
        } catch (error) {
            console.error('Error reacting to message:', error);
        }
    }
}

// Event handlers
client.once('clientReady', () => {
    console.log(`🚀 ${client.user.tag} is online and monitoring basher-progress!`);
    console.log(`📊 Monitoring guild: ${GUILD_ID}`);
    console.log(`📁 Looking for category ID: ${BASHER_PROGRESS_CATEGORY_ID}`);
    console.log(`� Category name: ${BASHER_PROGRESS_CATEGORY_NAME}`);
    console.log(`�💰 Daily points: ${DAILY_POINTS}`);
    console.log(`📝 Minimum words: ${MIN_WORD_COUNT}`);
    
    // List all categories in the guild for debugging
    const guild = client.guilds.cache.get(GUILD_ID);
    if (guild) {
        console.log('\n📂 Available categories in server:');
        guild.channels.cache.forEach(channel => {
            if (channel.type === ChannelType.GuildCategory) {
                console.log(`   - ${channel.name} (ID: ${channel.id})`);
            }
        });
        console.log('');
        
        // Check bot permissions
        console.log('🔑 Checking bot permissions...');
        const botMember = guild.members.cache.get(client.user.id);
        if (botMember) {
            console.log(`   - Can read messages: ${botMember.permissions.has('ViewChannel')}`);
            console.log(`   - Can send messages: ${botMember.permissions.has('SendMessages')}`);
            console.log(`   - Can read message history: ${botMember.permissions.has('ReadMessageHistory')}`);
            console.log(`   - Can add reactions: ${botMember.permissions.has('AddReactions')}`);
        }
        console.log('');
    }
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
});

// Start the bot
client.login(process.env.DISCORD_BOT_TOKEN).catch(error => {
    console.error('Failed to login:', error);
    process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('🛑 Shutting down bot...');
    client.destroy();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('🛑 Shutting down bot...');
    client.destroy();
    process.exit(0);
});