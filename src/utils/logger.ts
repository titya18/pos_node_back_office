import winston from 'winston';
import path from 'path';

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, stack }) => {
    return `${timestamp} ${level}: ${message} ${stack ? stack : ''}`;
  })
);

// Define transports (where logs will be written)
const transports = [
  // Console transport for development
  new winston.transports.Console({
    level: 'debug', // Log level for console
    format: winston.format.combine(
      winston.format.colorize(),
      logFormat
    ),
  }),
  // File transport for errors
  new winston.transports.File({
    filename: path.join(__dirname, '../../error.log'), // Path to error log file
    level: 'error', // Only log errors and above
    format: logFormat,
  }),
  // File transport for combined logs
  new winston.transports.File({
    filename: path.join(__dirname, '../../combined.log'), // Path to combined log file
    level: 'info', // Log info and above
    format: logFormat,
  }),
];

// Create the logger
const logger = winston.createLogger({
  format: logFormat,
  transports,
  exceptionHandlers: [
    new winston.transports.File({ filename: path.join(__dirname, '../../exceptions.log') })
  ],
  rejectionHandlers: [
    new winston.transports.File({ filename: path.join(__dirname, '../../rejections.log') })
  ]
});

export default logger;
