// src/services/aiService.js
const config = require('../config/config');

/**
 * Make a request to OpenRouter API
 */
async function makeOpenRouterRequest(prompt) {
    try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.openrouter.apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://github.com/bash-eye',
                'X-Title': 'BashEye Discord Bot'
            },
            body: JSON.stringify({
                model: config.openrouter.model,
                messages: [
                    {
                        role: 'user',
                        content: prompt
                    }
                ]
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`OpenRouter API error: ${response.status} ${response.statusText}`);
            console.error(`Error details: ${errorText}`);
            throw new Error(`OpenRouter API error: ${response.status} ${response.statusText} - ${errorText}`);
        }

        const data = await response.json();
        
        // Validate response structure
        if (!data.choices || !data.choices[0] || !data.choices[0].message) {
            console.error('Invalid OpenRouter response structure:', data);
            throw new Error('Invalid response structure from OpenRouter API');
        }
        
        return data.choices[0].message.content;
    } catch (error) {
        console.error('Error in makeOpenRouterRequest:', error);
        throw error;
    }
}

/**
 * Extract JSON from AI response text
 */
function extractJSON(text) {
    try {
        // Try direct JSON parse first
        return JSON.parse(text);
    } catch (e) {
        // Try to find JSON within the text
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                return JSON.parse(jsonMatch[0]);
            } catch (e2) {
                console.error('Failed to parse extracted JSON:', e2);
            }
        }
        // Try removing markdown code blocks
        const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
        try {
            return JSON.parse(cleaned);
        } catch (e3) {
            console.error('Failed to parse cleaned JSON:', e3);
        }
    }
    return null;
}

/**
 * Validates the progress text for genuineness.
 * Provides a "savage" reason if not genuine.
 */
async function validateProgressText(text) {
    try {
        const prompt = `You are a strict, witty, and slightly "savage" validator for a daily progress system.
Your job is to determine if a user's post is a "genuine update" or "not genuine".
Filter out spam, song lyrics, and posts that just try to meet the word count.
Progress can be about coding, design, personal life (reading, cleaning), or tech rants.

"Genuine update" (ALLOW):
- Coding tasks, problems, concepts learned.
- Personal achievements (reading, cleaning, consistency).
- Tech rants ("I use Arch btw").

"Not genuine" (BLOCK):
- Song lyrics.
- Spam, gibberish, keyboard mashing.
- Messages ONLY about meeting word count.
- Gaming the system.
- Repetitive filler.
- Completely irrelevant content.

Analyze the user text. Return ONLY a JSON object in this exact format:
{"isGenuine": true, "reason": "OK"}
or
{"isGenuine": false, "reason": "Brief witty explanation"}

User Text:
"${text.replace(/"/g, '\\"')}"`;

        const responseText = await makeOpenRouterRequest(prompt);
        console.log('Raw AI validation response:', responseText);
        
        const parsed = extractJSON(responseText);
        
        if (!parsed || typeof parsed.isGenuine !== 'boolean') {
            console.error('Failed to parse valid JSON from AI response:', responseText);
            // Fail open - allow the message if AI can't validate properly
            return { 
                isGenuine: true, 
                reason: 'AI validation parsing failed.' 
            };
        }
        
        return parsed;

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
        const prompt = `You are a friendly AI coach providing detailed constructive feedback on daily progress updates.

Analyze this progress update and provide feedback in JSON format:
{"grammar": "Grammar/clarity feedback", "suggestion": "Actionable suggestion for next steps", "topic": "Main topic (e.g., 'JavaScript', 'fitness', 'design')"}

IMPORTANT: 
- Grammar field: STRICTLY 10-15 words MAX, one short sentence
- Suggestion field: STRICTLY 15-25 words MAX, one short sentence
- Topic field: 1-3 words only
- Be specific but extremely concise
- Total feedback MUST be under 50 words

User Text:
"${text.replace(/"/g, '\\"')}"`;

        const responseText = await makeOpenRouterRequest(prompt);
        console.log('Raw AI feedback response:', responseText);
        
        const parsed = extractJSON(responseText);
        
        if (!parsed || !parsed.topic) {
            console.error('Failed to parse feedback JSON:', responseText);
            return null;
        }
        
        return parsed;

    } catch (error) {
        console.error('Error in enhanced feedback:', error);
        return null;
    }
}

/**
 * Gets a random fact or quote related to a topic.
 */
async function getRelevantFact(topic) {
    try {
        const prompt = `Provide ONE interesting fact in UNDER 80 characters related to: ${topic}
Return ONLY the fact as plain text, no quotes, no extra formatting. Keep it very short.`;

        const fact = await makeOpenRouterRequest(prompt);
        return fact.trim();

    } catch (error) {
        console.error('Error generating fact:', error);
        return null;
    }
}

module.exports = {
    validateProgressText,
    getEnhancedFeedback,
    getRelevantFact
};