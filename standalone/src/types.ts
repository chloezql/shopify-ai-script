/**
 * Traffic source detected from UTM parameters or referrer
 */
export type TrafficSource = 'instagram' | 'tiktok' | 'facebook' | 'google' | 'direct';

/**
 * Time of day categories
 */
export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night';

/**
 * Season categories
 */
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

/**
 * Weather conditions
 */
export type WeatherCondition = 'sunny' | 'cloudy' | 'rainy' | 'snowy' | 'stormy';

/**
 * Temperature categories
 */
export type Temperature = 'hot' | 'warm' | 'cool' | 'cold';

/**
 * Image type being processed
 */
export type ImageType = 'product' | 'banner' | 'collection' | 'imageWithText';

/**
 * User context collected from frontend
 */
export interface UserContext {
  // UTM parameters
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;  // 广告内容主题 (e.g. "New Year New Posture - video")
  utmTerm?: string;     // 受众定向/地区 (e.g. "SF Bay Area")
  referrer?: string;

  // Detected traffic source
  trafficSource: TrafficSource;

  // Time context
  timeOfDay: TimeOfDay;
  season: Season;
  clientTime?: string;
  timezone?: string;

  // Weather (optional)
  weather?: {
    condition: WeatherCondition;
    temperature: Temperature;
  };

  // Image info
  imageType?: ImageType;

  // Product info (for product images)
  productName?: string;
  productDescription?: string;
  productCategory?: string;

  // Collection info (for collection images)
  collectionTitle?: string;
  collectionDescription?: string;
  productNames?: string[];  // Products in the collection
  productCount?: number;
}

/**
 * API request body
 */
export interface GenerateRequest {
  imageUrl: string;
  imageType?: ImageType;

  // Product info (for product images)
  productName?: string;
  productDescription?: string;
  productCategory?: string;

  // Collection info (for collection images)
  collectionTitle?: string;
  collectionDescription?: string;
  productNames?: string[];
  productCount?: number;

  // UTM parameters
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;  // 广告内容主题
  utmTerm?: string;     // 受众定向/地区
  referrer?: string;

  // Time context
  timeOfDay?: TimeOfDay;
  season?: Season;
  clientTime?: string;
  timezone?: string;

  // Location for weather
  latitude?: number;
  longitude?: number;

  // Testing options
  forceGenerate?: boolean;
  trafficSource?: TrafficSource;
}

/**
 * API response body
 */
export interface GenerateResponse {
  success: boolean;
  imageUrl?: string;
  prompt?: string;
  cached: boolean;
  processingTime: number;
  error?: string;
  context: {
    trafficSource: TrafficSource;
    timeOfDay: TimeOfDay;
    season: Season;
    weather?: string;
    campaign?: string;
  };
}

/**
 * Cached image entry
 */
export interface CachedImage {
  imageUrl: string;
  prompt: string;
  createdAt: number;
}

