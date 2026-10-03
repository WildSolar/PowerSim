/**
 * Turning a game snapshot into bytes and back: JSON that also carries Maps, Sets and the
 * infinities (open-ended dates are ±Infinity throughout the simulation), gzip-compressed.
 */

type Tagged = { $map: [unknown, unknown][] } | { $set: unknown[] } | { $num: string };

function replacer(this: unknown, _key: string, value: unknown): unknown {
  if (value instanceof Map) return { $map: [...value.entries()] };
  if (value instanceof Set) return { $set: [...value] };
  if (typeof value === "number" && !Number.isFinite(value)) return { $num: String(value) };
  return value;
}

function reviver(_key: string, value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const v = value as Partial<Record<"$map" | "$set" | "$num", unknown>>;
    if ("$map" in v && Object.keys(v).length === 1) return new Map((value as Tagged & { $map: [unknown, unknown][] }).$map);
    if ("$set" in v && Object.keys(v).length === 1) return new Set((value as { $set: unknown[] }).$set);
    if ("$num" in v && Object.keys(v).length === 1) return Number((value as { $num: string }).$num);
  }
  return value;
}

export function encodeJson(value: unknown): string {
  return JSON.stringify(value, replacer);
}

export function decodeJson<T>(text: string): T {
  return JSON.parse(text, reviver) as T;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

export async function gzip(text: string): Promise<Uint8Array> {
  return pipe(new TextEncoder().encode(text), new CompressionStream("gzip"));
}

export async function gunzip(bytes: Uint8Array): Promise<string> {
  return new TextDecoder().decode(await pipe(bytes, new DecompressionStream("gzip")));
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
