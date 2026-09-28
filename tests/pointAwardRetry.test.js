// tests/pointAwardRetry.test.js
const assert = require('assert');
const database = require('../src/database/supabase');
const supabaseAuth = require('../src/database/supabaseAuth');
const config = require('../src/config/config');

(async () => {
    console.log('============================================================');
    console.log('🧪 RUNNING POINT AWARD RESILIENCE & IDEMPOTENCY TEST SUITE');
    console.log('============================================================\n');

    let client = null;
    const testMemberId = 77; // bot test member
    const testDescription = `TEST-POINT-AWARD-${Date.now()}`;

    try {
        // Step 1: Initial auth check
        console.log('▶ TEST 1: Supabase authentication resilience');
        await supabaseAuth.ensureAuthenticated();
        assert.strictEqual(supabaseAuth.isAuthenticated, true, 'Bot should be authenticated');
        client = supabaseAuth.getAuthenticatedClient();
        console.log('✅ TEST 1 PASSED: Bot authenticated successfully.\n');

        // Clean any pre-existing records with test prefix
        await client.from('points').delete().like('description', 'TEST-POINT-AWARD-%');

        // Step 2: Test awardPoints on fresh attempt
        console.log('▶ TEST 2: awardPoints awards points on first attempt');
        const firstAward = await database.awardPoints(testMemberId, 5, testDescription);
        assert.strictEqual(firstAward, true, 'awardPoints should return true on first attempt');
        
        // Verify row exists in Supabase
        const { data: rows, error: selectErr } = await client
            .from('points')
            .select('id, points, description')
            .eq('member_id', testMemberId)
            .eq('description', testDescription);
        assert.ifError(selectErr);
        assert.strictEqual(rows.length, 1, 'Exactly one points record should exist');
        assert.strictEqual(rows[0].points, 5, 'Points value should match 5');
        console.log('✅ TEST 2 PASSED: Points awarded and verified in DB.\n');

        // Step 3: Test idempotency (calling awardPoints again for same member + description)
        console.log('▶ TEST 3: awardPoints is idempotent (duplicate call succeeds without adding duplicate rows)');
        const secondAward = await database.awardPoints(testMemberId, 5, testDescription);
        assert.strictEqual(secondAward, true, 'Subsequent awardPoints call should return true (idempotent)');

        const { data: rowsAfterDup } = await client
            .from('points')
            .select('id')
            .eq('member_id', testMemberId)
            .eq('description', testDescription);
        assert.strictEqual(rowsAfterDup.length, 1, 'Points should not be duplicated');
        console.log('✅ TEST 3 PASSED: Idempotency confirmed, no duplicate rows created.\n');

        // Step 4: Test automatic recovery when session is invalidated
        console.log('▶ TEST 4: awardPoints recovers automatically from invalidated session');
        // Intentionally clear authenticated state to simulate expired/lost session
        supabaseAuth.isAuthenticated = false;
        supabaseAuth.session = null;

        const recoveredDescription = `TEST-POINT-AWARD-RECOVER-${Date.now()}`;
        const recoveredAward = await database.awardPoints(testMemberId, 5, recoveredDescription);
        assert.strictEqual(recoveredAward, true, 'awardPoints should automatically re-authenticate and succeed');

        const { data: recoveredRows } = await client
            .from('points')
            .select('id')
            .eq('member_id', testMemberId)
            .eq('description', recoveredDescription);
        assert.strictEqual(recoveredRows.length, 1, 'Points record should exist after automatic recovery');
        console.log('✅ TEST 4 PASSED: Automatic re-authentication and recovery verified.\n');

        // Cleanup
        console.log('🧹 Cleaning up test records...');
        await client.from('points').delete().like('description', 'TEST-POINT-AWARD-%');
        console.log('✅ Cleanup complete.\n');

        console.log('============================================================');
        console.log('🎉 ALL POINT AWARD RESILIENCE TESTS PASSED SUCCESSFULLY!');
        console.log('============================================================');
        process.exit(0);
    } catch (err) {
        console.error('❌ Test failed with error:', err);
        if (client) {
            await client.from('points').delete().like('description', 'TEST-POINT-AWARD-%').catch(() => {});
        }
        process.exit(1);
    }
})();
