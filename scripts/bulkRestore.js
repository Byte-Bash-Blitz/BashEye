// scripts/bulkRestore.js
const database = require('../src/database/supabase');
const fs = require('fs');
const path = require('path');

async function bulkRestore() {
    const dataPath = path.join(__dirname, 'impacted_users.json');
    const users = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

    console.log(`Starting bulk restoration for ${users.length} users...`);

    for (const user of users) {
        try {
            const memberId = await database.getMemberByDiscordUsername(user.discord_username);
            if (!memberId) {
                console.error(`❌ Member ${user.discord_username} not found.`);
                continue;
            }

            // Update streak
            await database.updateDiscordStreak(memberId, user.streak);
            console.log(`✅ Restored streak for ${user.discord_username} to ${user.streak}`);
        } catch (error) {
            console.error(`❌ Error restoring ${user.discord_username}:`, error);
        }
    }
    console.log('Bulk restoration complete.');
    process.exit(0);
}

bulkRestore();
