// src/utils/timeHelper.js

/**
 * Gets the current hour in India Standard Time (IST)
 * IST is UTC + 5:30
 * @returns {number} The current hour (0-23)
 */
function getIstHour() {
    const now = new Date();
    
    // Convert to IST string
    const istString = now.toLocaleString('en-US', { 
        timeZone: 'Asia/Kolkata', 
        hour12: false 
    });
    
    // Extract the hour from the string format "MM/DD/YYYY, HH:MM:SS"
    // The time part is after the comma and space
    const timePart = istString.split(', ')[1];
    const hour = parseInt(timePart.split(':')[0], 10);
    
    return hour;
}

module.exports = {
    getIstHour
};
