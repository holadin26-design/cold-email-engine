/**
 * fix_reply_bodies.js
 * Cleans up existing replies that have MIME garbage stored as reply_body.
 * Strips MIME headers and decodes quoted-printable content.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
);

// Simple quoted-printable decoder
function decodeQP(str) {
    return str
        .replace(/=\r?\n/g, '') // soft line breaks
        .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

// Extract plain text from MIME body (handles multipart/alternative)
function cleanMimeBody(raw) {
    if (!raw) return '';

    // If it doesn't look like MIME, return as-is
    if (!raw.includes('Content-Type:') && !raw.startsWith('--')) {
        return raw.trim();
    }

    const lines = raw.split(/\r?\n/);
    let inTextPlain = false;
    let pastHeaders = false;
    let collected = [];
    let isQP = false;

    for (const line of lines) {
        const trimmed = line.trim();

        // MIME boundary line — reset state
        if (trimmed.startsWith('--')) {
            if (inTextPlain && collected.length > 0) break; // done with text/plain block
            inTextPlain = false;
            pastHeaders = false;
            isQP = false;
            continue;
        }

        if (!pastHeaders) {
            // Detect text/plain section
            if (/^content-type:\s*text\/plain/i.test(trimmed)) {
                inTextPlain = true;
                continue;
            }
            // Detect HTML section — stop collecting
            if (/^content-type:\s*text\/html/i.test(trimmed)) {
                if (inTextPlain && collected.length > 0) break;
                inTextPlain = false;
                continue;
            }
            // Detect quoted-printable
            if (/^content-transfer-encoding:\s*quoted-printable/i.test(trimmed)) {
                isQP = true;
                continue;
            }
            // Skip other MIME headers
            if (/^[a-z-]+:/i.test(trimmed) || trimmed === '') {
                if (trimmed === '' && inTextPlain) {
                    pastHeaders = true; // blank line = end of headers, body starts
                }
                continue;
            }
        }

        if (inTextPlain && pastHeaders) {
            collected.push(line);
        }
    }

    let text = collected.join('\n').trim();
    if (isQP) text = decodeQP(text);
    return text || raw.trim(); // fallback to raw if extraction fails
}

// Strip quoted original email from reply body (keep only the new reply text)
function trimQuotedText(body) {
    return body
        .split(/\n\s*>\s*/)[0]
        .split(/\n--\s*\n/)[0]
        .split(/\n-+\s*Original Message\s*-+/i)[0]
        .split(/\nOn\s.*\swrote:/i)[0]
        .split(/\nFrom:\s/i)[0]
        .split(/\nSent:\s/i)[0]
        .trim()
        .slice(0, 1500);
}

async function main() {
    console.log('Fetching replied leads with MIME garbage in reply_body...');

    let from = 0;
    let fixed = 0;
    let skipped = 0;

    while (true) {
        const { data: leads, error } = await supabase
            .from('leads')
            .select('id, variables')
            .eq('status', 'replied')
            .not('replied_at', 'is', null)
            .range(from, from + 99);

        if (error) { console.error('Fetch error:', error.message); break; }
        if (!leads || leads.length === 0) break;

        for (const lead of leads) {
            let vars = lead.variables;
            if (typeof vars === 'string') {
                try { vars = JSON.parse(vars); } catch { vars = {}; }
            }
            vars = vars || {};

            const body = vars.reply_body || '';

            // Check if body looks like MIME garbage
            const isMimeGarbage = body.includes('Content-Type:') || 
                                   body.includes('Content-Transfer-Encoding:') ||
                                   /^--[0-9a-f]{10,}/.test(body);

            if (!isMimeGarbage) {
                skipped++;
                continue;
            }

            const cleaned = trimQuotedText(cleanMimeBody(body));
            if (!cleaned || cleaned === body) {
                skipped++;
                continue;
            }

            vars.reply_body = cleaned;

            const { error: updateErr } = await supabase
                .from('leads')
                .update({ variables: vars })
                .eq('id', lead.id);

            if (updateErr) {
                console.error(`Failed to update lead ${lead.id}:`, updateErr.message);
            } else {
                console.log(`✅ Fixed lead ${lead.id}: "${cleaned.slice(0, 80).replace(/\n/g, ' ')}..."`);
                fixed++;
            }
        }

        if (leads.length < 100) break;
        from += 100;
    }

    console.log(`\nDone. Fixed: ${fixed}, Skipped (already clean): ${skipped}`);
}

main().catch(console.error);
