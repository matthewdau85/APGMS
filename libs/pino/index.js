"use strict";

function serialize(entry) {
  if (entry && typeof entry === "object") {
    return { ...entry };
  }
  return { msg: entry };
}

function createLogger(options = {}) {
  const level = options.level || "info";

  function logWithLevel(lvl, entry, message) {
    const payload = {
      level: lvl,
      time: new Date().toISOString(),
      ...serialize(entry),
    };

    if (message) {
      payload.msg = message;
    }

    process.stdout.write(`${JSON.stringify(payload)}\n`);
  }

  return {
    level,
    info(entry, message) {
      logWithLevel("info", entry, message);
    },
    error(entry, message) {
      logWithLevel("error", entry, message);
    },
  };
}

module.exports = createLogger;
module.exports.default = createLogger;

