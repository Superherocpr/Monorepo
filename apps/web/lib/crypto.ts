/**
 * Token encryption/decryption utility for OAuth access tokens.
 * Uses AES-256-GCM — authenticated encryption that detects tampering.
 * Requires ENCRYPTION_KEY env var: a 64-character hex string (32 bytes).
 *
 * Generate a key: openssl rand -hex 32
 *
 * Server-side only. Never import this in client components.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
/** AES-GCM recommended IV length (96 bits). */
const IV_BYTES = 12;

/**
 * Reads and validates the ENCRYPTION_KEY environment variable.
 * @returns 32-byte Buffer derived from the hex key.
 * @throws Error if key is missing or not exactly 64 hex characters.
 */
function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY ?? "";
  if (hex.length !== 64) {
    throw new Error(
      "ENCRYPTION_KEY must be a 64-character hex string (32 bytes). " +
        "Generate one with: openssl rand -hex 32"
    );
  }
  return Buffer.from(hex, "hex");
}

/**
 * Encrypts a plain text string using AES-256-GCM.
 * The returned string is safe to store in the database.
 * Format: "<iv_hex>:<auth_tag_hex>:<ciphertext_hex>"
 * @param plain - The plain text to encrypt (e.g. an OAuth access token).
 * @returns Encrypted string.
 */
export function encryptToken(plain: string): string {
  const iv = randomBytes(IV_BYTES);
  const key = getKey();
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypts a string encrypted by encryptToken.
 * @param stored - The "<iv>:<tag>:<ciphertext>" string from the database.
 * @returns The original plain text token.
 * @throws Error if the ciphertext has been tampered with, the key is wrong, or format is invalid.
 */
export function decryptToken(stored: string): string {
  const parts = stored.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted token format — expected <iv>:<tag>:<ciphertext>.");
  }
  const [ivHex, tagHex, dataHex] = parts;
  const key = getKey();
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
