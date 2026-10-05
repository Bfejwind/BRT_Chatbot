// MOM gazetted holidays, including the following Monday for Sunday holidays.
// Refresh when MOM publishes the next year; unknown years are closed to booking.
const holidays = {
    2026: ["01-01", "02-17", "02-18", "03-21", "04-03", "05-01", "05-27", "05-31", "06-01", "08-09", "08-10", "11-08", "11-09", "12-25"],
    2027: ["01-01", "02-06", "02-07", "02-08", "03-10", "03-26", "05-01", "05-17", "05-20", "08-09", "10-28", "12-25"]
};
function isBookableDate(date) {
    const year = String(date).slice(0, 4);
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && Boolean(holidays[year]) &&
        !holidays[year].includes(date.slice(5));
}
function formatSessionHours(time, isChinese = false) {
    const start = new Date(`2000-01-01T${String(time).slice(0, 5)}:00+08:00`);
    const end = new Date(start.getTime() + 90 * 60_000);
    const format = date => date.toLocaleTimeString(isChinese ? "zh-CN" : "en-US", {
        timeZone: "Asia/Singapore", hour: "numeric", minute: "2-digit", hour12: !isChinese
    });
    return `${format(start)} - ${format(end)} (${isChinese ? "新加坡时间" : "Singapore time"})`;
}
function isRouteDateAllowed(date, route) {
    if (!isBookableDate(date)) return false;
    const day = new Date(`${date}T00:00:00+08:00`)
        .toLocaleDateString("en-US", { timeZone: "Asia/Singapore", weekday: "short" });
    if (route === "first_public" || route === "weekday") return ["Mon", "Tue", "Wed", "Thu"].includes(day);
    if (route === "weekend") return ["Fri", "Sat", "Sun"].includes(day);
    return route === "premium" || route === "no_package";
}
module.exports = Object.freeze({
    isRouteDateAllowed,
    isBookableDate,
    formatSessionHours,
    startTimes: Object.freeze(["16:00"]),
    durationMinutes: 90
});
