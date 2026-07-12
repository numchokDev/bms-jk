const serverStartTime = Date.now();

// Convert ms to string representation like "0d 2h 14m 5s"
function formatUptime(ms) {
  if (ms == null || ms < 0) return null;
  const totalSec = Math.floor(ms / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${d}d ${h}h ${m}m ${s}s`;
}

module.exports = {
  serverStartTime,
  formatUptime
};
