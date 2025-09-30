#!/usr/bin/env node
// deployCommands.js - Standalone script to deploy slash commands

require('dotenv').config();
const { deployCommands } = require('./src/commands/deploy');

deployCommands()
    .then(() => {
        console.log('✅ Commands deployed successfully!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('❌ Failed to deploy commands:', error);
        process.exit(1);
    });