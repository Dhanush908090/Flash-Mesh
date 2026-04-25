/**
 * FlashMesh Mesh Cryptography Module
 * Replaces basic XOR obfuscation with military-grade algorithms natively via Web Crypto API.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

export function ab2b64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return btoa(bin);
}

export function b642ab(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes.buffer;
}

export function buf2hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256(data: BufferSource): Promise<ArrayBuffer> {
  return await crypto.subtle.digest('SHA-256', data);
}

export function randBytes(n: number): ArrayBuffer {
  const arr = new Uint8Array(n);
  crypto.getRandomValues(arr);
  return arr.buffer;
}

// 1. Key Derivation: HKDF
export async function deriveKeyHKDF(
  seedKeyMaterial: ArrayBuffer,
  salt: BufferSource,
  info: BufferSource,
  alg: string = 'AES-GCM',
  length: number = 256
): Promise<CryptoKey | ArrayBuffer> {
  const baseKey = await crypto.subtle.importKey('raw', seedKeyMaterial, 'HKDF', false, ['deriveBits']);
  const rawBits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt,
      info,
    },
    baseKey,
    length
  );

  if (!alg) return rawBits;
  if (alg.startsWith('AES')) {
    const aesBits = length >= 256 ? 256 : length;
    const key = await crypto.subtle.importKey(
      'raw',
      rawBits.slice(0, aesBits / 8),
      alg,
      true,
      ['encrypt', 'decrypt']
    );
    // Attach rawBits for compatibility with some internal workflows needing it
    (key as any)._rawBits = rawBits;
    return key;
  }
  return rawBits;
}

// 2. Key Derivation: PBKDF2
export async function deriveKeyPBKDF2(
  passwordBytes: BufferSource,
  salt: BufferSource,
  iterations: number = 200000,
  alg: string = 'AES-GCM',
  length: number = 256
): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', passwordBytes, { name: 'PBKDF2' }, false, ['deriveBits']);
  const rawBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations,
    },
    base,
    length
  );
  const key = await crypto.subtle.importKey('raw', rawBits.slice(0, length / 8), alg, true, ['encrypt', 'decrypt']);
  (key as any)._rawBits = rawBits;
  return key;
}

export async function hmacSign(keyBytes: ArrayBuffer, data: BufferSource): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return await crypto.subtle.sign('HMAC', key, data);
}

// 3. Authenticated Encryption: AES-GCM
export async function aesGcmEncrypt(rawKey: ArrayBuffer, iv: BufferSource, plaintext: BufferSource): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt']);
  return await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
}

export async function aesGcmDecrypt(rawKey: ArrayBuffer, iv: BufferSource, ciphertext: BufferSource): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
  return await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
}

// 4. Authenticated Encryption: AES-CBC + HMAC
export async function aesCbcEncryptWithHmac(rawKey: ArrayBuffer, iv: BufferSource, plaintext: BufferSource): Promise<ArrayBuffer> {
  if (rawKey.byteLength < 48) throw new Error('Derived key too short for CBC+HMAC');
  const aesKey = rawKey.slice(0, 32);
  const macKey = rawKey.slice(32);
  const key = await crypto.subtle.importKey('raw', aesKey, 'AES-CBC', false, ['encrypt']);
  
  const ct = await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, key, plaintext);
  const tag = await hmacSign(macKey, ct);
  
  const combo = new Uint8Array(ct.byteLength + tag.byteLength);
  combo.set(new Uint8Array(ct), 0);
  combo.set(new Uint8Array(tag), ct.byteLength);
  
  return combo.buffer;
}

export async function aesCbcDecryptWithHmac(rawKey: ArrayBuffer, iv: BufferSource, combined: ArrayBuffer): Promise<ArrayBuffer> {
  const aesKey = rawKey.slice(0, 32);
  const macKey = rawKey.slice(32);
  const tagLen = 32;
  
  const ct = combined.slice(0, combined.byteLength - tagLen);
  const tag = combined.slice(combined.byteLength - tagLen);
  
  const expected = await hmacSign(macKey, ct);
  if (buf2hex(expected) !== buf2hex(tag)) throw new Error('HMAC mismatch/tampering detected');
  
  const key = await crypto.subtle.importKey('raw', aesKey, 'AES-CBC', false, ['decrypt']);
  return await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, key, ct);
}

// 5. Authenticated Encryption: AES-CTR + HMAC
export async function aesCtrEncryptWithHmac(rawKey: ArrayBuffer, counter: BufferSource, plaintext: BufferSource): Promise<ArrayBuffer> {
  if (rawKey.byteLength < 48) throw new Error('Derived key too short for CTR+HMAC');
  const aesKey = rawKey.slice(0, 32);
  const macKey = rawKey.slice(32);
  const key = await crypto.subtle.importKey('raw', aesKey, 'AES-CTR', false, ['encrypt']);
  
  const ct = await crypto.subtle.encrypt({ name: 'AES-CTR', counter: counter, length: 64 }, key, plaintext);
  const tag = await hmacSign(macKey, ct);
  
  const combo = new Uint8Array(ct.byteLength + tag.byteLength);
  combo.set(new Uint8Array(ct), 0);
  combo.set(new Uint8Array(tag), ct.byteLength);
  
  return combo.buffer;
}

export async function aesCtrDecryptWithHmac(rawKey: ArrayBuffer, counter: BufferSource, combined: ArrayBuffer): Promise<ArrayBuffer> {
  const aesKey = rawKey.slice(0, 32);
  const macKey = rawKey.slice(32);
  const tagLen = 32;
  
  const ct = combined.slice(0, combined.byteLength - tagLen);
  const tag = combined.slice(combined.byteLength - tagLen);
  
  const expected = await hmacSign(macKey, ct);
  if (buf2hex(expected) !== buf2hex(tag)) throw new Error('HMAC mismatch/tampering detected');
  
  const key = await crypto.subtle.importKey('raw', aesKey, 'AES-CTR', false, ['decrypt']);
  return await crypto.subtle.decrypt({ name: 'AES-CTR', counter: counter, length: 64 }, key, ct);
}

export { enc, dec };
