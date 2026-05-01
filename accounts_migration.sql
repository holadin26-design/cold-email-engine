-- Migration for the actual 'accounts' table used by the core engine
ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS warmup_enabled BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS warmup_status TEXT DEFAULT 'inactive',
  ADD COLUMN IF NOT EXISTS warmup_reputation INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS warmup_ramp_day INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS warmup_ramp_target INTEGER DEFAULT 20,
  ADD COLUMN IF NOT EXISTS warmup_daily_limit INTEGER DEFAULT 40,
  ADD COLUMN IF NOT EXISTS warmup_daily_sent INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS warmup_send_window_start TEXT DEFAULT '08:00',
  ADD COLUMN IF NOT EXISTS warmup_send_window_end TEXT DEFAULT '18:00',
  ADD COLUMN IF NOT EXISTS warmup_active_days TEXT[] DEFAULT ARRAY['Mon','Tue','Wed','Thu','Fri'],
  ADD COLUMN IF NOT EXISTS warmup_last_active TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'smtp',
  ADD COLUMN IF NOT EXISTS gmail_refresh_token TEXT;
