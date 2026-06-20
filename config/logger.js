const winston = require('winston');
const path = require('path');

const logsDir = path.join(__dirname, '..', '..', 'logs');

const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Application logger (general)
const applicationLogger = winston.createLogger({
  level: 'info',
  levels,
  format,
  transports: [
    new winston.transports.File({
      filename: path.join(logsDir, 'application.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
  ],
});

// Payments logger
const paymentsLogger = winston.createLogger({
  level: 'info',
  levels,
  format,
  transports: [
    new winston.transports.File({
      filename: path.join(logsDir, 'payments.log'),
      maxsize: 5242880,
      maxFiles: 5,
    }),
  ],
});

// Deliveries logger
const deliveriesLogger = winston.createLogger({
  level: 'info',
  levels,
  format,
  transports: [
    new winston.transports.File({
      filename: path.join(logsDir, 'deliveries.log'),
      maxsize: 5242880,
      maxFiles: 5,
    }),
  ],
});

// MacroDroid logger
const macrodroidLogger = winston.createLogger({
  level: 'info',
  levels,
  format,
  transports: [
    new winston.transports.File({
      filename: path.join(logsDir, 'macrodroid.log'),
      maxsize: 5242880,
      maxFiles: 5,
    }),
  ],
});

// Errors logger
const errorsLogger = winston.createLogger({
  level: 'error',
  levels,
  format,
  transports: [
    new winston.transports.File({
      filename: path.join(logsDir, 'errors.log'),
      maxsize: 5242880,
      maxFiles: 5,
    }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
  ],
});

// Audit logger
const auditLogger = winston.createLogger({
  level: 'info',
  levels,
  format,
  transports: [
    new winston.transports.File({
      filename: path.join(logsDir, 'audit.log'),
      maxsize: 5242880,
      maxFiles: 10,
    }),
  ],
});

module.exports = {
  applicationLogger,
  paymentsLogger,
  deliveriesLogger,
  macrodroidLogger,
  errorsLogger,
  auditLogger,
};
