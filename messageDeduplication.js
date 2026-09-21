
const crypto = require("node:crypto");
const supabase = require("./supabaseClient");

async function claimMessage(messageId) {
    const claimToken = crypto.randomUUID();

    const { data, error } = await supabase.rpc(
        "claim_whatsapp_message",
        {
            p_message_id: messageId,
            p_claim_token: claimToken
        }
    );

    if (error) {
        throw error;
    }

    return {
        result: data,
        claimToken
    };
}

async function completeMessage(messageId, claimToken) {
    const { data, error } = await supabase.rpc(
        "complete_whatsapp_message",
        {
            p_message_id: messageId,
            p_claim_token: claimToken
        }
    );

    if (error) {
        throw error;
    }

    if (data !== true) {
        throw new Error(
            `Could not complete message claim: ${messageId}`
        );
    }
}

async function releaseMessage(messageId, claimToken) {
    const { data, error } = await supabase.rpc(
        "release_whatsapp_message",
        {
            p_message_id: messageId,
            p_claim_token: claimToken
        }
    );

    if (error) {
        throw error;
    }

    return data;
}

module.exports = {
    claimMessage,
    completeMessage,
    releaseMessage
};