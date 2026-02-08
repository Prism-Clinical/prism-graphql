/**
 * Structured Logger
 *
 * Provides structured JSON logging with log levels, correlation IDs,
 * and service context. Designed for observability in distributed systems.
 */

export enum LogLevel {
  DEBUG = "debug",
  INFO = "info",
  WARN = "warn",
  ERROR = "error",
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  [LogLevel.DEBUG]: 0,
  [LogLevel.INFO]: 1,
  [LogLevel.WARN]: 2,
  [LogLevel.ERROR]: 3,
};

export interface LogContext {
  requestId?: string;
  [key: string]: unknown;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  service: string;
  message: string;
  context?: LogContext;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, error?: Error, context?: LogContext): void;
  child(additionalContext: LogContext): Logger;
}

class StructuredLogger implements Logger {
  private readonly minLevel: LogLevel;
  private readonly baseContext: LogContext;

  constructor(
    private readonly service: string,
    minLevel?: LogLevel,
    baseContext?: LogContext
  ) {
    this.minLevel = minLevel ?? getLogLevelFromEnv();
    this.baseContext = baseContext ?? {};
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.minLevel];
  }

  private formatEntry(
    level: LogLevel,
    message: string,
    context?: LogContext,
    error?: Error
  ): LogEntry {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.service,
      message,
    };

    const mergedContext = { ...this.baseContext, ...context };
    if (Object.keys(mergedContext).length > 0) {
      entry.context = mergedContext;
    }

    if (error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }

    return entry;
  }

  private log(
    level: LogLevel,
    message: string,
    context?: LogContext,
    error?: Error
  ): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const entry = this.formatEntry(level, message, context, error);

    // Output as JSON for structured log aggregation
    const output = JSON.stringify(entry);

    switch (level) {
      case LogLevel.DEBUG:
      case LogLevel.INFO:
        console.log(output);
        break;
      case LogLevel.WARN:
        console.warn(output);
        break;
      case LogLevel.ERROR:
        console.error(output);
        break;
    }
  }

  debug(message: string, context?: LogContext): void {
    this.log(LogLevel.DEBUG, message, context);
  }

  info(message: string, context?: LogContext): void {
    this.log(LogLevel.INFO, message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.log(LogLevel.WARN, message, context);
  }

  error(message: string, error?: Error, context?: LogContext): void {
    this.log(LogLevel.ERROR, message, context, error);
  }

  child(additionalContext: LogContext): Logger {
    return new StructuredLogger(this.service, this.minLevel, {
      ...this.baseContext,
      ...additionalContext,
    });
  }
}

function getLogLevelFromEnv(): LogLevel {
  const level = process.env.LOG_LEVEL?.toLowerCase();
  if (level && Object.values(LogLevel).includes(level as LogLevel)) {
    return level as LogLevel;
  }
  return LogLevel.INFO;
}

// Logger factory
const loggers: Map<string, Logger> = new Map();

export function createLogger(service: string): Logger {
  if (!loggers.has(service)) {
    loggers.set(service, new StructuredLogger(service));
  }
  return loggers.get(service)!;
}

// For testing - allows resetting logger state
export function resetLoggers(): void {
  loggers.clear();
}
