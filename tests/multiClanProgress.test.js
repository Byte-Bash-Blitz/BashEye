// tests/multiClanProgress.test.js
const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Load configurations and services
const clanConfig = require('../src/config/clanConfig');
const config = require('../src/config/config');
const clanProgressService = require('../src/services/clanProgressService');
const clanReminderService = require('../src/services/clanReminderService');
const database = require('../src/database/supabase');

// Set up clean test environment
const testDataDir = path.join(__dirname, '../data');
if (!fs.existsSync(testDataDir)) {
    fs.mkdirSync(testDataDir, { recursive: true });
}
const testStoreFile = path.join(testDataDir, 'clan_progress.json');

// Backup existing testStoreFile if any
let existingStoreBackup = null;
if (fs.existsSync(testStoreFile)) {
    existingStoreBackup = fs.readFileSync(testStoreFile, 'utf8');
}

// Reset test data
fs.writeFileSync(testStoreFile, JSON.stringify({ submissions: [] }, null, 2), 'utf8');

console.log('============================================================');
console.log('🧪 RUNNING BASHEYE MULTI-CLAN PROGRESS SYSTEM TEST SUITE');
console.log('============================================================\n');

let passedTests = 0;
let totalTests = 0;

function runTest(testNumber, testName, testFn) {
    totalTests++;
    try {
        console.log(`▶ TEST ${testNumber}: ${testName}`);
        testFn();
        passedTests++;
        console.log(`✅ TEST ${testNumber} PASSED\n`);
    } catch (err) {
        console.error(`❌ TEST ${testNumber} FAILED:`, err.message);
        console.error(err.stack);
        console.log('');
    }
}

async function runAsyncTest(testNumber, testName, testFn) {
    totalTests++;
    try {
        console.log(`▶ TEST ${testNumber}: ${testName}`);
        await testFn();
        passedTests++;
        console.log(`✅ TEST ${testNumber} PASSED\n`);
    } catch (err) {
        console.error(`❌ TEST ${testNumber} FAILED:`, err.message);
        console.error(err.stack);
        console.log('');
    }
}

// Helper to create mock member with roles
function createMockMember(id, username, roleIds = []) {
    const rolesMap = new Map();
    roleIds.forEach(rId => rolesMap.set(rId, { id: rId }));
    return {
        id,
        user: { id, username, tag: `${username}#0001`, bot: false },
        roles: {
            cache: rolesMap
        },
        send: async (msg) => {
            return { id: `dm-${Date.now()}`, content: msg };
        }
    };
}

// Helper to create mock message
function createMockMessage(author, channelId, content = 'Daily progress update with sufficient words and details for verification testing', isThread = false, parentId = null) {
    return {
        author: author.user,
        member: author,
        channel: {
            id: isThread ? `thread-${channelId}` : channelId,
            parentId: isThread ? channelId : null,
            parent: isThread ? { id: channelId } : null,
            isThread: () => isThread,
            type: isThread ? 11 : 0
        },
        attachments: new Map([
            ['att1', { contentType: 'image/png', url: 'https://example.com/test.png' }]
        ]),
        content,
        react: async (emoji) => {}
    };
}

(async () => {
    try {
        const AURA_ROLE = '1364585878282043479';
        const AURA_CHANNEL = '1351223274750869554';

        const BELMONT_ROLE = '1364584863880974386';
        const BELMONT_CHANNEL = '1351223371987161179';

        const LUMINA_ROLE = '1364586296055431229';
        const LUMINA_CHANNEL = '1351223462554763414';

        const SHADASTRIA_ROLE = '1364586658628108390';
        const SHADASTRIA_CHANNEL = '1351223714355744828';

        // TEST 1: AURA 7F member posts in AURA 7F channel. → Valid.
        await runAsyncTest(1, 'AURA 7F member posts in AURA 7F channel → Valid', async () => {
            const member = createMockMember('user-aura-1', 'AuraHero', [AURA_ROLE]);
            const message = createMockMessage(member, AURA_CHANNEL);
            const result = await clanProgressService.validateClanSubmission(message);

            assert.strictEqual(result.isMonitoredClanChannel, true);
            assert.strictEqual(result.valid, true);
            assert.strictEqual(result.clan.id, 'aura7f');
            assert.strictEqual(result.clan.name, 'AURA 7F');
        });

        // TEST 2: BELMONT member posts in BELMONT channel. → Valid.
        await runAsyncTest(2, 'BELMONT member posts in BELMONT channel → Valid', async () => {
            const member = createMockMember('user-belmont-1', 'BelmontWarrior', [BELMONT_ROLE]);
            const message = createMockMessage(member, BELMONT_CHANNEL);
            const result = await clanProgressService.validateClanSubmission(message);

            assert.strictEqual(result.isMonitoredClanChannel, true);
            assert.strictEqual(result.valid, true);
            assert.strictEqual(result.clan.id, 'belmont');
            assert.strictEqual(result.clan.name, 'BELMONT');
        });

        // TEST 3: LUMINA member posts in LUMINA channel. → Valid.
        await runAsyncTest(3, 'LUMINA member posts in LUMINA channel → Valid', async () => {
            const member = createMockMember('user-lumina-1', 'LuminaSage', [LUMINA_ROLE]);
            const message = createMockMessage(member, LUMINA_CHANNEL);
            const result = await clanProgressService.validateClanSubmission(message);

            assert.strictEqual(result.isMonitoredClanChannel, true);
            assert.strictEqual(result.valid, true);
            assert.strictEqual(result.clan.id, 'lumina');
            assert.strictEqual(result.clan.name, 'LUMINA');
        });

        // TEST 4: SHADASTRIA member posts in SHADASTRIA channel. → Valid.
        await runAsyncTest(4, 'SHADASTRIA member posts in SHADASTRIA channel → Valid', async () => {
            const member = createMockMember('user-shadastria-1', 'ShadastriaRanger', [SHADASTRIA_ROLE]);
            const message = createMockMessage(member, SHADASTRIA_CHANNEL);
            const result = await clanProgressService.validateClanSubmission(message);

            assert.strictEqual(result.isMonitoredClanChannel, true);
            assert.strictEqual(result.valid, true);
            assert.strictEqual(result.clan.id, 'shadastria');
            assert.strictEqual(result.clan.name, 'SHADASTRIA');
        });

        // TEST 5: AURA 7F member posts in BELMONT channel. → Invalid.
        await runAsyncTest(5, 'AURA 7F member posts in BELMONT channel → Invalid', async () => {
            const member = createMockMember('user-aura-cross', 'AuraCross', [AURA_ROLE]);
            const message = createMockMessage(member, BELMONT_CHANNEL);
            const result = await clanProgressService.validateClanSubmission(message);

            assert.strictEqual(result.isMonitoredClanChannel, true);
            assert.strictEqual(result.valid, false);
            assert.strictEqual(result.reason, 'CHANNEL_MISMATCH');
            assert.strictEqual(result.clan.id, 'aura7f');
            assert.strictEqual(result.channelClan.id, 'belmont');
        });

        // TEST 6: BELMONT member posts in LUMINA channel. → Invalid.
        await runAsyncTest(6, 'BELMONT member posts in LUMINA channel → Invalid', async () => {
            const member = createMockMember('user-belmont-cross', 'BelmontCross', [BELMONT_ROLE]);
            const message = createMockMessage(member, LUMINA_CHANNEL);
            const result = await clanProgressService.validateClanSubmission(message);

            assert.strictEqual(result.isMonitoredClanChannel, true);
            assert.strictEqual(result.valid, false);
            assert.strictEqual(result.reason, 'CHANNEL_MISMATCH');
            assert.strictEqual(result.clan.id, 'belmont');
            assert.strictEqual(result.channelClan.id, 'lumina');
        });

        // TEST 7: LUMINA member posts in SHADASTRIA channel. → Invalid.
        await runAsyncTest(7, 'LUMINA member posts in SHADASTRIA channel → Invalid', async () => {
            const member = createMockMember('user-lumina-cross', 'LuminaCross', [LUMINA_ROLE]);
            const message = createMockMessage(member, SHADASTRIA_CHANNEL);
            const result = await clanProgressService.validateClanSubmission(message);

            assert.strictEqual(result.isMonitoredClanChannel, true);
            assert.strictEqual(result.valid, false);
            assert.strictEqual(result.reason, 'CHANNEL_MISMATCH');
            assert.strictEqual(result.clan.id, 'lumina');
            assert.strictEqual(result.channelClan.id, 'shadastria');
        });

        // TEST 8: SHADASTRIA member posts in AURA 7F channel. → Invalid.
        await runAsyncTest(8, 'SHADASTRIA member posts in AURA 7F channel → Invalid', async () => {
            const member = createMockMember('user-shadastria-cross', 'ShadastriaCross', [SHADASTRIA_ROLE]);
            const message = createMockMessage(member, AURA_CHANNEL);
            const result = await clanProgressService.validateClanSubmission(message);

            assert.strictEqual(result.isMonitoredClanChannel, true);
            assert.strictEqual(result.valid, false);
            assert.strictEqual(result.reason, 'CHANNEL_MISMATCH');
            assert.strictEqual(result.clan.id, 'shadastria');
            assert.strictEqual(result.channelClan.id, 'aura7f');
        });

        // TEST 9: Member submits twice → Existing duplicate protection works.
        await runAsyncTest(9, 'Member submits twice → Duplicate prevented', async () => {
            const member = createMockMember('user-dup-test', 'DuplicateTester', [AURA_ROLE]);
            const today = config.getISTDateString();

            // First submission
            const hasSubmittedBefore = await clanProgressService.hasSubmittedToday('aura7f', member.id, today);
            assert.strictEqual(hasSubmittedBefore, false);

            await clanProgressService.recordSubmission({
                userId: member.id,
                username: member.user.username,
                clanId: 'aura7f',
                clanName: 'AURA 7F',
                channelId: AURA_CHANNEL,
                submissionDate: today,
                pointsAwarded: 5,
                streak: 1
            });

            // Second submission attempt
            const hasSubmittedAfter = await clanProgressService.hasSubmittedToday('aura7f', member.id, today);
            assert.strictEqual(hasSubmittedAfter, true, 'Second check must report already submitted');
        });

        // TEST 10: Member has no clan role → Not processed as a clan member.
        await runAsyncTest(10, 'Member has no clan role → Ignored for clan system', async () => {
            const member = createMockMember('user-no-clan', 'GuestUser', ['999999999999999999']); // Unrelated role
            const message = createMockMessage(member, AURA_CHANNEL);
            const result = await clanProgressService.validateClanSubmission(message);

            assert.strictEqual(result.isMonitoredClanChannel, true);
            assert.strictEqual(result.valid, false);
            assert.strictEqual(result.reason, 'NO_CLAN_ROLE');
        });

        // Mock Guild and Client for Reminder tests (11-16)
        function createMockGuild(members) {
            const membersMap = new Map();
            members.forEach(m => membersMap.set(m.id, m));
            return {
                id: 'guild-1',
                name: 'Byte-Bash-Blitz',
                members: {
                    cache: membersMap,
                    fetch: async () => membersMap
                }
            };
        }

        // TEST 11: Missing AURA 7F member → DM only with exact clan channel.
        await runAsyncTest(11, 'Missing AURA 7F member → Clan-specific DM only', async () => {
            let receivedDM = null;
            const auraMember = createMockMember('user-aura-missing', 'AuraMissing', [AURA_ROLE]);
            auraMember.send = async (msg) => { receivedDM = msg; };

            const mockGuild = createMockGuild([auraMember]);
            const mockClient = {
                guilds: { cache: new Map([['guild-1', mockGuild]]), first: () => mockGuild }
            };

            const today = '2026-09-10'; // Unused date to guarantee missing status
            const summary = await clanReminderService.processClanReminders(mockGuild, clanConfig.CLANS.aura7f, today, false);

            assert.strictEqual(summary.missingMembers, 1);
            assert.strictEqual(summary.remindersSent, 1);
            assert.ok(receivedDM !== null, 'DM must be sent');
            assert.ok(receivedDM.includes('AURA 7F'), 'DM must specify AURA 7F');
            assert.ok(receivedDM.includes(AURA_CHANNEL), 'DM must include AURA 7F channel ID');
        });

        // TEST 12: Missing BELMONT member → DM only with exact clan channel.
        await runAsyncTest(12, 'Missing BELMONT member → Clan-specific DM only', async () => {
            let receivedDM = null;
            const belmontMember = createMockMember('user-belmont-missing', 'BelmontMissing', [BELMONT_ROLE]);
            belmontMember.send = async (msg) => { receivedDM = msg; };

            const mockGuild = createMockGuild([belmontMember]);
            const today = '2026-09-10';
            const summary = await clanReminderService.processClanReminders(mockGuild, clanConfig.CLANS.belmont, today, false);

            assert.strictEqual(summary.missingMembers, 1);
            assert.strictEqual(summary.remindersSent, 1);
            assert.ok(receivedDM !== null, 'DM must be sent');
            assert.ok(receivedDM.includes('BELMONT'), 'DM must specify BELMONT');
            assert.ok(receivedDM.includes(BELMONT_CHANNEL), 'DM must include BELMONT channel ID');
        });

        // TEST 13: Missing LUMINA member → DM only with exact clan channel.
        await runAsyncTest(13, 'Missing LUMINA member → Clan-specific DM only', async () => {
            let receivedDM = null;
            const luminaMember = createMockMember('user-lumina-missing', 'LuminaMissing', [LUMINA_ROLE]);
            luminaMember.send = async (msg) => { receivedDM = msg; };

            const mockGuild = createMockGuild([luminaMember]);
            const today = '2026-09-10';
            const summary = await clanReminderService.processClanReminders(mockGuild, clanConfig.CLANS.lumina, today, false);

            assert.strictEqual(summary.missingMembers, 1);
            assert.strictEqual(summary.remindersSent, 1);
            assert.ok(receivedDM !== null, 'DM must be sent');
            assert.ok(receivedDM.includes('LUMINA'), 'DM must specify LUMINA');
            assert.ok(receivedDM.includes(LUMINA_CHANNEL), 'DM must include LUMINA channel ID');
        });

        // TEST 14: Missing SHADASTRIA member → DM only with exact clan channel.
        await runAsyncTest(14, 'Missing SHADASTRIA member → Clan-specific DM only', async () => {
            let receivedDM = null;
            const shadastriaMember = createMockMember('user-shad-missing', 'ShadastriaMissing', [SHADASTRIA_ROLE]);
            shadastriaMember.send = async (msg) => { receivedDM = msg; };

            const mockGuild = createMockGuild([shadastriaMember]);
            const today = '2026-09-10';
            const summary = await clanReminderService.processClanReminders(mockGuild, clanConfig.CLANS.shadastria, today, false);

            assert.strictEqual(summary.missingMembers, 1);
            assert.strictEqual(summary.remindersSent, 1);
            assert.ok(receivedDM !== null, 'DM must be sent');
            assert.ok(receivedDM.includes('SHADASTRIA'), 'DM must specify SHADASTRIA');
            assert.ok(receivedDM.includes(SHADASTRIA_CHANNEL), 'DM must include SHADASTRIA channel ID');
        });

        // TEST 15: No missing members → No unnecessary DMs.
        await runAsyncTest(15, 'No missing members → No unnecessary DMs sent', async () => {
            const member = createMockMember('user-aura-submitted', 'AuraDone', [AURA_ROLE]);
            let dmSent = false;
            member.send = async () => { dmSent = true; };

            const testDate = '2026-09-15';
            // Mark member as submitted for today
            await clanProgressService.recordSubmission({
                userId: member.id,
                username: member.user.username,
                clanId: 'aura7f',
                clanName: 'AURA 7F',
                channelId: AURA_CHANNEL,
                submissionDate: testDate,
                pointsAwarded: 5,
                streak: 2
            });

            const mockGuild = createMockGuild([member]);
            const summary = await clanReminderService.processClanReminders(mockGuild, clanConfig.CLANS.aura7f, testDate, false);

            assert.strictEqual(summary.missingMembers, 0);
            assert.strictEqual(summary.completedMembers, 1);
            assert.strictEqual(summary.remindersSent, 0);
            assert.strictEqual(dmSent, false, 'No DM should be sent when member is completed');
        });

        // TEST 16: DM disabled → Log failure, bot continues without crash.
        await runAsyncTest(16, 'DM disabled user → Log failure, bot continues safely', async () => {
            const member = createMockMember('user-dm-closed', 'ClosedDMUser', [AURA_ROLE]);
            member.send = async () => {
                const err = new Error('Cannot send messages to this user');
                err.code = 50007; // Discord error code for DMs blocked
                throw err;
            };

            const mockGuild = createMockGuild([member]);
            const testDate = '2026-09-20';

            const summary = await clanReminderService.processClanReminders(mockGuild, clanConfig.CLANS.aura7f, testDate, false);

            assert.strictEqual(summary.missingMembers, 1);
            assert.strictEqual(summary.remindersFailed, 1);
            assert.strictEqual(summary.details[0].status, 'failed');
            assert.ok(summary.details[0].error.includes('Cannot send messages'), 'Error logged cleanly');
        });

        // TEST 17: Bot restart → Existing data remains safe.
        await runAsyncTest(17, 'Bot restart / reload → Data remains intact', async () => {
            const testDate = '2026-09-25';
            const memberId = 'persisted-user-123';

            await clanProgressService.recordSubmission({
                userId: memberId,
                username: 'PersistentUser',
                clanId: 'belmont',
                clanName: 'BELMONT',
                channelId: BELMONT_CHANNEL,
                submissionDate: testDate,
                pointsAwarded: 5,
                streak: 4
            });

            // Simulate restart by re-instantiating store reading
            const reloadedSubmissions = await clanProgressService.getClanDailySubmissions('belmont', testDate);
            const found = reloadedSubmissions.find(s => s.user_id === memberId);

            assert.ok(found, 'Record must exist after re-reading from disk/database');
            assert.strictEqual(found.clan_id, 'belmont');
            assert.strictEqual(found.submission_status, 'completed');
            assert.strictEqual(found.points_awarded, 5);
        });

        // TEST 18: Existing BashEye features → Verify they work exactly as before.
        await runAsyncTest(18, 'Existing BashEye features → Retain full functionality', async () => {
            // Check meeting channels config
            assert.ok(Array.isArray(config.meetings.channels), 'Meeting channels must be array');
            assert.strictEqual(config.meetings.schedulerChannelId, '1448314979001565216');
            assert.strictEqual(config.discord.basherProgressCategoryId, '1351223065354178722');
            assert.strictEqual(config.points.dailyAmount, 5);
            assert.strictEqual(config.points.minimumWords, 35);

            // Check timezone calculation
            const todayStr = config.getTodayDateString();
            assert.ok(typeof todayStr === 'string' && todayStr.length > 0);
            const istDateStr = config.getISTDateString();
            assert.match(istDateStr, /^\d{4}-\d{2}-\d{2}$/);
        });

        console.log('============================================================');
        console.log(`🏁 TEST RESULTS: ${passedTests}/${totalTests} TESTS PASSED`);
        console.log('============================================================');

        if (passedTests === totalTests) {
            console.log('🎉 ALL 18 MULTI-CLAN PROGRESS TESTS PASSED SUCCESSFULLY!');
            process.exit(0);
        } else {
            console.error(`❌ ${totalTests - passedTests} TESTS FAILED!`);
            process.exit(1);
        }

    } catch (unexpectedErr) {
        console.error('💥 Unexpected error in test suite:', unexpectedErr);
        process.exit(1);
    } finally {
        // Restore backup if needed or keep test data
        if (existingStoreBackup) {
            fs.writeFileSync(testStoreFile, existingStoreBackup, 'utf8');
        }
    }
})();
