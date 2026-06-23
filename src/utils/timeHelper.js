// src/utils/timeHelper.js

/**
 * Gets the current hour in India Standard Time (IST)
 * IST is UTC + 5:30
 * @returns {number} The current hour (0-23)
 */
function getIstHour() {
    const now = new Date();
    
    // Get current time in UTC
    const utcHours = now.getUTCHours();
    const utcMinutes = now.getUTCMinutes();
    
    // Convert to IST (UTC + 5 hours 30 minutes)
    let istHours = utcHours + 5;
    let istMinutes = utcMinutes + 30;
    
    if (istMinutes >= 60) {
        istHours += 1;
        istMinutes -= 60;
    }
    
    // Handle day wrap-around if any (though not strictly necessary for just the hour)
    istHours = istHours % 24;
    
    return istHours;
}

module.exports = {
    getIstHour
};
