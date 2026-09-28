#!/usr/bin/env node
// scripts/testClanReminder.js - Test script for Clan DM Reminders
require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const config = require('../src/config/config');
const clanConfig = require('../src/config/clanConfig');
const clanProgressService = require('../src/services/clanProgressService');
const clanReminderService = require('../src/services/clanReminderService');

async function main() {
    console.log('============================================================');
    console.log('🧪 BASHEYE CLAN DM REMINDER TEST UTILITY');
    console.log('============================================================\n');

    if (!config.discord.token) {
        console.error('❌ DISCORD_BOT_TOKEN is missing in .env');
        process.exit(1);
    }

    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMembers
        ]
    });

    try {
        console.log('🤖 Logging into Discord to run live reminder test...');
        await client.login(config.discord.token);
        console.log(`✅ Logged in as ${client.user.tag}\n`);

        const args = process.argv.slice(2);
        const dryRun = !args.includes('--live');

        // Parse --user <userId>
        let targetUserId = null;
        const userIdx = args.indexOf('--user');
        if (userIdx !== -1 && args[userIdx + 1]) {
            targetUserId = args[userIdx + 1];
        }

        // Parse --clan <clanId> or positional clan argument
        let specificClanArg = null;
        const clanIdx = args.indexOf('--clan');
        if (clanIdx !== -1 && args[clanIdx + 1]) {
            specificClanArg = args[clanIdx + 1];
        } else {
            specificClanArg = args.find(a => !a.startsWith('--') && a !== targetUserId);
        }

        console.log(`Mode: ${dryRun ? '🔍 DRY RUN (Simulating, no actual DMs sent)' : '📨 LIVE (Real DMs will be dispatched)'}`);
        if (targetUserId) {
            console.log(`🎯 Target Member: ${targetUserId}`);
        }
        if (specificClanArg) {
            console.log(`🛡️ Target Clan: ${specificClanArg}`);
        }
        if (dryRun) {
            console.log('💡 Pass --live to send real DMs: node scripts/testClanReminder.js --live\n');
        }

        const summary = await clanReminderService.runReminders(client, {
            dryRun,
            specificClanId: specificClanArg || null,
            specificUserId: targetUserId || null
        });

        console.log('\n📊 Summary of Reminder Check:');
        console.log(JSON.stringify(summary, null, 2));

        console.log('\n✅ Reminder test completed successfully.');
    } catch (err) {
        console.error('❌ Error during reminder test:', err);
    } finally {
        await client.destroy();
        process.exit(0);
    }
}

if (require.main === module) {
    main();
}

module.exports = { main };
