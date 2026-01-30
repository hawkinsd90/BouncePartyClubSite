type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogConfig {
  enabled: boolean;
  minLevel: LogLevel;
  includeTimestamp: boolean;
  includeLocation: boolean;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const IS_PRODUCTION = import.meta.env.PROD;
const IS_DEVELOPMENT = import.meta.env.DEV;

const defaultConfig: LogConfig = {
  enabled: IS_DEVELOPMENT,
  minLevel: IS_PRODUCTION ? 'warn' : 'debug',
  includeTimestamp: true,
  includeLocation: IS_DEVELOPMENT,
};

class Logger {
  private config: LogConfig;
  private context: string;

  constructor(context: string, config: Partial<LogConfig> = {}) {
    this.context = context;
    this.config = { ...defaultConfig, ...config };
  }

  private shouldLog(level: LogLevel): boolean {
    if (!this.config.enabled) return false;
    return LOG_LEVELS[level] >= LOG_LEVELS[this.config.minLevel];
  }

  private formatMessage(level: LogLevel, message: string, _data?: any): string {
    const parts: string[] = [];

    if (this.config.includeTimestamp) {
      parts.push(`[${new Date().toISOString()}]`);
    }

    parts.push(`[${level.toUpperCase()}]`);
    parts.push(`[${this.context}]`);
    parts.push(message);

    return parts.join(' ');
  }

  private getCallerLocation(): string {
    const stack = new Error().stack;
    if (!stack) return '';

    const lines = stack.split('\n');
    const callerLine = lines[4];
    if (!callerLine) return '';

    const match = callerLine.match(/\((.*):(\d+):(\d+)\)/);
    if (match) {
      const [, file, line] = match;
      const filename = file.split('/').pop();
      return `${filename}:${line}`;
    }

    return '';
  }

  debug(message: string, data?: any): void {
    if (!this.shouldLog('debug')) return;

    const formattedMessage = this.formatMessage('debug', message, data);

    if (this.config.includeLocation) {
      console.debug(formattedMessage, this.getCallerLocation(), data || '');
    } else {
      console.debug(formattedMessage, data || '');
    }
  }

  info(message: string, data?: any): void {
    if (!this.shouldLog('info')) return;

    const formattedMessage = this.formatMessage('info', message, data);
    console.info(formattedMessage, data || '');
  }

  warn(message: string, data?: any): void {
    if (!this.shouldLog('warn')) return;

    const formattedMessage = this.formatMessage('warn', message, data);
    console.warn(formattedMessage, data || '');
  }

  error(message: string, error?: Error | any, data?: any): void {
    if (!this.shouldLog('error')) return;

    const formattedMessage = this.formatMessage('error', message, data);

    if (error instanceof Error) {
      console.error(formattedMessage, {
        message: error.message,
        stack: error.stack,
        ...data,
      });
    } else {
      console.error(formattedMessage, error, data || '');
    }
  }

  group(label: string): void {
    if (!this.config.enabled) return;
    console.group(`[${this.context}] ${label}`);
  }

  groupEnd(): void {
    if (!this.config.enabled) return;
    console.groupEnd();
  }

  time(label: string): void {
    if (!this.config.enabled) return;
    console.time(`[${this.context}] ${label}`);
  }

  timeEnd(label: string): void {
    if (!this.config.enabled) return;
    console.timeEnd(`[${this.context}] ${label}`);
  }
}

export function createLogger(context: string, config?: Partial<LogConfig>): Logger {
  return new Logger(context, config);
}

export const logger = {
  create: createLogger,
  isProduction: IS_PRODUCTION,
  isDevelopment: IS_DEVELOPMENT,
};

export default logger;
