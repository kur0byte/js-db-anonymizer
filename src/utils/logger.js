import winston from 'winston';
import path from 'path';
import fs from 'fs/promises';

const logsDir = path.resolve('logs');

// Crea la carpeta `logs` si no existe
await fs.mkdir(logsDir, { recursive: true }).catch(err => {
  if (err.code !== 'EEXIST') throw err;
});

// Configura Winston para usar esa carpeta
export const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.simple(),
    }),
    // Log de errores en `logs/error.log`
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
    }),
    // Log combinado en `logs/combined.log`
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
    }),
  ],
});
