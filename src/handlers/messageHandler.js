// src/handlers/messageHandler.js
const { ChannelType } = require('discord.js');
const database = require('../database/supabase');
const streakService = require('../services/streakService');
const config = require('../config/config');
const aiService = require('../services/aiService');
const timeHelper = require('../utils/timeHelper');
const clanProgressService = require('../services/clanProgressService');
const clanConfig = require('../config/clanConfig');


class MessageHandler {
    constructor() {
        // Concurrency lock to prevent rapid duplicate event processing for the same user
        this.processingMembers = new Set();
    }

    async handleMessage(message) {
        // Prevent race conditions from concurrent message delivery for the same user
        if (message.author && this.processingMembers.has(message.author.id)) {
            console.log(`⏳ Submission already in-flight for ${message.author.username} (${message.author.id}) — skipping concurrent event.`);
            return;
        }

        try {
            if (message.author) {
                this.processingMembers.add(message.author.id);
            }

            // Skip bot messages
            if (message.author.bot) return;

            // Debug logging for channel structure
            // console.log(`📧 New message from ${message.author.username}`);
            // console.log(`📍 Channel: ${message.channel.name} (ID: ${message.channel.id})`);
            // console.log(`📂 Channel Type: ${message.channel.type}`);
            if (message.channel.parent) {
                // console.log(`📁 Parent: ${message.channel.parent.name} (ID: ${message.channel.parent.id})`);
                if (message.channel.parent.parent) {
                    console.log(`📁 Grandparent: ${message.channel.parent.parent.name} (ID: ${message.channel.parent.parent.id})`);
                }
            }
            // console.log(`🎯 Expected Category ID: ${config.discord.basherProgressCategoryId}`);

            // ── MULTI-CLAN PROGRESS SYSTEM ──
            const targetChannelId = clanProgressService.resolveProgressChannelId(message.channel);
            const isMonitoredClanChannel = clanConfig.isClanProgressChannel(targetChannelId);

            let detectedClan = null;
            if (isMonitoredClanChannel) {
                const clanValidation = await clanProgressService.validateClanSubmission(message);
                if (!clanValidation.valid) {
                    // Section 6: Messages failing clan validation are ignored without public response
                    return;
                }
                detectedClan = clanValidation.clan;
            } else {
                // If message is sent outside configured clan progress channels, check legacy category
                if (!this.isInBasherProgressCategory(message)) {
                    return; // Ignore completely for clan progress system
                }
            }

            // Check if this is a thread and if the message author is the thread owner
            if (message.channel.type === ChannelType.PublicThread || message.channel.type === ChannelType.PrivateThread) {
                const threadOwner = message.channel.ownerId;
                if (message.author.id !== threadOwner) {
                    return;
                }
            }

            console.log(
                `🔎 Discord identity for lookup: username="${message.author.username}", globalName="${message.author.globalName || ''}", displayName="${message.member?.displayName || ''}", userId="${message.author.id}"`
            );

            // Get member ID from database first
            const memberId = await database.getMemberByDiscordUsername(message.author.username);
            if (!memberId) {
                console.warn(`⚠️ No Supabase member row found for Discord username "${message.author.username}" (userId=${message.author.id})`);
                await this.sendFeedback(message, 'Your Discord username is not registered in our system. Please contact an admin! ⚠️');
                return;
            }

            // Check if points already awarded today - silently ignore if already awarded (skip all validation)
            const dateString = config.getTodayDateString();
            const todayIST = config.getISTDateString();
            const description = detectedClan ? `PU-${detectedClan.id}-${dateString}` : `PU-${dateString}`;
            
            // NEW: Time constraint check (11am IST)
            const istHour = timeHelper.getIstHour();
            if (istHour < 11) {
                console.log(`⏱️ Ignoring submission from ${message.author.username} - outside allowed hours (Current IST hour: ${istHour})`);
                await this.sendFeedback(message, "You can do more today. Keep grinding and share your full day's progress by the end of the day.");
                return;
            }

            // Duplicate check: check points table and clan progress store
            const alreadyAwardedPoints = await database.checkDailyPointsAwarded(memberId, description) ||
                                         await database.checkDailyPointsAwarded(memberId, `PU-${dateString}`);
            const alreadyAwardedClan = detectedClan
                ? await clanProgressService.hasSubmittedToday(detectedClan.id, message.author.id, todayIST)
                : false;

            if (alreadyAwardedPoints || alreadyAwardedClan) {
                console.log(`ℹ️ ${message.author.username} already received points/submitted today - ignoring message (no validation needed)`);
                if (detectedClan && !alreadyAwardedClan) {
                    await clanProgressService.recordSubmission({
                        userId: message.author.id,
                        username: message.author.username,
                        memberId: memberId,
                        clanId: detectedClan.id,
                        clanName: detectedClan.name,
                        channelId: detectedClan.progressChannelId,
                        submissionDate: todayIST
                    });
                }
                return; // Silently ignore without any validation or feedback
            }

            // Check for recent submissions (deployment-safe spam prevention)
            const hasRecentSubmission = await database.checkRecentSubmission(memberId, 2);
            if (hasRecentSubmission) {
                console.log(`Ignoring rapid submission from ${message.author.username} - recent submission within 2 minutes`);
                return;
            }

            // 1. Basic Criteria Check
            if (!this.meetsCriteria(message)) {
                await this.sendFeedback(message, `Your progress post needs to include a screenshot/image and at least ${config.points.minimumWords} words of description! 📝`);
                return;
            }

            // 2. NEW: AI Validation
            console.log(`🤖 Running AI validation for ${message.author.username}...`);
            const aiValidation = await aiService.validateProgressText(message.content);

            // --- SAVAGE REPLY LOGIC ---
            if (!aiValidation.isGenuine) {
                console.log(`❌ AI check FAILED for ${message.author.username}. Reason: ${aiValidation.reason}`);
                // Send the new "savage" reason from the AI
                await this.sendFeedback(message, `🤦 **AI Feedback:** ${aiValidation.reason}\n\nTry again with a real update!`);
                return; // Stop processing
            }

            console.log(`✅ AI check PASSED for ${message.author.username}.`);
            // --- END AI VALIDATION ---

            // 3. Award points
            const success = await database.awardPoints(memberId, config.points.dailyAmount, description);
            if (!success) {
                // Final safety check: see if points actually exist in database (e.g. response timeout after commit)
                const verified = await database.checkDailyPointsAwarded(memberId, description);
                if (!verified) {
                    await this.sendFeedback(message, 'There was an error awarding your points. Please contact an admin! ⚠️');
                    return;
                }
            }

            // 4. Update streak
            const streakInfo = await streakService.handleDailySubmission(memberId);

            // 5. Record clan progress independently
            if (detectedClan) {
                await clanProgressService.recordSubmission({
                    userId: message.author.id,
                    username: message.author.username,
                    memberId: memberId,
                    clanId: detectedClan.id,
                    clanName: detectedClan.name,
                    channelId: detectedClan.progressChannelId,
                    submissionDate: todayIST,
                    pointsAwarded: config.points.dailyAmount,
                    streak: streakInfo.currentStreak || 1
                });
            }

            // 5. --- NEW ENHANCED FEEDBACK ---
            let enhancedFeedback = null;
            try {
                console.log(`🤖 Generating enhanced feedback for ${message.author.username}...`);
                // Get the feedback object (grammar, suggestion, topic)
                const feedbackData = await aiService.getEnhancedFeedback(message.content);
                if (feedbackData) {
                    // Get a random fact based on the topic
                    const fact = await aiService.getRelevantFact(feedbackData.topic);
                    enhancedFeedback = {
                        grammar: feedbackData.grammar,
                        suggestion: feedbackData.suggestion,
                        fact: fact
                    };
                }
            } catch (e) {
                console.error("Failed to generate full AI feedback", e);
                // Continue without feedback if this part fails
            }
            // --- END ENHANCED FEEDBACK ---
            // React to the message to show it was processed
            try {
                await message.react('✅');
            } catch (error) {
                console.error('Error reacting to message:', error);
            }

            // Send success feedback with streak information
            await this.sendSuccessFeedback(message, streakInfo, enhancedFeedback);

            console.log(`Successfully awarded ${config.points.dailyAmount} points to ${message.author.username} (Member ID: ${memberId}). Streak: ${streakInfo.currentStreak} days`);

        } catch (error) {
            console.error('Error handling message:', error);
            await this.sendFeedback(message, 'An unexpected error occurred. Please try again later! 🔧');
        } finally {
            if (message.author) {
                this.processingMembers.delete(message.author.id);
            }
        }
    }

    isInBasherProgressCategory(message) {
        try {
            const channel = message.channel;
            console.log(`Checking channel: ${channel.name} (ID: ${channel.id}), Type: ${channel.type}`);
            
            // Handle forum threads (messages in forum channel threads)
            if ((channel.type === ChannelType.PublicThread || channel.type === ChannelType.PrivateThread) && channel.parent) {
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
        const hasImageAttachment = message.attachments.size > 0 && 
               message.attachments.some(attachment => 
                   attachment.contentType && attachment.contentType.startsWith('image/')
               );
        const wordCount = message.content.split(/\s+/).filter(word => word.length > 0).length;
        const hasEnoughWords = wordCount >= config.points.minimumWords;
        
        console.log(`Message criteria check - Image attachments: ${hasImageAttachment}, Word count: ${wordCount}/${config.points.minimumWords}, Meets criteria: ${hasImageAttachment && hasEnoughWords}`);
        
        return hasImageAttachment && hasEnoughWords;
    }

    async sendFeedback(message, feedbackText) {
        try {
            // Discord has a 2000 character limit
            if (feedbackText.length > 2000) {
                console.warn(`⚠️ Feedback too long (${feedbackText.length} chars), truncating...`);
                feedbackText = feedbackText.substring(0, 1997) + '...';
            }
            // Try to send as a reply first
            await message.reply(feedbackText);
            console.log(`📨 Reply sent in ${message.channel.name}`);
        } catch (error) {
            console.error('Error sending reply:', error.message, '| Code:', error.code);
            try {
                // Fallback to DM
                await message.author.send(feedbackText);
                console.log(`📨 DM sent to ${message.author.username}`);
            } catch (dmError) {
                console.error('Error sending DM:', dmError.message, '| Code:', dmError.code);
            }
        }
    }

    async sendSuccessFeedback(message, streakInfo, aiFeedback = null) {
        try {
            let feedbackText = `Appreciation for updating your daily progress, Basher ${message.author.username}. You’ve been awarded 5 points for your update ${new Date().toLocaleDateString()} `;
            
            if (streakInfo.currentStreak > 0) {
                feedbackText += `\nCurrent streak: **${streakInfo.currentStreak} day${streakInfo.currentStreak !== 1 ? 's' : ''}**!`;
                
                if (streakInfo.currentStreak >= 7) {
                    feedbackText += ` Amazing consistency!`;
                } else if (streakInfo.currentStreak >= 3) {
                    feedbackText += ` Keep it up!`;
                }
            }
            
            // --- NEW AI FEEDBACK BLOCK ---
            if (aiFeedback) {
                feedbackText += `\n\n--- 🤖 **AI Coach's Feedback** ---\n`;
                if (aiFeedback.grammar) {
                    feedbackText += `**Clarity Tip:** ${aiFeedback.grammar}\n`;
                }
                if (aiFeedback.suggestion) {
                    feedbackText += `**Next Step:** ${aiFeedback.suggestion}\n`;
                }
                if (aiFeedback.fact) {
                    feedbackText += `**Topic Fact:** ${aiFeedback.fact}`;
                }
            }
            // --- END AI FEEDBACK BLOCK ---
            // Send success feedback
            await this.sendFeedback(message, feedbackText);
        } catch (error) {
            console.error('Error sending success feedback:', error);
        }
    }

    // Get handler statistics
    getStats() {
        return {
            status: 'deployment-safe',
            duplicatePrevention: 'database-based',
            timestamp: new Date().toISOString()
        };
    }
}

module.exports = new MessageHandler();