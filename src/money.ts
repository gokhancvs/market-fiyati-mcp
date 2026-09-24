import { AppError } from './errors.js';

const invalidPrice = () => new AppError('INVALID_PRICE', 'Amount exceeds supported monetary precision.');

// Use the decimal representation of the upstream number, not binary multiplication.
// Normalize each package price to cents before multiplying the package quantity.
export function toCents(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw invalidPrice();
  const [coefficient = '', exponent = '0'] = String(value).toLowerCase().split('e');
  const [whole = '', fraction = ''] = coefficient.split('.');
  const digits = BigInt(whole + fraction);
  const shift = 2 + Number(exponent) - fraction.length;
  let rounded: bigint;
  if (shift >= 0) rounded = digits * 10n ** BigInt(shift);
  else {
    const divisor = 10n ** BigInt(-shift);
    rounded = digits / divisor + (2n * (digits % divisor) >= divisor ? 1n : 0n);
  }
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) throw invalidPrice();
  return Number(rounded);
}

// Signed amounts are needed for a falling price-history series.
export function fromCents(value: number): number {
  if (!Number.isSafeInteger(value)) throw invalidPrice();
  const amount = value / 100;
  if (toCents(Math.abs(amount)) !== Math.abs(value)) throw invalidPrice();
  return amount;
}
