-- ============================================================
-- CLAN PROGRESS TRACKING SYSTEM
-- Multi-Clan Support for AURA 7F, BELMONT, LUMINA, SHADASTRIA
-- Run this in Supabase SQL Editor if using PostgreSQL / Supabase
-- ============================================================

CREATE TABLE IF NOT EXISTS clan_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    discord_username TEXT,
    member_id INTEGER,
    clan_id TEXT NOT NULL,
    clan_name TEXT NOT NULL,
    progress_channel_id TEXT NOT NULL,
    submission_date DATE NOT NULL,
    submission_status TEXT DEFAULT 'completed',
    points_awarded INTEGER DEFAULT 5,
    streak INTEGER DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(clan_id, user_id, submission_date)
);

CREATE INDEX IF NOT EXISTS idx_clan_progress_date ON clan_progress(clan_id, submission_date);
CREATE INDEX IF NOT EXISTS idx_clan_progress_user ON clan_progress(clan_id, user_id, submission_date);
CREATE INDEX IF NOT EXISTS idx_clan_progress_channel ON clan_progress(progress_channel_id);

-- Enable RLS
ALTER TABLE clan_progress ENABLE ROW LEVEL SECURITY;

-- Allow bot access via anon or authenticated role
CREATE POLICY "Enable all for anon" ON clan_progress FOR ALL USING (true) WITH CHECK (true);
