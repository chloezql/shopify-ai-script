import type { TrafficSource } from '../types.js';

/**
 * Visual style presets for different traffic sources
 * 
 * Instagram: Aesthetic, warm tones, lifestyle photography
 * TikTok: Trendy, vibrant, Gen-Z appeal, bold colors
 * Facebook: Family-friendly, warm, authentic
 * Google: Professional, clean, product-focused
 * Direct: Neutral, elegant default
 */
export const SOURCE_STYLES: Record<TrafficSource, string> = {
  instagram: 'aesthetic lifestyle photography, warm golden tones, soft natural lighting, instagram-worthy composition, cozy atmosphere',
  tiktok: 'trendy vibrant setting, bold neon colors, dynamic urban backdrop, gen-z aesthetic, eye-catching modern style',
  facebook: 'warm family-friendly environment, authentic homey atmosphere, relatable daily life setting, comfortable ambiance',
  google: 'clean professional product showcase, minimalist background, focused studio lighting, commercial quality',
  direct: 'elegant neutral background, professional product photography, balanced lighting, versatile style',
};

/**
 * Detect traffic source from UTM parameters and referrer
 */
export function detectTrafficSource(params: {
  utmSource?: string;
  referrer?: string;
}): TrafficSource {
  const { utmSource, referrer } = params;
  const source = utmSource?.toLowerCase() || '';
  const ref = referrer?.toLowerCase() || '';
  
  // Check UTM source first (most reliable)
  if (source.includes('instagram') || source === 'ig') {
    return 'instagram';
  }
  if (source.includes('tiktok') || source === 'tt') {
    return 'tiktok';
  }
  if (source.includes('facebook') || source === 'fb') {
    return 'facebook';
  }
  if (source.includes('google')) {
    return 'google';
  }
  
  // Fallback to referrer check
  if (ref.includes('instagram.com') || ref.includes('l.instagram.com')) {
    return 'instagram';
  }
  if (ref.includes('tiktok.com')) {
    return 'tiktok';
  }
  if (ref.includes('facebook.com') || ref.includes('fb.com') || ref.includes('l.facebook.com')) {
    return 'facebook';
  }
  if (ref.includes('google.com') || ref.includes('google.co')) {
    return 'google';
  }
  
  return 'direct';
}

/**
 * Get style string for a traffic source
 */
export function getStyleForSource(source: TrafficSource): string {
  return SOURCE_STYLES[source] || SOURCE_STYLES.direct;
}

/**
 * Get a human-readable name for the traffic source
 */
export function getSourceName(source: TrafficSource): string {
  const names: Record<TrafficSource, string> = {
    instagram: 'Instagram',
    tiktok: 'TikTok',
    facebook: 'Facebook',
    google: 'Google Search',
    direct: 'Direct Visit',
  };
  return names[source];
}

