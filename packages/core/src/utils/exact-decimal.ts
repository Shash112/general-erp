import { ValidationError } from '../errors/index.js';

/**
 * ExactDecimal — Production-grade exact fixed-point decimal arithmetic utility
 * for General ERP financial operations.
 * 
 * Uses BigInt internally to eliminate floating-point rounding errors and precision loss.
 * Strictly validates input scale to reject silent rounding.
 */
export class ExactDecimal {
  public readonly rawBigInt: bigint;
  public readonly scale: number;

  public static ZERO = new ExactDecimal(0n, 2);

  constructor(rawBigInt: bigint, scale: number = 2) {
    this.rawBigInt = rawBigInt;
    this.scale = scale;
  }

  /**
   * Validates that a string representation of a decimal number does not exceed maxScale.
   * Throws ValidationError if input scale exceeds maxScale or format is invalid.
   */
  public static validateScale(valueStr: string, maxScale: number = 2): void {
    if (typeof valueStr !== 'string' || valueStr.trim() === '') {
      throw new ValidationError('Monetary input must be a non-empty string.');
    }

    const trimmed = valueStr.trim();
    if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
      throw new ValidationError(`Invalid numeric string format: '${valueStr}'.`);
    }

    const parts = trimmed.split('.');
    if (parts.length === 2) {
      const decimalPart = parts[1]!;
      if (decimalPart.length > maxScale) {
        throw new ValidationError(
          `Monetary amount '${valueStr}' exceeds maximum scale of ${maxScale} decimal places. Silent rounding is forbidden.`
        );
      }
    }
  }

  /**
   * Performs deterministic Half-Even (Banker's) rounding on a raw BigInt from sourceScale to targetScale.
   */
  public static halfEvenRound(unroundedRaw: bigint, sourceScale: number, targetScale: number = 2): ExactDecimal {
    if (sourceScale <= targetScale) {
      const scaleDiff = targetScale - sourceScale;
      const factor = 10n ** BigInt(scaleDiff);
      return new ExactDecimal(unroundedRaw * factor, targetScale);
    }

    const scaleDiff = sourceScale - targetScale;
    const divisor = 10n ** BigInt(scaleDiff);
    const half = divisor / 2n;

    const isNegative = unroundedRaw < 0n;
    const absRaw = isNegative ? -unroundedRaw : unroundedRaw;

    const quotient = absRaw / divisor;
    const remainder = absRaw % divisor;

    let roundedQuotient = quotient;
    if (remainder > half) {
      roundedQuotient = quotient + 1n;
    } else if (remainder === half) {
      // Half-even rule: if quotient is odd, round up; if quotient is even, round down (stay even)
      if (quotient % 2n !== 0n) {
        roundedQuotient = quotient + 1n;
      }
    }

    const finalRaw = isNegative ? -roundedQuotient : roundedQuotient;
    return new ExactDecimal(finalRaw, targetScale);
  }

  /**
   * Parses a numeric string into an ExactDecimal instance after validating scale.
   */
  public static parse(valueStr: string, maxScale: number = 2): ExactDecimal {
    ExactDecimal.validateScale(valueStr, maxScale);
    const trimmed = valueStr.trim();
    const isNegative = trimmed.startsWith('-');
    const cleanStr = isNegative ? trimmed.slice(1) : trimmed;
    
    const parts = cleanStr.split('.');
    const integerPart = parts[0]!;
    const decimalPart = (parts[1] || '').padEnd(maxScale, '0');

    const combinedStr = integerPart + decimalPart;
    const rawBigInt = BigInt(combinedStr);

    return new ExactDecimal(isNegative ? -rawBigInt : rawBigInt, maxScale);
  }

  /**
   * Adds two ExactDecimal instances.
   */
  public add(other: ExactDecimal): ExactDecimal {
    if (this.scale !== other.scale) {
      throw new ValidationError(`Cannot add ExactDecimal instances with different scales (${this.scale} vs ${other.scale}).`);
    }
    return new ExactDecimal(this.rawBigInt + other.rawBigInt, this.scale);
  }

  /**
   * Subtracts another ExactDecimal from this instance.
   */
  public sub(other: ExactDecimal): ExactDecimal {
    if (this.scale !== other.scale) {
      throw new ValidationError(`Cannot subtract ExactDecimal instances with different scales (${this.scale} vs ${other.scale}).`);
    }
    return new ExactDecimal(this.rawBigInt - other.rawBigInt, this.scale);
  }

  /**
   * Compares equality with another ExactDecimal instance.
   */
  public equals(other: ExactDecimal): boolean {
    return this.scale === other.scale && this.rawBigInt === other.rawBigInt;
  }

  /**
   * Compares magnitude with another ExactDecimal instance.
   * Returns -1 if this < other, 0 if equal, 1 if this > other.
   */
  public compare(other: ExactDecimal): number {
    if (this.scale !== other.scale) {
      throw new ValidationError(`Cannot compare ExactDecimal instances with different scales.`);
    }
    if (this.rawBigInt < other.rawBigInt) return -1;
    if (this.rawBigInt > other.rawBigInt) return 1;
    return 0;
  }

  public isZero(): boolean {
    return this.rawBigInt === 0n;
  }

  public isPositive(): boolean {
    return this.rawBigInt > 0n;
  }

  public isNegative(): boolean {
    return this.rawBigInt < 0n;
  }

  /**
   * Formats the ExactDecimal back to a standard fixed-point string representation (e.g. "100.50").
   */
  public toString(): string {
    const isNegative = this.rawBigInt < 0n;
    const abs = isNegative ? -this.rawBigInt : this.rawBigInt;
    const str = abs.toString().padStart(this.scale + 1, '0');
    
    const intPart = str.slice(0, str.length - this.scale);
    const decPart = str.slice(str.length - this.scale);
    
    const formatted = `${intPart}.${decPart}`;
    return isNegative ? `-${formatted}` : formatted;
  }
}
