// tests/forcePuch.test.js
process.env.NODE_ENV = 'test';
require('dotenv').config();

const assert = require('assert');
const slashCommands = require('../src/handlers/slashCommands');
const clanConfig = require('../src/config/clanConfig');
const clanProgressService = require('../src/services/clanProgressService');
const config = require('../src/config/config');

console.log('🧪 Starting /forcepuch Slash Command Test Suite...\n');

let passedTests = 0;
let totalTests = 0;

function it(desc, fn) {
    totalTests++;
    try {
        const res = fn();
        if (res && typeof res.then === 'function') {
            return res.then(() => {
                console.log(`  ✅ PASS: ${desc}`);
                passedTests++;
            }).catch(err => {
                console.error(`  ❌ FAIL: ${desc}`);
                console.error(err);
            });
        }
        console.log(`  ✅ PASS: ${desc}`);
        passedTests++;
    } catch (err) {
        console.error(`  ❌ FAIL: ${desc}`);
        console.error(err);
    }
}

// Mock Discord Interaction Builder
function createMockInteraction({
    commandName = 'forcepush',
    action = 'punch',
    targetUser = null,
    clan = null,
    streak = null,
    points = null,
    userClanRoleId = null,
    specifyUser = true,
    guildMembers = null
} = {}) {
    const user = targetUser || {
        id: 'test_user_123',
        username: 'testbasher',
        tag: 'testbasher#0001',
        toString: () => '<@test_user_123>',
        send: async (msg) => {
            user.sentDMs.push(msg);
            return { id: 'msg_123', content: msg };
        },
        sentDMs: []
    };
    if (!user.sentDMs) user.sentDMs = [];

    const rolesMap = new Map();
    if (userClanRoleId) {
        rolesMap.set(userClanRoleId, { id: userClanRoleId, name: 'Clan Role' });
    }

    const member = {
        id: user.id,
        user: user,
        roles: {
            cache: rolesMap
        }
    };

    let replyData = null;
    let editReplyData = null;
    let deferred = false;

    const allMembersList = guildMembers || [member];
    const membersCache = new Map(allMembersList.map(m => [m.id, m]));

    const guild = {
        id: 'guild_123',
        ownerId: 'test_user_123',
        members: {
            cache: membersCache,
            fetch: async (id) => (id ? membersCache.get(id) || member : allMembersList)
        }
    };

    const client = {
        guilds: {
            cache: new Map([['guild_123', guild]])
        }
    };

    const interaction = {
        commandName,
        isChatInputCommand: () => true,
        user,
        member,
        guild,
        client,
        memberPermissions: {
            has: (perm) => true
        },
        options: {
            getString: (opt) => {
                if (opt === 'action') return action;
                if (opt === 'clan') return clan;
                return null;
            },
            getUser: (opt) => (opt === 'user' && specifyUser ? user : null),
            getInteger: (opt) => {
                if (opt === 'streak') return streak;
                if (opt === 'points') return points;
                return null;
            }
        },
        reply: async (data) => {
            replyData = data;
            return data;
        },
        deferReply: async () => {
            deferred = true;
        },
        editReply: async (data) => {
            editReplyData = data;
            return data;
        },
        getReplyData: () => editReplyData || replyData
    };

    return interaction;
}

async function runTests() {
    const todayIST = config.getISTDateString();

    // 1. Check command registration (no duplicate commands)
    await it('registers /forcepush command and ensures no duplicate /forcepuch or /forcepunch', () => {
        const commandData = slashCommands.getCommandData();
        const names = commandData.map(c => c.name);
        assert(names.includes('forcepush'), 'forcepush should be registered');
        assert(!names.includes('forcepuch'), 'duplicate forcepuch should be removed');
        assert(!names.includes('forcepunch'), 'duplicate forcepunch should be removed');
    });

    // 2. Action: punch (default) with auto-detected clan role
    await it('action=punch force records progress for member with clan role', async () => {
        const interaction = createMockInteraction({
            action: 'punch',
            userClanRoleId: clanConfig.CLANS.belmont.roleId
        });

        await slashCommands.handleInteraction(interaction);
        const reply = interaction.getReplyData();
        assert(reply && reply.embeds && reply.embeds.length > 0, 'Should reply with embed');
        const embed = reply.embeds[0].data;
        assert(embed.title.includes('Force Punch'), 'Title should indicate Force Punch');
        assert(embed.fields.some(f => f.name.includes('Clan') && f.value.includes('BELMONT')), 'Clan field should show BELMONT');

        // Verify stored in clanProgressService
        const submitted = await clanProgressService.hasSubmittedToday('belmont', 'test_user_123', todayIST);
        assert.strictEqual(submitted, true, 'Submission should be recorded in clan store');
    });

    // 3. Action: punch with custom clan override, custom streak, and custom points
    await it('action=punch handles custom clan override, custom streak, and custom points', async () => {
        const interaction = createMockInteraction({
            action: 'punch',
            clan: 'shadastria',
            streak: 21,
            points: 15
        });

        await slashCommands.handleInteraction(interaction);
        const reply = interaction.getReplyData();
        const embed = reply.embeds[0].data;
        assert(embed.fields.some(f => f.name.includes('Clan') && f.value.includes('SHADASTRIA')), 'Clan should be SHADASTRIA');
        assert(embed.fields.some(f => f.name.includes('Points') && f.value.includes('+15 pts')), 'Points should be 15');
        assert(embed.fields.some(f => f.name.includes('Streak') && f.value.includes('21 days')), 'Streak should be 21');

        const submitted = await clanProgressService.hasSubmittedToday('shadastria', 'test_user_123', todayIST);
        assert.strictEqual(submitted, true, 'Shadastria submission should be recorded');
    });

    // 4. Default workflow (no action): When NOT submitted, sends DM reminder to user
    await it('default /forcepush: sends DM reminder when member has NOT submitted today', async () => {
        const interaction = createMockInteraction({
            commandName: 'forcepush',
            action: null,
            clan: 'lumina'
        });

        // Ensure lumina is not submitted for test user
        await clanProgressService.clearTodaySubmission('lumina', 'test_user_123', todayIST);

        await slashCommands.handleInteraction(interaction);
        const user = interaction.user;
        assert.strictEqual(user.sentDMs.length, 1, 'Should have sent exactly 1 DM reminder');
        assert(user.sentDMs[0].includes('LUMINA'), 'DM should mention LUMINA');
        assert(user.sentDMs[0].includes(clanConfig.CLANS.lumina.progressChannelId), 'DM should mention LUMINA progress channel ID');

        const reply = interaction.getReplyData();
        const embed = reply.embeds[0].data;
        assert(embed.title.includes('DM Reminder'), 'Title should indicate DM Reminder');
        assert(embed.title.includes('Sent Successfully'), 'Title should indicate sent successfully');
    });

    // 5. Default workflow (no action): When ALREADY submitted, does NOT send DM reminder
    await it('default /forcepush: skips DM reminder when member HAS already submitted today', async () => {
        // Record submission for lumina
        await clanProgressService.recordSubmission({
            userId: 'test_user_123',
            username: 'testbasher',
            clanId: 'lumina',
            clanName: 'LUMINA',
            channelId: clanConfig.CLANS.lumina.progressChannelId,
            submissionDate: todayIST
        });

        const interaction = createMockInteraction({
            commandName: 'forcepush',
            action: null,
            clan: 'lumina'
        });

        await slashCommands.handleInteraction(interaction);
        const user = interaction.user;
        assert.strictEqual(user.sentDMs.length, 0, 'Should NOT have sent any DM because user already submitted');

        const reply = interaction.getReplyData();
        const embed = reply.embeds[0].data;
        assert(embed.title.includes('Already Submitted'), 'Title should indicate Already Submitted');
    });

    // 6. Action: clear resets today\'s submission for testing
    await it('action=clear resets today\'s submission so user can re-test', async () => {
        // First confirm test_user_123 has submitted
        const wasSubmitted = await clanProgressService.hasSubmittedToday('belmont', 'test_user_123', todayIST);
        assert.strictEqual(wasSubmitted, true, 'Belmont should currently be submitted');

        const interaction = createMockInteraction({
            action: 'clear'
        });

        await slashCommands.handleInteraction(interaction);
        const isStillSubmitted = await clanProgressService.hasSubmittedToday('belmont', 'test_user_123', todayIST);
        assert.strictEqual(isStillSubmitted, false, 'Belmont submission should be cleared');

        const isLuminaSubmitted = await clanProgressService.hasSubmittedToday('lumina', 'test_user_123', todayIST);
        assert.strictEqual(isLuminaSubmitted, false, 'Lumina submission should be cleared');
    });

    // 7. /forcepush with action: punch works for recording punch
    await it('/forcepush with action=punch works for recording punch', async () => {
        const interaction = createMockInteraction({
            commandName: 'forcepush',
            action: 'punch',
            clan: 'aura7f'
        });

        await slashCommands.handleInteraction(interaction);
        const reply = interaction.getReplyData();
        const embed = reply.embeds[0].data;
        assert(embed.title.includes('Force Punch'), 'Title should indicate Force Punch');
        const submitted = await clanProgressService.hasSubmittedToday('aura7f', 'test_user_123', todayIST);
        assert.strictEqual(submitted, true, 'Aura 7F submission should be recorded via /forcepush');
    });

    // 8. Clan Option includes "🌟 ALL CLANS"
    await it('registers /forcepush with ALL CLANS choice in clan option', () => {
        const commandData = slashCommands.getCommandData();
        const forcePushCmd = commandData.find(c => c.name === 'forcepush');
        assert(forcePushCmd, 'forcepush command must exist');
        const clanOption = forcePushCmd.options.find(o => o.name === 'clan');
        assert(clanOption, 'clan option must exist');
        assert(clanOption.choices.some(ch => ch.value === 'all'), 'clan option must include choice "all"');
    });

    // 9. /forcepush clan: 'all' without user: scans all 4 clans, DMs missing members, returns summary
    await it('/forcepush clan:all (no user): scans all 4 clans and sends DMs to missing members', async () => {
        const testBelmontUser = {
            id: 'belmont_member_777',
            username: 'belmont_warrior',
            tag: 'belmont_warrior#0001',
            toString: () => '<@belmont_member_777>',
            send: async (msg) => {
                testBelmontUser.sentDMs.push(msg);
                return { id: 'dm_777', content: msg };
            },
            sentDMs: []
        };

        const belmontMember = {
            id: testBelmontUser.id,
            user: testBelmontUser,
            roles: {
                cache: new Map([[clanConfig.CLANS.belmont.roleId, { id: clanConfig.CLANS.belmont.roleId, name: 'BELMONT' }]])
            }
        };

        // Ensure not submitted today
        await clanProgressService.clearTodaySubmission('belmont', testBelmontUser.id, todayIST);

        const interaction = createMockInteraction({
            commandName: 'forcepush',
            action: null,
            clan: 'all',
            specifyUser: false,
            guildMembers: [belmontMember]
        });

        await slashCommands.handleInteraction(interaction);
        const reply = interaction.getReplyData();
        assert(reply && reply.embeds && reply.embeds.length > 0, 'Should reply with embed');
        const embed = reply.embeds[0].data;
        assert(embed.title.includes('All Clans'), 'Title should indicate All Clans');
        assert(embed.fields.some(f => f.name.includes('BELMONT')), 'Fields should include BELMONT');

        // Verify DM was sent to the missing member in belmont
        assert.strictEqual(testBelmontUser.sentDMs.length, 1, 'Missing Belmont member should receive 1 DM reminder');
        assert(testBelmontUser.sentDMs[0].includes('BELMONT'), 'DM should mention BELMONT');
    });

    // 10. /forcepush clan: 'all' with user: checks target user across all 4 clans and DMs if missing
    await it('/forcepush clan:all user:@user: checks target user across all 4 clans and DMs if missing', async () => {
        const targetUser = {
            id: 'target_lumina_888',
            username: 'lumina_scout',
            tag: 'lumina_scout#0001',
            toString: () => '<@target_lumina_888>',
            send: async (msg) => {
                targetUser.sentDMs.push(msg);
                return { id: 'dm_888', content: msg };
            },
            sentDMs: []
        };

        const luminaMember = {
            id: targetUser.id,
            user: targetUser,
            roles: {
                cache: new Map([[clanConfig.CLANS.lumina.roleId, { id: clanConfig.CLANS.lumina.roleId, name: 'LUMINA' }]])
            }
        };

        // Ensure not submitted today in lumina
        await clanProgressService.clearTodaySubmission('lumina', targetUser.id, todayIST);

        const interaction = createMockInteraction({
            commandName: 'forcepush',
            action: null,
            clan: 'all',
            targetUser: targetUser,
            specifyUser: true,
            guildMembers: [luminaMember]
        });
        interaction.member = luminaMember;

        await slashCommands.handleInteraction(interaction);
        const reply = interaction.getReplyData();
        const embed = reply.embeds[0].data;
        assert(embed.title.includes('All Clans') && embed.title.includes('lumina_scout'), 'Title should indicate All Clans check for lumina_scout');
        assert(embed.fields.some(f => f.name.includes('LUMINA')), 'Fields should include LUMINA');
        assert.strictEqual(targetUser.sentDMs.length, 1, 'Target user should receive 1 DM for LUMINA');
        assert(targetUser.sentDMs[0].includes('LUMINA'), 'DM should mention LUMINA');
    });

    console.log(`\n📊 Results: ${passedTests}/${totalTests} tests passed.`);
    if (passedTests === totalTests) {
        console.log('🎉 All /forcepuch tests passed successfully!\n');
        process.exit(0);
    } else {
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error('Test execution error:', err);
    process.exit(1);
});
