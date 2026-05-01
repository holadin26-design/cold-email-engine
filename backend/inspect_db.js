const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('../database.sqlite');

db.all("SELECT * FROM accounts", (err, rows) => {
    console.log('--- ACCOUNTS ---');
    console.log(rows);
});

db.all("SELECT * FROM campaigns", (err, rows) => {
    console.log('--- CAMPAIGNS ---');
    console.log(rows);
});

db.all("SELECT status, count(*) as count FROM leads GROUP BY status", (err, rows) => {
    console.log('--- LEADS STATUS COUNTS ---');
    console.log(rows);
});
