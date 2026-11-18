import { describe, expect, it } from "vitest"

import { canonicalSerialize, CanonicalSerializationError, digest } from "../src/index.js"

describe("canonical serialization", () => {
  it("sorts object keys recursively while preserving array order", () => {
    expect(canonicalSerialize({ z: 1, a: { y: 2, x: [3, 1] } })).toBe('{"a":{"x":[3,1],"y":2},"z":1}')
    expect(digest({ b: 2, a: 1 })).toBe(digest({ a: 1, b: 2 }))
  })

  it("omits undefined object fields like JSON.stringify", () => {
    expect(canonicalSerialize({ z: 1, artifact: undefined, a: 2 })).toBe('{"a":2,"z":1}')
    expect(digest({ outcome: "request_read", artifact: undefined })).toBe(digest({ outcome: "request_read" }))
  })

  it("rejects values that cannot be persisted as canonical JSON", () => {
    expect(() => canonicalSerialize(Number.NaN)).toThrow(CanonicalSerializationError)
    expect(() => canonicalSerialize(new Date())).toThrow(CanonicalSerializationError)
    expect(() => canonicalSerialize({ value: () => 1 })).toThrow(CanonicalSerializationError)
  })
})
