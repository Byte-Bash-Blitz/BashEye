require('dotenv').config(); // Load .env if it exists
const config = require('../src/config/config');
const supabaseService = require('../src/database/supabase');

async function listMembers() {
    try {
        // Force re-auth
        await supabaseService.initializeAuth();
        
        const client = await supabaseService.getClient();
        
        const { data, error } = await client
            .from('member_stats')
            .select('discord_streak, members(discord_username)')
            .gt('discord_streak', 1);

        if (error) {
            console.error('Error fetching data:', error);
            return;
        }

        const results = data.map(item => ({
            username: item.members?.discord_username || 'Unknown',
            streak: item.discord_streak
        }));
        
        console.log(JSON.stringify(results, null, 2));
    } catch (err) {
        console.error('Script Error:', err);
    }
}

listMembers();
