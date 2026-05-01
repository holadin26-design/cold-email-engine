export type WarmupStatus = 'active' | 'paused' | 'inactive' | 'completed'
export type AccountType = 'gmail' | 'smtp' | 'recipient'
export type EventType = 'sent' | 'replied' | 'rescue' | 'bounce' | 'spam_detected'
export type AccountRole = 'primary' | 'seed'
export type PoolStrength = 'strong' | 'good' | 'weak'

export interface SmtpConfig {
  host: string; port: number; username: string
  password: string; encryption: 'SSL/TLS' | 'STARTTLS' | 'None'
}
export interface ImapConfig {
  host: string; port: number; username: string
  password: string; encryption: 'SSL/TLS' | 'STARTTLS' | 'None'
}
export interface EmailAccount {
  id: string; email: string; type: AccountType
  warmup_enabled: boolean; warmup_status: WarmupStatus
  warmup_reputation: number; warmup_ramp_day: number
  warmup_ramp_target: number; warmup_daily_limit: number
  warmup_daily_sent: number; warmup_send_window_start: string
  warmup_send_window_end: string; warmup_active_days: string[]
  warmup_last_active: string | null
  warmup_auto_rescue: boolean; warmup_auto_reply: boolean; warmup_auto_pause: boolean
  gmail_refresh_token?: string
  smtp_host?: string; smtp_port?: number
  imap_host?: string; imap_port?: number
  smtp_username?: string; smtp_password?: string
  smtp_encryption?: string; created_at: string
}
export interface SeedAccount {
  id: string; email: string; type: AccountType; status: string
  gmail_refresh_token?: string
  smtp_host?: string; smtp_port?: number
  imap_host?: string; imap_port?: number
  smtp_username?: string; smtp_password?: string
  smtp_encryption?: string
  daily_sent: number; daily_received: number
  spam_rescued_total: number; health_status: string; created_at: string
}
export interface WarmupLog {
  id: string; from_email: string; to_email: string
  from_account_id: string; to_account_id: string
  from_account_type: AccountRole; to_account_type: AccountRole
  subject: string; event_type: EventType; result: string
  message_id: string; created_at: string
}
export interface ReputationPoint { account_id: string; score: number; recorded_at: string }
export interface DashboardStats {
  avg_reputation: number; sent_today: number
  active_accounts: number; seed_count: number
  pool_strength: PoolStrength; accounts: EmailAccount[]
  seeds: SeedAccount[]; recent_logs: WarmupLog[]
  reputation_history: ReputationPoint[]
  daily_sends_history: { date: string; count: number }[]
}
