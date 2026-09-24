import { AppError } from './errors.js';

export type Config = {
  mode: 'offline' | 'live';
  enableExperimental: boolean;
  timeoutMs: number;
  maxResponseBytes: number;
  minIntervalMs: number;
  retries: number;
};
export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const mode = env.MARKET_FIYATI_MODE ?? 'offline';
  if (!['offline', 'live'].includes(mode))
    throw new AppError('CONFIG_ERROR', 'MARKET_FIYATI_MODE must be offline or live.');
  const experimental = env.MARKET_FIYATI_ENABLE_EXPERIMENTAL ?? 'false';
  if (!['true', 'false'].includes(experimental))
    throw new AppError('CONFIG_ERROR', 'Experimental flag must be true or false.');
  const integer = (key: string, fallback: number, min: number, max: number) => {
    const value = env[key] === undefined ? fallback : Number(env[key]);
    if (!Number.isInteger(value) || value < min || value > max || env[key]?.trim() === '')
      throw new AppError('CONFIG_ERROR', `Invalid ${key}; expected integer ${min}..${max}.`);
    return value;
  };
  return {
    mode: mode as Config['mode'],
    enableExperimental: experimental === 'true',
    timeoutMs: integer('MARKET_FIYATI_TIMEOUT_MS', 15000, 10, 120000),
    maxResponseBytes: integer('MARKET_FIYATI_MAX_RESPONSE_BYTES', 5 * 1024 * 1024, 1024, 20 * 1024 * 1024),
    minIntervalMs: integer('MARKET_FIYATI_MIN_INTERVAL_MS', 1000, 0, 10000),
    retries: integer('MARKET_FIYATI_RETRIES', 0, 0, 3)
  };
}
