const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('../database.sqlite');

db.run("ALTER TABLE campaigns ADD COLUMN next_run_at DATETIME", (err) => {
    if (err && !err.message.includes('duplicate column')) console.error(err);
    else console.log('Column next_run_at added successfully.');
});
