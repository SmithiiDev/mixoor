import { randomBytes as nodeRandomBytes } from 'crypto';

export function randomBytes(size: number): Uint8Array {
  return new Uint8Array(nodeRandomBytes(size));
}

export function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

export function fromHex(hex: string): Uint8Array {
  return new Uint8Array(Buffer.from(hex, 'hex'));
}
