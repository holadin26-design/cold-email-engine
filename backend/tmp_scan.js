const sqlite3 = require('sqlite3');
const db = new sqlite3.Database('database.sqlite');
db.get('SELECT id, name FROM campaigns ORDER BY created_at DESC LIMIT 1', (err, row) => {
    if (err) return console.error(err);
    if (!row) return console.log('No campaigns found.');
    console.log('Latest Campaign:', row.name, '(' + row.id + ')');
    db.all('SELECT email, variables, replied_at, status FROM leads WHERE campaign_id = ? AND replied_at IS NOT NULL ORDER BY replied_at DESC', [row.id], (lErr, leads) => {
        if (lErr) return console.error(lErr);
        console.log('Replies Found:', leads.length);
        leads.forEach(l => {
            const vars = JSON.parse(l.variables || '{}');
            console.log('\n--- Reply from:', l.email);
            console.log('Sentiment:', vars.reply_sentiment);
            console.log('Body:', vars.reply_body);
        });
    });
});
