const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 } as const;
type LogLevel = keyof typeof LOG_LEVELS;

let currentLevel: LogLevel = 'INFO';

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function serializeData(data: unknown): unknown {
  if (data instanceof Error) {
    return { name: data.name, message: data.message, stack: data.stack };
  }
  return data;
}

function log(level: LogLevel, module: string, message: string, data?: unknown): void {
  if (LOG_LEVELS[level] < LOG_LEVELS[currentLevel]) return;

  const entry = {
    time: new Date().toISOString(),
    level,
    module,
    message,
    ...(data !== undefined ? { data: serializeData(data) } : {}),
  };

  if (level === 'ERROR') {
    console.error(JSON.stringify(entry));
  } else if (level === 'WARN') {
    console.warn(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

export function createLogger(module: string) {
  return {
    debug: (msg: string, data?: unknown) => log('DEBUG', module, msg, data),
    info: (msg: string, data?: unknown) => log('INFO', module, msg, data),
    warn: (msg: string, data?: unknown) => log('WARN', module, msg, data),
    error: (msg: string, data?: unknown) => log('ERROR', module, msg, data),
  };
}
