// Web-standard globals present in every runtime core targets (Node 18+, Electron, Android
// WebView). Declared by hand so the package can keep `lib` free of DOM and Node typings.

declare class TextEncoder {
  encode(input?: string): Uint8Array
}
declare class TextDecoder {
  constructor(label?: string)
  decode(input?: Uint8Array): string
}
declare const crypto: {
  getRandomValues<T extends Uint8Array>(array: T): T
  subtle: { digest(algorithm: 'SHA-256' | 'SHA-1', data: Uint8Array): Promise<ArrayBuffer> }
}
