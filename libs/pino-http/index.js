"use strict";

function parseUrl(req) {
  return req.originalUrl || req.url;
}

function toMilliseconds(hrtime) {
  const nanoseconds = Number(hrtime);
  return nanoseconds / 1e6;
}

function pinoHttp(options = {}) {
  const logger = options.logger || {
    info: () => {},
    error: () => {},
  };

  return function pinoMiddleware(req, res, next) {
    const start = process.hrtime.bigint();
    const startTime = Date.now();

    res.on("finish", () => {
      const duration = toMilliseconds(process.hrtime.bigint() - start);
      logger.info(
        {
          method: req.method,
          url: parseUrl(req),
          status: res.statusCode,
          duration,
          startTime,
        },
        "request completed"
      );
    });

    res.on("error", (err) => {
      logger.error({ err, method: req.method, url: parseUrl(req) }, "request error");
    });

    next();
  };
}

module.exports = pinoHttp;
module.exports.default = pinoHttp;

