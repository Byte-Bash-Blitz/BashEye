// src/utils/streakFreezeUtils.js
const config = require('../config/config');

/**
 * Utility helpers for Streak Freeze calendar month calculations and formatting.
 */
class StreakFreezeUtils {
    /**
     * Extracts calendar month (1-12) and year (e.g. 2026) for a given date in IST.
     * @param {Date|string} date Optional date (defaults to current IST time)
     * @returns {{ month: number, year: number }}
     */
    getCalendarMonthAndYear(date = null) {
        const istDate = date
            ? config.convertToIST(new Date(date))
            : config.getCurrentISTDate();

        return {
            month: istDate.getUTCMonth() + 1, // 1-12
            year: istDate.getUTCFullYear()
        };
    }

    /**
     * Gets yesterday's calendar date string (YYYY-MM-DD) in IST.
     * @param {string|Date} referenceDate Optional reference date (defaults to today in IST)
     * @returns {string} YYYY-MM-DD
     */
    getYesterdayIST(referenceDate = null) {
        const base = referenceDate ? new Date(referenceDate) : config.getCurrentISTDate();
        const yesterday = new Date(base.getTime() - (24 * 60 * 60 * 1000));
        return config.getISTDateString(yesterday);
    }

    /**
     * Gets the date string for N days before reference date in IST.
     * @param {number} days
     * @param {string|Date} referenceDate
     * @returns {string} YYYY-MM-DD
     */
    getPastISTDate(days, referenceDate = null) {
        const base = referenceDate ? new Date(referenceDate) : config.getCurrentISTDate();
        const past = new Date(base.getTime() - (days * 24 * 60 * 60 * 1000));
        return config.getISTDateString(past);
    }

    /**
     * Formats the optional user DM notification when a Streak Freeze is activated.
     * @param {number} protectedStreak
     * @returns {string}
     */
    formatFreezeNotification(protectedStreak) {
        return `🛡️ Your Streak Freeze has been activated! Your ${protectedStreak}-day streak is protected. Your next valid progress submission will continue your streak.`;
    }
}

module.exports = new StreakFreezeUtils();
