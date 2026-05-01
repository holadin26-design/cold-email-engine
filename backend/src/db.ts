import sqlite3 from "sqlite3";
import { open } from "sqlite";
import path from "path";

export async function initDB() {
  const db = await open({
    filename: path.join(__dirname, "../../database.sqlite"),
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      display_name TEXT,
      app_password TEXT NOT NULL,
      smtp_host TEXT NOT NULL,
      smtp_port INTEGER NOT NULL,
      imap_host TEXT NOT NULL,
      imap_port INTEGER NOT NULL,
      daily_send_limit INTEGER DEFAULT 20,
      sends_today INTEGER DEFAULT 0,
      is_primary BOOLEAN DEFAULT false,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      delay_min INTEGER DEFAULT 60,
      delay_max INTEGER DEFAULT 120,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT DEFAULT 'paused',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      next_run_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER,
      email TEXT NOT NULL,
      name TEXT,
      variables TEXT,
      status TEXT DEFAULT 'pending',
      sent_at DATETIME,
      opened_at DATETIME,
      account_id INTEGER,
      FOREIGN KEY(campaign_id) REFERENCES campaigns(id)
    );

    CREATE TABLE IF NOT EXISTS global_followups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      step_number INTEGER NOT NULL UNIQUE,
      subject TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      delay_days INTEGER NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  return db;
}
