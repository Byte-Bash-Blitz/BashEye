// src/services/aiService.js
const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('../config/config');

// Initialize the AI client
const genAI = new GoogleGenerativeAI(config.gemini.apiKey);
const genAIModel = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

/**
 * Validates the progress text for genuineness.
 * Provides a "savage" reason if not genuine.
 */
async function validateProgressText(text) {
    try {
        const prompt = `
            You are a strict, witty, and slightly "savage" validator for a daily progress system on a server.
            Your job is to determine if a user's post is a "genuine update" or "not genuine".
            You MUST filter out clear spam, song lyrics, and posts that just try to meet the word count.
            Progress can be about coding, design, personal life (reading, cleaning), or tech rants.

            "Genuine update" (ALLOW THESE):
            - Coding tasks, problems, concepts learned.
            - Personal achievements (e.g., "was consistent", "read a book", "fixed my room").
            - Tech rants (e.g., "I use Arch btw").

            "Not genuine" (BLOCK THESE):
            - Obvious song lyrics.
            - Spam, gibberish, or random keyboard mashing.
            - Messages that ONLY talk about meeting the word count (e.g., "I am writing this just to get 35 words", "this is filler to pass the check", "I guess that's 35 words. Hehe").
            - anything that seems like it's trying to game the system rather than share real progress.
            - Repetitive messages that add no new information (e.g., "I am coding", "I am coding", "I am coding").
            - Completely irrelevant content (e.g., "The sky is blue", "I like turtles").

            Analyze the user text. Return a JSON object in this exact format:
            {"isGenuine": true/false, "reason": "A brief, witty, or 'savage' explanation for your decision if not genuine, or a simple 'OK' if genuine."}

            User Text:
            "${text}"
        `;

        const result = await genAIModel.generateContent(prompt);
        const response = await result.response;
        const responseText = response.text();
        
        // Clean up the response and parse it as JSON
        const jsonResponse = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(jsonResponse);

    } catch (error) {
        console.error('Error in AI validation:', error);
        return { 
            isGenuine: true, // Fail open if AI has an error
            reason: 'AI validation service failed.' 
        };
    }
}

/**
 * Generates constructive feedback for a genuine progress update.
 */
async function getEnhancedFeedback(text) {
    try {
        const prompt = `
            A user just posted a genuine progress update. Provide helpful, constructive feedback in a JSON format.
            Analyze the text for:
            1.  **grammar**: A brief comment on grammar or clarity, pinpoint the issues. If it's good, say so. If not, provide one small tip.
            2.  **suggestion**: A simple, actionable suggestion for their next step or to improve their post.
            3.  **topic**: Identify the single main topic (e.g., "JavaScript", "React", "Personal Consistency", "Reading", "Time Management").

            Return a JSON object in this exact format:
            {"grammar": "...", "suggestion": "...", "topic": "..."}

            User Text:
            "${text}"
        `;

        const result = await genAIModel.generateContent(prompt);
        const response = await result.response;
        const responseText = response.text();

        const jsonResponse = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(jsonResponse);

    } catch (error) {
        console.error('Error in AI feedback generation:', error);
        return null; // Return null if feedback generation fails
    }
}

/**
 * Gets a random fact or quote related to a topic.
 */
async function getRelevantFact(topic) {
    try {
        const prompt = `Give me one interesting, short fact or insightful quote related to "${topic}".`;
        
        const result = await genAIModel.generateContent(prompt);
        const response = await result.response;
        return response.text().trim().replace(/"/g, ''); // Clean up quotes

    } catch (error) {
        console.error('Error getting random fact:', error);
        // Provide a good fallback quote
        return "The secret of getting ahead is getting started. – Mark Twain"; 
    }
}

module.exports = {
    validateProgressText,
    getEnhancedFeedback,
    getRelevantFact
};