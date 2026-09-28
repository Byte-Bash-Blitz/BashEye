// tests/apiEndpoints.test.js
const assert = require('assert');
const express = require('express');
const clanConfig = require('../src/config/clanConfig');
const config = require('../src/config/config');
const clanProgressService = require('../src/services/clanProgressService');
const apiServer = require('../src/api/server');

(async () => {
    try {
        console.log('🧪 Testing API endpoints for Multi-Clan system...');

        // Start the server on a test port
        const testPort = 3199;
        process.env.PORT = testPort;
        
        const server = apiServer.app.listen(testPort, async () => {
            try {
                // Test 1: GET /clans
                const clansRes = await fetch(`http://localhost:${testPort}/clans`);
                assert.strictEqual(clansRes.status, 200);
                const clansData = await clansRes.json();
                assert.ok(clansData.clans);
                assert.strictEqual(clansData.clans.aura7f.name, 'AURA 7F');
                assert.strictEqual(clansData.clans.belmont.name, 'BELMONT');
                assert.strictEqual(clansData.clans.lumina.name, 'LUMINA');
                assert.strictEqual(clansData.clans.shadastria.name, 'SHADASTRIA');
                console.log('✅ GET /clans working');

                // Test 2: GET /clans/aura7f/stats
                const statsRes = await fetch(`http://localhost:${testPort}/clans/aura7f/stats`);
                assert.strictEqual(statsRes.status, 200);
                const statsData = await statsRes.json();
                assert.strictEqual(statsData.clan.name, 'AURA 7F');
                assert.ok(statsData.stats);
                console.log('✅ GET /clans/:clanId/stats working');

                // Test 3: POST /clans/reminders/trigger (dry run)
                const reminderRes = await fetch(`http://localhost:${testPort}/clans/reminders/trigger`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ dryRun: true, clanId: 'aura7f' })
                });
                assert.strictEqual(reminderRes.status, 200);
                const reminderData = await reminderRes.json();
                assert.strictEqual(reminderData.dryRun, true);
                console.log('✅ POST /clans/reminders/trigger working');

                // Test 4: Existing /health endpoint
                const healthRes = await fetch(`http://localhost:${testPort}/health`);
                assert.strictEqual(healthRes.status, 200);
                const healthData = await healthRes.json();
                assert.strictEqual(healthData.status, 'healthy');
                console.log('✅ Existing GET /health working');

                console.log('🎉 ALL API ENDPOINT TESTS PASSED!');
                server.close(() => {
                    process.exit(0);
                });
            } catch (err) {
                console.error('❌ API test failed:', err);
                server.close(() => {
                    process.exit(1);
                });
            }
        });
    } catch (e) {
        console.error('Fatal error in API tests:', e);
        process.exit(1);
    }
})();
