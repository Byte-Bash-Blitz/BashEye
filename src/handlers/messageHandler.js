// src/handlers/messageHandler.js
const database = require('../database/supabase');
const streakService = require('../services/streakService');
const config = require('../config/config');

class MessageHandler {
    constructor() {
        this.cooldowns = new Set(); // Track recent message processing to prevent spam
    }

    async handleMessage(message) {
        try {
            // Skip bot messages
            if (message.author.bot) return;

            // Debug logging for channel structure
            console.log(`📧 New message from ${message.author.username}`);
            console.log(`📍 Channel: ${message.channel.name} (ID: ${message.channel.id})`);
            console.log(`📂 Channel Type: ${message.channel.type}`);
            if (message.channel.parent) {
                console.log(`📁 Parent: ${message.channel.parent.name} (ID: ${message.channel.parent.id})`);
                if (message.channel.parent.parent) {
                    console.log(`📁 Grandparent: ${message.channel.parent.parent.name} (ID: ${message.channel.parent.parent.id})`);
                }
            }
            console.log(`🎯 Expected Category ID: ${config.discord.basherProgressCategoryId}`);

            // Check if message is in the basher-progress category
            if (!this.isInBasherProgressCategory(message)) return;

            // Check if this is a thread and if the message author is the thread owner
            if (message.channel.isThread()) {
                const threadOwner = message.channel.ownerId;
                console.log(`🧵 Thread: ${message.channel.name}`);
                console.log(`👤 Thread Owner ID: ${threadOwner}`);
                console.log(`✍️ Message Author ID: ${message.author.id}`);
                
                if (message.author.id !== threadOwner) {
                    console.log(`❌ Message from ${message.author.username} ignored - not the thread owner`);
                    return;
                }
                
                console.log(`✅ Message from thread owner ${message.author.username} - processing for points`);
            }

            // Check for cooldown to prevent rapid processing
            const cooldownKey = `${message.author.id}-${Date.now()}`;
            if (this.cooldowns.has(message.author.id)) {
                console.log(`Cooldown active for user ${message.author.username}`);
                return;
            }

            // Add to cooldown (5 second cooldown)
            this.cooldowns.add(message.author.id);
            setTimeout(() => {
                this.cooldowns.delete(message.author.id);
            }, 5000);

            console.log(`✅ Processing message from ${message.author.username} in ${message.channel.name}`);

            // Check if message meets criteria
            if (!this.meetsCriteria(message)) {
                await this.sendFeedback(message, 'Your progress post needs to include a screenshot/image and at least 35 words of description! 📝');
                return;
            }

            // Get member ID from database
            const memberId = await database.getMemberByDiscordUsername(message.author.username);
            if (!memberId) {
                await this.sendFeedback(message, 'Your Discord username is not registered in our system. Please contact an admin! 🔗');
                return;
            }

            // Check if points already awarded today
            const today = new Date().toISOString().split('T')[0];
            const description = `PU-${today}`;
            
            const alreadyAwarded = await database.checkDailyPointsAwarded(memberId, description);
            if (alreadyAwarded) {
                await this.sendFeedback(message, 'You\'ve already received your daily progress points today! Come back tomorrow! 🗓️');
                return;
            }

            // Award points
            const success = await database.awardPoints(memberId, config.points.dailyAmount, description);
            if (!success) {
                await this.sendFeedback(message, 'There was an error awarding your points. Please contact an admin! ⚠️');
                return;
            }

            // Update streak
            const streakInfo = await streakService.handleDailySubmission(memberId);

            // Send success feedback with streak information
            await this.sendSuccessFeedback(message, streakInfo);

            console.log(`Successfully awarded ${config.points.dailyAmount} points to ${message.author.username} (Member ID: ${memberId}). Streak: ${streakInfo.currentStreak} days`);

        } catch (error) {
            console.error('Error handling message:', error);
            await this.sendFeedback(message, 'An unexpected error occurred. Please try again later! 🔧');
        }
    }

    isInBasherProgressCategory(message) {
        try {
            const channel = message.channel;
            console.log(`Checking channel: ${channel.name} (ID: ${channel.id}), Type: ${channel.type}`);
            
            // Handle forum threads (messages in forum channel threads)
            if (channel.isThread() && channel.parent) {
                const forum = channel.parent;
                console.log(`Thread parent forum: ${forum.name} (ID: ${forum.id})`);
                
                // The key check: forum's parent (grandparent of thread) should be the category
                if (forum.parent && forum.parent.id === config.discord.basherProgressCategoryId) {
                    console.log(`✅ Message is in basher-progress category via grandparent: ${forum.parent.name}`);
                    return true;
                }
                
                // Fallback: Check if the forum itself is the basher-progress category (direct match)
                if (forum.id === config.discord.basherProgressCategoryId) {
                    console.log(`✅ Direct forum match for basher-progress category`);
                    return true;
                }
            }
            
            // Handle regular channels (non-forum channels)
            if (channel.parent) {
                console.log(`Regular channel parent: ${channel.parent.name} (ID: ${channel.parent.id})`);
                
                // Check if the parent (direct category) matches
                if (channel.parent.id === config.discord.basherProgressCategoryId) {
                    console.log(`✅ Message is in basher-progress category: ${channel.parent.name}`);
                    return true;
                }
                
                // Check if grandparent is the category (for nested structures)
                if (channel.parent.parent && channel.parent.parent.id === config.discord.basherProgressCategoryId) {
                    console.log(`✅ Message is in basher-progress category via grandparent: ${channel.parent.parent.name}`);
                    return true;
                }
            }
            
            // Direct channel ID check (if the category itself is being used as a channel)
            if (channel.id === config.discord.basherProgressCategoryId) {
                console.log(`✅ Direct channel match for basher-progress category`);
                return true;
            }
            
            console.log(`❌ Message not in basher-progress category. Channel: ${channel.name}, Parent: ${channel.parent?.name || 'None'}, Grandparent: ${channel.parent?.parent?.name || 'None'}, Category ID expected: ${config.discord.basherProgressCategoryId}`);
            return false;
        } catch (error) {
            console.error('Error checking channel category:', error);
            return false;
        }
    }

    meetsCriteria(message) {
        const hasAttachment = message.attachments.size > 0;
        const wordCount = message.content.split(/\s+/).filter(word => word.length > 0).length;
        const hasEnoughWords = wordCount >= config.points.minimumWords;
        
        console.log(`Message criteria check - Attachments: ${hasAttachment}, Word count: ${wordCount}/${config.points.minimumWords}, Meets criteria: ${hasAttachment && hasEnoughWords}`);
        
        return hasAttachment && hasEnoughWords;
    }

    async sendFeedback(message, feedbackText) {
        try {
            // Try to send as a reply first
            await message.reply(feedbackText);
        } catch (error) {
            console.error('Error sending reply, trying DM:', error);
            try {
                // Fallback to DM
                await message.author.send(feedbackText);
            } catch (dmError) {
                console.error('Error sending DM:', dmError);
            }
        }
    }

    async sendSuccessFeedback(message, streakInfo) {
        try {
            let feedbackText = `🎉 Great job! You've earned ${config.points.dailyAmount} points for your daily progress!`;
            
            if (streakInfo.currentStreak > 0) {
                feedbackText += `\n🔥 Current streak: **${streakInfo.currentStreak} day${streakInfo.currentStreak !== 1 ? 's' : ''}**!`;
                
                if (streakInfo.currentStreak >= 7) {
                    feedbackText += ` Amazing consistency! 🏆`;
                } else if (streakInfo.currentStreak >= 3) {
                    feedbackText += ` Keep it up! 💪`;
                }
            }
            
            await this.sendFeedback(message, feedbackText);
        } catch (error) {
            console.error('Error sending success feedback:', error);
        }
    }

    // Get handler statistics
    getStats() {
        return {
            activeCooldowns: this.cooldowns.size,
            timestamp: new Date().toISOString()
        };
    }

    // Clear all cooldowns (for testing or admin purposes)
    clearCooldowns() {
        this.cooldowns.clear();
        console.log('All message handler cooldowns cleared');
    }
}

module.exports = new MessageHandler();