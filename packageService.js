const supabase = require("./supabaseClient");
async function getActivePackage(customerPhone, now = new Date()) {
    const { data, error } = await supabase.from("customer_packages")
        .select("id, allowed_routes, expires_on")
        .eq("customer_phone", customerPhone).eq("active", true);
    if (error) throw error;
    const today = now.toLocaleDateString("en-CA", { timeZone: "Asia/Singapore" });
    const packages = (data || []).filter(row => !row.expires_on || row.expires_on >= today);
    const allowedRoutes = [...new Set(packages.flatMap(row => row.allowed_routes || []))]
        .filter(route => ["weekday", "weekend", "premium"].includes(route));
    return allowedRoutes.length ? { allowed_routes: allowedRoutes } : null;
}
module.exports = { getActivePackage };
