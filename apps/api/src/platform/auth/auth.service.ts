import argon2 from 'argon2';
import crypto from 'crypto';

export class AuthService {
  /**
   * Hash password securely using Argon2id
   */
  async hashPassword(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 2 ** 16,
      timeCost: 3
    });
  }

  /**
   * Verify plaintext password against Argon2id hash
   */
  async verifyPassword(hash: string, plaintext: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plaintext);
    } catch {
      return false;
    }
  }

  /**
   * Generate secure random session token
   */
  generateSessionToken(): { token: string; hash: string } {
    const token = crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    return { token, hash };
  }
}

export const authService = new AuthService();
