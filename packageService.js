const supabase = require("./supabaseClient");
async function getActivePackage(customerPhone, now = new Date()) {
    const { data, error } = await supabase.from("customer_packages")
        .select("id, allowed_routes, expires_on, total_uses, used_uses")
        .eq("customer_phone", customerPhone).eq("active", true);
    if (error) throw error;
    const today = now.toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
    const packages = (data || []).filter(row => (!row.expires_on || row.expires_on >= today) &&
        Number.isInteger(row.total_uses) && Number.isInteger(row.used_uses) && row.used_uses < row.total_uses);
    const allowedRoutes = [...new Set(packages.flatMap(row => row.allowed_routes || []))]
        .filter(route => ["weekday", "weekend", "exclusive", "premium"].includes(route));
    return allowedRoutes.length ? { allowed_routes: allowedRoutes } : null;
}
module.exports = { getActivePackage };
