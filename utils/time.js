// utils/time.js
exports.isWithinLast24Hours = (timeSubmittedSec) => {
  if (!timeSubmittedSec) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  return (nowSec - timeSubmittedSec) <= 24 * 60 * 60;
};
