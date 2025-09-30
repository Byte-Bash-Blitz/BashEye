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

        // The put method is used to fully refresh all commands in the guild with the current set
        const data = await rest.put(
            Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
            { body: commands },
        );

        console.log(`✅ Successfully reloaded ${data.length} application (/) commands.`);
        
        // Display registered commands
        console.log('\n📋 Registered Commands:');
        data.forEach(command => {
            console.log(`  • /${command.name} - ${command.description}`);
        });
        
    } catch (error) {
        console.error('❌ Error deploying commands:', error);
    }
}

// Auto-deploy if run directly
if (require.main === module) {
    deployCommands();
}

module.exports = { deployCommands };