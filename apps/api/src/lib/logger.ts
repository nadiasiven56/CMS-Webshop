import pino from 'pino';
import { env } from './env.js';

const isDev = env.NODE_ENV !== 'production';

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { app: 'webshop-crm-api' },
  ...(isDev
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            singleLine: false,
            translateTime: 'HH:MM:ss.l',
            ignore: 'pid,hostname,app',
          },
        },
      }
    : {}),
});

export type Logger = typeof logger;
