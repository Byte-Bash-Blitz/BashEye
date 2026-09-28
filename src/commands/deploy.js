// src/commands/deploy.js
const { REST, Routes } = require('discord.js');
const config = require('../config/config');
const slashCommands = require('../handlers/slashCommands');

async function deployCommands() {
    const commands = slashCommands.getCommandData();

    // Construct and prepare an instance of the REST module
    const rest = new REST().setToken(config.discord.token);

    try {
        console.log(`🚀 Started refreshing ${commands.length} application (/) commands.`);

        const guildIds = (config.discord.allowedGuildIds && config.discord.allowedGuildIds.length > 0)
            ? config.discord.allowedGuildIds
            : [config.discord.guildId].filter(Boolean);

        for (const targetGuildId of guildIds) {
            try {
                const data = await rest.put(
                    Routes.applicationGuildCommands(config.discord.clientId, targetGuildId),
                    { body: commands },
                );
                console.log(`✅ Successfully reloaded ${data.length} commands for guild ${targetGuildId}.`);
            } catch (guildErr) {
                console.warn(`⚠️ Could not deploy commands to guild ${targetGuildId}:`, guildErr.message);
            }
        }
        
    } catch (error) {
        console.error('❌ Error deploying commands:', error);
    }
}

// Auto-deploy if run directly
if (require.main === module) {
    deployCommands();
}

module.exports = { deployCommands };