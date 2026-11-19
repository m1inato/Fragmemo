const decoder = new TextDecoder()

export const utf8 = {
  /** `stream` keeps a multi-byte character split across chunks intact. */
  decode: (b: Uint8Array, stream = false) => decoder.decode(b, { stream })
}
