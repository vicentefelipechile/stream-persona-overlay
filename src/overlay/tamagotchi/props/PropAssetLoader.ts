// =========================================================================================================
// PROP ASSET LOADER
// =========================================================================================================
// Simple blob-URL cache for prop image assets.
// =========================================================================================================

export class PropAssetLoader {
  private static cache = new Map<string, string>();

  static async load(url: string): Promise<string> {
    if (this.cache.has(url)) return this.cache.get(url)!;
    const res = await fetch(url);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    this.cache.set(url, objectUrl);
    return objectUrl;
  }

  static fromBase64(base64: string, mimeType = "image/png"): string {
    return `data:${mimeType};base64,${base64}`;
  }
}
