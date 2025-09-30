// src/index.js
const discordClient = require('./bot/client');
const apiServer = require('./api/server');
const config = require('./config/config');

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Received SIGINT, shutting down gracefully...');
    
    try {
        await apiServer.stop();
        await discordClient.stop();
        console.log('✅ Shutdown complete');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error during shutdown:', error);
        process.exit(1);
    }
});

process.on('SIGTERM', async () => {
    console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
    
    try {
        await apiServer.stop();
        await discordClient.stop();
        console.log('✅ Shutdown complete');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error during shutdown:', error);
        process.exit(1);
    }
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('💥 Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

// Main application startup
async function main() {
    try {
        console.log('🚀 Starting Byte-Bash-Blitz Discord Bot...');
        console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`🔧 Configuration loaded successfully`);
        
        // Start Discord bot
        console.log('\n🤖 Initializing Discord client...');
        await discordClient.start();
        
        // Start API server
        console.log('\n🌐 Starting API server...');
        await apiServer.start();
        
        console.log('\n✅ All services started successfully!');
        console.log(`🔗 API available at: http://localhost:${config.server.port}`);
        console.log(`🤖 Bot status: ${discordClient.isReady() ? 'Online' : 'Offline'}`);
        console.log('\n📊 Bot Features:');
        console.log('  • Daily progress point awarding (5 points)');
        console.log('  • Streak tracking and persistence');
        console.log('  • Spam prevention with duplicate detection');
        console.log('  • User feedback and notifications');
        console.log('  • REST API endpoints for monitoring');
        console.log('  • Automatic category detection');
        console.log('\n🎯 Monitoring category: basher-progress');
        console.log('📝 Requirements: Screenshot + 35+ words');
        
    } catch (error) {
        console.error('💥 Failed to start application:', error);
        process.exit(1);
    }
}

// Start the application
main().catch((error) => {
    console.error('💥 Fatal error during startup:', error);
    process.exit(1);
});