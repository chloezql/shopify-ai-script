import crypto from 'crypto';
import type { CachedImage, UserContext } from '../types.js';

/**
 * In-memory cache for generated images
 * Simple Map-based cache for MVP
 */
const imageCache = new Map<string, CachedImage>();

// Cache TTL: 1 hour
const CACHE_TTL = 60 * 60 * 1000;

/**
 * Generate a hash key from context parameters
 */
export function generateCacheKey(imageUrl: string, context: UserContext): string {
  const cacheableContext = {
    img: imageUrl,
    src: context.trafficSource,
    time: context.timeOfDay,
    season: context.season,
    weather: context.weather?.condition || '',
    campaign: context.utmCampaign || '',
  };
  
  const jsonStr = JSON.stringify(cacheableContext);
  return crypto.createHash('md5').update(jsonStr).digest('hex');
}

/**
 * Get cached image if exists and not expired
 */
export function getCachedImage(cacheKey: string): CachedImage | null {
  const cached = imageCache.get(cacheKey);
  
  if (!cached) {
    return null;
  }
  
  // Check if expired
  if (Date.now() - cached.createdAt > CACHE_TTL) {
    imageCache.delete(cacheKey);
    return null;
  }
  
  return cached;
}

/**
 * Store generated image in cache
 */
export function setCachedImage(cacheKey: string, image: CachedImage): void {
  imageCache.set(cacheKey, image);
  
  // Simple cleanup: remove oldest entries if cache gets too large
  if (imageCache.size > 1000) {
    const entries = Array.from(imageCache.entries());
    entries.sort((a, b) => a[1].createdAt - b[1].createdAt);
    
    // Remove oldest 100 entries
    for (let i = 0; i < 100; i++) {
      imageCache.delete(entries[i][0]);
    }
  }
}

/**
 * Clear all cache (for testing)
 */
export function clearCache(): void {
  imageCache.clear();
}

/**
 * Get cache stats
 */
export function getCacheStats(): { size: number; oldestEntry: number | null } {
  if (imageCache.size === 0) {
    return { size: 0, oldestEntry: null };
  }
  
  let oldest = Date.now();
  for (const entry of imageCache.values()) {
    if (entry.createdAt < oldest) {
      oldest = entry.createdAt;
    }
  }
  
  return {
    size: imageCache.size,
    oldestEntry: oldest,
  };
}

