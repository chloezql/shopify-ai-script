import type { UserContext, TimeOfDay, Season, GenerateRequest } from '../types.js';
import { detectTrafficSource } from './platforms.js';
import { getWeatherForLocation } from '../services/weather.js';

/**
 * Get time of day from hour
 */
export function getTimeOfDay(hour: number): TimeOfDay {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

/**
 * Get season from month (Northern Hemisphere default)
 */
export function getSeason(month: number): Season {
  // month is 0-indexed (0 = January)
  if (month >= 2 && month <= 4) return 'spring';
  if (month >= 5 && month <= 7) return 'summer';
  if (month >= 8 && month <= 10) return 'autumn';
  return 'winter';
}

/**
 * Build complete user context from request data
 */
export async function buildUserContext(request: GenerateRequest): Promise<UserContext> {
  // Parse client time or use server time
  let now: Date;
  if (request.clientTime) {
    now = new Date(request.clientTime);
    if (isNaN(now.getTime())) {
      now = new Date();
    }
  } else {
    now = new Date();
  }
  
  const hour = now.getHours();
  const month = now.getMonth();
  
  // Detect traffic source
  const trafficSource = request.trafficSource || detectTrafficSource({
    utmSource: request.utmSource,
    referrer: request.referrer,
  });
  
  // Get time of day (from request or calculate)
  const timeOfDay = request.timeOfDay || getTimeOfDay(hour);
  
  // Get season (from request or calculate)
  const season = request.season || getSeason(month);
  
  // Build base context
  const context: UserContext = {
    utmSource: request.utmSource,
    utmMedium: request.utmMedium,
    utmCampaign: request.utmCampaign,
    utmContent: request.utmContent,   // 广告内容主题
    utmTerm: request.utmTerm,         // 受众定向/地区
    referrer: request.referrer,
    trafficSource,
    timeOfDay,
    season,
    clientTime: request.clientTime,
    timezone: request.timezone,
    imageType: request.imageType,
    // Product info
    productName: request.productName,
    productDescription: request.productDescription,
    productCategory: request.productCategory,
  };
  
  // Fetch weather if location provided
  if (request.latitude && request.longitude) {
    try {
      const weather = await getWeatherForLocation(request.latitude, request.longitude);
      if (weather) {
        context.weather = {
          condition: weather.condition,
          temperature: weather.temperature,
        };
      }
    } catch (error) {
      console.error('Failed to fetch weather:', error);
    }
  }
  
  return context;
}

