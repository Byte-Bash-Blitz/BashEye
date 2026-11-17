// tests/streakFreeze.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const config = require('../src/config/config');
const database = require('../src/database/supabase');
const streakFreezeUtils = require('../src/utils/streakFreezeUtils');
const streakFreezeService = require('../src/services/streakFreezeService');
const streakService = require('../src/services/streakService');

(async () => {
    console.log('============================================================');
    console.log('🧪 RUNNING BASH EYE MONTHLY STREAK FREEZE TEST SUITE');
    console.log('============================================================\n');

    let totalTests = 0;
    let passedTests = 0;

    async function test(name, fn) {
        totalTests++;
        process.stdout.write(`▶ TEST ${totalTests}: ${name} ... `);
        try {
            await fn();
            passedTests++;
            console.log('✅ PASSED');
        } catch (err) {
            console.log('❌ FAILED');
            console.error(err);
            process.exit(1);
        }
    }

    // Helper to reset test store data
    const freezeStoreFile = path.join(__dirname, '../data/streak_freezes.json');
    function cleanTestFreezes(memberId) {
        if (fs.existsSync(freezeStoreFile)) {
            try {
                const data = JSON.parse(fs.readFileSync(freezeStoreFile, 'utf8'));
                data.freezes = data.freezes.filter(f => Number(f.member_id) !== Number(memberId));
                fs.writeFileSync(freezeStoreFile, JSON.stringify(data, null, 2), 'utf8');
            } catch (_) {}
        }
    }

    const TEST_MEMBER_ID = 99991;

    // Clean initial state
    cleanTestFreezes(TEST_MEMBER_ID);

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 1: Initial Freeze Allocation
    // ─────────────────────────────────────────────────────────────────────────
    await test('Every eligible member starts with 1 free Freeze available per calendar month', async () => {
        const status = await streakFreezeService.getFreezeStatus(TEST_MEMBER_ID, '2026-11-15');
        assert.strictEqual(status.available, true, 'Freeze must be available in fresh calendar month');
        assert.strictEqual(status.used, false, 'Freeze must not be used yet');
        assert.strictEqual(status.month, 11, 'Month must match 11');
        assert.strictEqual(status.year, 2026, 'Year must match 2026');
    });

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 2: Preserves Streak on Missed Day
    // ─────────────────────────────────────────────────────────────────────────
    await test('When a member misses a day with Freeze available, Freeze activates and preserves streak', async () => {
        cleanTestFreezes(TEST_MEMBER_ID);

        // Setup mock: member had a 29-day streak on Day 29 (2026-11-16)
        const mockMemberStats = {
            member_id: TEST_MEMBER_ID,
            discord_streak: 29,
            last_updated_at: '2026-11-16T15:00:00.000Z'
        };

        // Spy on getActiveStreakMembers and hasSubmittedOnDate
        const origGetActive = database.getActiveStreakMembers;
        const origHasSubmitted = streakFreezeService.hasSubmittedOnDate;

        database.getActiveStreakMembers = async () => [mockMemberStats];
        streakFreezeService.hasSubmittedOnDate = async () => false; // Missed Day 30 (2026-11-17)

        const summary = await streakFreezeService.processMissedDeadlines('2026-11-17', { specificMemberId: TEST_MEMBER_ID });

        assert.strictEqual(summary.freezesActivated, 1, 'Exactly 1 freeze must activate');
        assert.strictEqual(summary.streaksBroken, 0, 'Streak must not break');

        const postFreezeStatus = await streakFreezeService.getFreezeStatus(TEST_MEMBER_ID, '2026-11-17');
        assert.strictEqual(postFreezeStatus.available, false, 'Freeze must now be consumed');
        assert.strictEqual(postFreezeStatus.used, true, 'Freeze status must be used');
        assert.strictEqual(postFreezeStatus.record.protected_streak, 29, 'Protected streak must be 29');
        assert.strictEqual(postFreezeStatus.record.used_on, '2026-11-17', 'Used on date must be 2026-11-17');

        // Restore spies
        database.getActiveStreakMembers = origGetActive;
        streakFreezeService.hasSubmittedOnDate = origHasSubmitted;
    });

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 3: Next Valid Progress Submission Continues Streak
    // ─────────────────────────────────────────────────────────────────────────
    await test('When member submits progress on next valid day, streak continues from 29 to 30', async () => {
        // Mock database and streak data for Day 31 submission (2026-11-18)
        const origGetMemberStats = database.getMemberStats;
        const origGetStreakData = database.getStreakData;
        const origUpdateStreak = database.updateDiscordStreak;

        let updatedStreakValue = null;

        // Member stats still has streak 29 (preserved by freeze)
        database.getMemberStats = async (id) => ({
            member_id: id,
            discord_streak: 29,
            last_updated_at: '2026-11-16T15:00:00.000Z'
        });

        // Recent points: [0] is today (2026-11-18), [1] is 2 days ago (2026-11-16)
        database.getStreakData = async () => [
            { description: 'PU-18Nov\'26', updated_at: '2026-11-18T10:00:00.000Z' },
            { description: 'PU-16Nov\'26', updated_at: '2026-11-16T10:00:00.000Z' }
        ];

        database.updateDiscordStreak = async (id, s) => {
            updatedStreakValue = s;
            return { discord_streak: s };
        };

        // Spy config.getISTDateString to simulate today is 2026-11-18
        const origGetIST = config.getISTDateString;
        config.getISTDateString = (d) => d ? d.toISOString().split('T')[0] : '2026-11-18';

        const result = await streakService.handleDailySubmission(TEST_MEMBER_ID);

        assert.strictEqual(result.currentStreak, 30, 'Streak must increment from 29 to 30');
        assert.strictEqual(updatedStreakValue, 30, 'Database streak must be updated to 30');

        // Restore
        database.getMemberStats = origGetMemberStats;
        database.getStreakData = origGetStreakData;
        database.updateDiscordStreak = origUpdateStreak;
        config.getISTDateString = origGetIST;
    });

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 4: Multiple Missed Days (Second Missed Day Breaks Streak)
    // ─────────────────────────────────────────────────────────────────────────
    await test('Second missed day in the same month breaks streak (no freeze available)', async () => {
        // Freeze was already consumed on Nov 17. Now member misses Nov 20!
        const origGetActive = database.getActiveStreakMembers;
        const origHasSubmitted = streakFreezeService.hasSubmittedOnDate;
        let streakResetCalled = false;

        const origUpdateStreak = database.updateDiscordStreak;
        database.updateDiscordStreak = async (id, s) => {
            if (s === 0) streakResetCalled = true;
            return { discord_streak: s };
        };

        database.getActiveStreakMembers = async () => [{
            member_id: TEST_MEMBER_ID,
            discord_streak: 30,
            last_updated_at: '2026-11-18T10:00:00.000Z'
        }];
        streakFreezeService.hasSubmittedOnDate = async () => false; // Missed Nov 20

        const summary = await streakFreezeService.processMissedDeadlines('2026-11-20', { specificMemberId: TEST_MEMBER_ID });

        assert.strictEqual(summary.freezesActivated, 0, 'No freeze should activate on second missed day');
        assert.strictEqual(summary.streaksBroken, 1, 'Streak must break on second missed day');
        assert.strictEqual(streakResetCalled, true, 'updateDiscordStreak(id, 0) must be called');

        database.getActiveStreakMembers = origGetActive;
        streakFreezeService.hasSubmittedOnDate = origHasSubmitted;
        database.updateDiscordStreak = origUpdateStreak;
    });

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 5: Monthly Allocation Reset (December gets fresh freeze)
    // ─────────────────────────────────────────────────────────────────────────
    await test('New calendar month gives a fresh Freeze allocation (unused Nov history does not block Dec)', async () => {
        // Nov is consumed, but Dec 1 starts fresh!
        const novStatus = await streakFreezeService.getFreezeStatus(TEST_MEMBER_ID, '2026-11-30');
        assert.strictEqual(novStatus.used, true, 'November freeze remains used');

        const decStatus = await streakFreezeService.getFreezeStatus(TEST_MEMBER_ID, '2026-12-01');
        assert.strictEqual(decStatus.available, true, 'December must have fresh 1 freeze available');
        assert.strictEqual(decStatus.used, false, 'December freeze must not be marked used');
        assert.strictEqual(decStatus.month, 12, 'Month must be 12');
        assert.strictEqual(decStatus.year, 2026, 'Year must be 2026');
    });

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 6: Unused Freezes Do NOT Carry Forward
    // ─────────────────────────────────────────────────────────────────────────
    await test('Unused Freeze does not carry forward into next month', async () => {
        const UNUSED_MEMBER_ID = 99992;
        cleanTestFreezes(UNUSED_MEMBER_ID);

        // Never missed in Nov -> Nov has unused freeze
        const novStatus = await streakFreezeService.getFreezeStatus(UNUSED_MEMBER_ID, '2026-11-15');
        assert.strictEqual(novStatus.available, true);

        // In Dec, member still has exactly 1 freeze (not 2)
        const decStatus = await streakFreezeService.getFreezeStatus(UNUSED_MEMBER_ID, '2026-12-15');
        assert.strictEqual(decStatus.available, true);
        assert.strictEqual(decStatus.used, false);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 7: Zero Streak Member (Freeze Not Wasted on Streak 0)
    // ─────────────────────────────────────────────────────────────────────────
    await test('Freeze is NOT activated if member current streak is 0', async () => {
        const ZERO_MEMBER_ID = 99993;
        cleanTestFreezes(ZERO_MEMBER_ID);

        const origGetActive = database.getActiveStreakMembers;
        const origHasSubmitted = streakFreezeService.hasSubmittedOnDate;

        database.getActiveStreakMembers = async () => [{
            member_id: ZERO_MEMBER_ID,
            discord_streak: 0,
            last_updated_at: '2026-11-10T10:00:00.000Z'
        }];
        streakFreezeService.hasSubmittedOnDate = async () => false;

        const summary = await streakFreezeService.processMissedDeadlines('2026-11-17', { specificMemberId: ZERO_MEMBER_ID });

        assert.strictEqual(summary.freezesActivated, 0, 'Freeze must not be consumed for streak = 0');
        const status = await streakFreezeService.getFreezeStatus(ZERO_MEMBER_ID, '2026-11-17');
        assert.strictEqual(status.available, true, 'Freeze must still be available');

        database.getActiveStreakMembers = origGetActive;
        streakFreezeService.hasSubmittedOnDate = origHasSubmitted;
    });

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 8: Member Submitting Every Day (Freeze Untouched)
    // ─────────────────────────────────────────────────────────────────────────
    await test('Member submitting progress every day keeps Freeze untouched', async () => {
        const ACTIVE_MEMBER_ID = 99994;
        cleanTestFreezes(ACTIVE_MEMBER_ID);

        const origGetActive = database.getActiveStreakMembers;
        const origHasSubmitted = streakFreezeService.hasSubmittedOnDate;

        database.getActiveStreakMembers = async () => [{
            member_id: ACTIVE_MEMBER_ID,
            discord_streak: 15,
            last_updated_at: '2026-11-17T10:00:00.000Z'
        }];
        streakFreezeService.hasSubmittedOnDate = async () => true; // Submitted!

        const summary = await streakFreezeService.processMissedDeadlines('2026-11-17', { specificMemberId: ACTIVE_MEMBER_ID });

        assert.strictEqual(summary.submitted, 1, 'Should record member as submitted');
        assert.strictEqual(summary.freezesActivated, 0, 'No freeze activated');

        const status = await streakFreezeService.getFreezeStatus(ACTIVE_MEMBER_ID, '2026-11-17');
        assert.strictEqual(status.available, true, 'Freeze remains untouched');

        database.getActiveStreakMembers = origGetActive;
        streakFreezeService.hasSubmittedOnDate = origHasSubmitted;
    });

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 9: Idempotency & Duplicate Deadline Check Protection
    // ─────────────────────────────────────────────────────────────────────────
    await test('Running deadline evaluation multiple times does not duplicate Freeze consumption', async () => {
        const IDEMPOTENT_ID = 99995;
        cleanTestFreezes(IDEMPOTENT_ID);

        const origGetActive = database.getActiveStreakMembers;
        const origHasSubmitted = streakFreezeService.hasSubmittedOnDate;

        database.getActiveStreakMembers = async () => [{
            member_id: IDEMPOTENT_ID,
            discord_streak: 5,
            last_updated_at: '2026-11-10T10:00:00.000Z'
        }];
        streakFreezeService.hasSubmittedOnDate = async () => false;

        // Run 1: activates freeze
        const run1 = await streakFreezeService.processMissedDeadlines('2026-11-12', { specificMemberId: IDEMPOTENT_ID });
        assert.strictEqual(run1.freezesActivated, 1);

        // Run 2: same date -> already protected, does nothing
        const run2 = await streakFreezeService.processMissedDeadlines('2026-11-12', { specificMemberId: IDEMPOTENT_ID });
        assert.strictEqual(run2.freezesActivated, 0, 'Second run must not re-activate freeze');

        database.getActiveStreakMembers = origGetActive;
        streakFreezeService.hasSubmittedOnDate = origHasSubmitted;
    });

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 10: End of Month Freeze & Leap Year / Boundary Handling
    // ─────────────────────────────────────────────────────────────────────────
    await test('Freeze at end of month (Feb 28 / Feb 29 leap year) correctly maps calendar month', async () => {
        const leapDate = new Date('2024-02-29T12:00:00+05:30');
        const cal = streakFreezeUtils.getCalendarMonthAndYear(leapDate);
        assert.strictEqual(cal.month, 2);
        assert.strictEqual(cal.year, 2024);

        const endOfNov = new Date('2026-11-30T12:00:00+05:30');
        const calNov = streakFreezeUtils.getCalendarMonthAndYear(endOfNov);
        assert.strictEqual(calNov.month, 11);
        assert.strictEqual(calNov.year, 2026);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // TEST 11: Notification Message Formatting
    // ─────────────────────────────────────────────────────────────────────────
    await test('Notification format matches exact expected specification', () => {
        const msg = streakFreezeUtils.formatFreezeNotification(29);
        assert.strictEqual(
            msg,
            '🛡️ Your Streak Freeze has been activated! Your 29-day streak is protected. Your next valid progress submission will continue your streak.'
        );
    });

    // Clean up test records
    cleanTestFreezes(TEST_MEMBER_ID);
    cleanTestFreezes(99992);
    cleanTestFreezes(99993);
    cleanTestFreezes(99994);
    cleanTestFreezes(99995);

    console.log(`\n📊 Results: ${passedTests}/${totalTests} tests passed.`);
    if (passedTests === totalTests) {
        console.log('🎉 ALL STREAK FREEZE TESTS PASSED SUCCESSFULLY!\n');
        process.exit(0);
    } else {
        process.exit(1);
    }
})();
