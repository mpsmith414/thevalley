export type Tier = 'low' | 'medium' | 'high';
export type QualitySettings = { pixelRatio: number; shadowMap: number; furShells: number; lod: 0 | 1 | 2; grass: number };

export const QUALITY: Record<Tier, QualitySettings> = {
  high: { pixelRatio: 1.5, shadowMap: 2048, furShells: 16, lod: 0, grass: 40000 },
  medium: { pixelRatio: 1, shadowMap: 1024, furShells: 8, lod: 1, grass: 15000 },
  low: { pixelRatio: 0.75, shadowMap: 512, furShells: 0, lod: 2, grass: 4000 },
};

/** Pick a tier from measured frame rates (frames per second). */
export function autoQuality(fps: number[]): Tier {
  if (fps.length === 0) return 'high';
  const sorted = [...fps].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return median > 55 ? 'high' : median > 35 ? 'medium' : 'low';
}
