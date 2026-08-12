import { NativeImage } from "@opentui/core";

// Difference hash (dHash): resize to 9x8 grayscale, compare each pixel to its
// right neighbor. Robust to resizing/compression, cheap, no extra deps beyond
// the native image decoder OpenTUI already ships.
const HASH_WIDTH = 9;
const HASH_HEIGHT = 8;
const HASH_BITS = (HASH_WIDTH - 1) * HASH_HEIGHT; // 64

export type ImageHash = bigint;

export async function hashFromUrl(url: string): Promise<ImageHash | null> {
  let image: NativeImage | null = null;
  try {
    image = await NativeImage.load(url);
    return hashFromNativeImage(image);
  } catch {
    return null;
  } finally {
    image?.dispose();
  }
}

export async function hashFromFile(path: string): Promise<ImageHash> {
  const image = await NativeImage.load(path);
  try {
    return hashFromNativeImage(image);
  } finally {
    image.dispose();
  }
}

export function hashFromNativeImage(image: NativeImage): ImageHash {
  const small = image.resize({ width: HASH_WIDTH, height: HASH_HEIGHT, kernel: "area" });
  try {
    const { data, stride } = small.raw("rgba8");
    const gray = new Float64Array(HASH_WIDTH * HASH_HEIGHT);
    for (let y = 0; y < HASH_HEIGHT; y++) {
      for (let x = 0; x < HASH_WIDTH; x++) {
        const idx = y * stride + x * 4;
        gray[y * HASH_WIDTH + x] = data[idx]! * 0.299 + data[idx + 1]! * 0.587 + data[idx + 2]! * 0.114;
      }
    }

    let hash = 0n;
    let bit = 0n;
    for (let y = 0; y < HASH_HEIGHT; y++) {
      for (let x = 0; x < HASH_WIDTH - 1; x++) {
        const left = gray[y * HASH_WIDTH + x]!;
        const right = gray[y * HASH_WIDTH + x + 1]!;
        if (left > right) hash |= 1n << bit;
        bit++;
      }
    }
    return hash;
  } finally {
    small.dispose();
  }
}

function hammingDistance(a: ImageHash, b: ImageHash): number {
  let x = a ^ b;
  let count = 0;
  while (x !== 0n) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}

/** 0..1, 1 = identical dHash, 0 = maximally different. */
export function confidence(a: ImageHash, b: ImageHash): number {
  return 1 - hammingDistance(a, b) / HASH_BITS;
}
