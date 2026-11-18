-- ============================================================
-- MONTHLY STREAK FREEZE SYSTEM
-- Exactly 1 Freeze per calendar month per eligible member
-- Run this in Supabase SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS streak_freezes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
    year INTEGER NOT NULL CHECK (year >= 2020),
    status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'used', 'expired')),
    used_on DATE,
    protected_streak INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(member_id, month, year)
);

CREATE INDEX IF NOT EXISTS idx_streak_freezes_lookup ON streak_freezes(member_id, month, year);
CREATE INDEX IF NOT EXISTS idx_streak_freezes_used_on ON streak_freezes(member_id, used_on);

-- Enable Row Level Security (RLS)
ALTER TABLE streak_freezes ENABLE ROW LEVEL SECURITY;

-- Allow bot access via authenticated bot user or anon
CREATE POLICY "Enable all for streak_freezes" ON streak_freezes FOR ALL USING (true) WITH CHECK (true);
