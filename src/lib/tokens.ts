import crypto from 'crypto'

/**
 * Token utilities using the "peppered hash" pattern.
 * - Generate a random token (64 hex chars from 32 random bytes)
 * - Store SHA-256(token + pepper) in DB
 * - To verify: hash the submitted token and compare with stored hash
 */

/** Hash a token with the TOKEN_HASH_PEPPER */
export const hashToken = (token: string): string => {
  const pepper = process.env.TOKEN_HASH_PEPPER || ''
  return crypto.createHash('sha256').update(token + pepper).digest('hex')
}

/** Generate a new random token (64 hex chars) */
export const generateToken = (): string => crypto.randomBytes(32).toString('hex')

/** Verify a submitted token against a stored hash */
export const verifyToken = (token: string, storedHash: string): boolean => {
  const hash = hashToken(token)
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(storedHash))
}
