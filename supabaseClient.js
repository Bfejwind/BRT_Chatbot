const { createClient } = require("@supabase/supabase-js");
const WebSocket = require("ws");

if (
    !process.env.SUPABASE_URL ||
    !process.env.SUPABASE_SECRET_KEY
) {
    throw new Error("Missing Supabase environment variables");
}

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY,
    {
        auth: {
            persistSession: false,
            autoRefreshToken: false
        },
        realtime: {
            transport: WebSocket
        }
    }
);

module.exports = supabase;