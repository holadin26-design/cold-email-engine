const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('../database.sqlite');

db.all("SELECT * FROM leads", (err, rows) => {
    console.log('--- ALL LEADS ---');
    console.log(rows);
});
