import { LoggerService, LogLevel } from '@nestjs/common';

interface LogRecord {
  timestamp: string;
  level: LogLevel;
  context?: string;
  message: string;
  trace?: string;
}

// Minimal structured (JSON-lines) logger so log aggregators (CloudWatch,
// Loki, Datadog, ...) can parse fields instead of scraping text. Kept
// dependency-free on purpose - swap for pino/winston later if volume or
// transport needs (e.g. shipping to an external sink) demand it; nothing
// outside this file needs to change since callers only depend on
// LoggerService.
export class JsonLoggerService implements LoggerService {
  private write(
    level: LogLevel,
    message: unknown,
    context?: string,
    trace?: string,
  ): void {
    const record: LogRecord = {
      timestamp: new Date().toISOString(),
      level,
      context,
      message: typeof message === 'string' ? message : JSON.stringify(message),
      trace,
    };
    const line = JSON.stringify(record);
    if (level === 'error' || level === 'fatal') {
      // eslint-disable-next-line no-console
      console.error(line);
    } else {
      // eslint-disable-next-line no-console
      console.log(line);
    }
  }

  log(message: unknown, context?: string): void {
    this.write('log', message, context);
  }

  error(message: unknown, trace?: string, context?: string): void {
    this.write('error', message, context, trace);
  }

  warn(message: unknown, context?: string): void {
    this.write('warn', message, context);
  }

  debug(message: unknown, context?: string): void {
    this.write('debug', message, context);
  }

  verbose(message: unknown, context?: string): void {
    this.write('verbose', message, context);
  }

  fatal(message: unknown, context?: string): void {
    this.write('fatal', message, context);
  }
}
