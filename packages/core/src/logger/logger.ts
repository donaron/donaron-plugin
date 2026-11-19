import pino from 'pino';
import { redactObject, redactSecrets } from './redact.js';

export interface LoggerOptions {
  readonly name?: string;
  readonly level?: 'debug' | 'info' | 'warn' | 'error';
  readonly destination?: { write(chunk: string): void };
}

export interface DonAronLogger {
  debug(context: Record<string, unknown>, message: string): void;
  info(context: Record<string, unknown>, message: string): void;
  warn(context: Record<string, unknown>, message: string): void;
  error(context: Record<string, unknown>, message: string): void;
}

/**
 * Creates a structured Pino logger that redacts sensitive keys, errors, and secret
 * patterns from every context object and message before delegating to Pino.
 */
export function createLogger(options?: LoggerOptions): DonAronLogger {
  const pinoOptions: pino.LoggerOptions = {
    level: options?.level ?? 'info',
    ...(options?.name !== undefined ? { name: options.name } : {}),
  };

  const instance =
    options?.destination !== undefined ? pino(pinoOptions, options.destination) : pino(pinoOptions);

  return {
    debug(context, message) {
      instance.debug(redactObject(context), redactSecrets(message));
    },
    info(context, message) {
      instance.info(redactObject(context), redactSecrets(message));
    },
    warn(context, message) {
      instance.warn(redactObject(context), redactSecrets(message));
    },
    error(context, message) {
      instance.error(redactObject(context), redactSecrets(message));
    },
  };
}
