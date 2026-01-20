import type { WeatherCondition, Temperature } from '../types.js';

/**
 * Weather data returned from API
 */
export interface WeatherData {
  condition: WeatherCondition;
  temperature: Temperature;
  temperatureCelsius: number;
  description: string;
}

// Weather code mapping from Open-Meteo API
const WEATHER_CODE_MAP: Record<number, WeatherCondition> = {
  0: 'sunny',   // Clear sky
  1: 'sunny',   // Mainly clear
  2: 'cloudy',  // Partly cloudy
  3: 'cloudy',  // Overcast
  45: 'cloudy', // Fog
  48: 'cloudy', // Depositing rime fog
  51: 'rainy',  // Light drizzle
  53: 'rainy',  // Moderate drizzle
  55: 'rainy',  // Dense drizzle
  61: 'rainy',  // Slight rain
  63: 'rainy',  // Moderate rain
  65: 'rainy',  // Heavy rain
  71: 'snowy',  // Slight snow
  73: 'snowy',  // Moderate snow
  75: 'snowy',  // Heavy snow
  80: 'rainy',  // Rain showers
  81: 'rainy',  // Moderate rain showers
  82: 'stormy', // Violent rain showers
  85: 'snowy',  // Snow showers
  86: 'snowy',  // Heavy snow showers
  95: 'stormy', // Thunderstorm
  96: 'stormy', // Thunderstorm with hail
  99: 'stormy', // Thunderstorm with heavy hail
};

/**
 * Get temperature category from Celsius
 */
function getTemperatureCategory(celsius: number): Temperature {
  if (celsius >= 30) return 'hot';
  if (celsius >= 20) return 'warm';
  if (celsius >= 10) return 'cool';
  return 'cold';
}

// In-memory weather cache (30 min TTL)
const weatherCache = new Map<string, { data: WeatherData; timestamp: number }>();
const CACHE_TTL = 30 * 60 * 1000;

/**
 * Fetch weather for a location using Open-Meteo API (free, no key needed)
 */
export async function getWeatherForLocation(
  latitude: number,
  longitude: number
): Promise<WeatherData | null> {
  // Round coordinates for cache key (0.1 degree precision ≈ 11km)
  const cacheKey = `${Math.round(latitude * 10) / 10},${Math.round(longitude * 10) / 10}`;
  
  // Check cache
  const cached = weatherCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  
  try {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', latitude.toString());
    url.searchParams.set('longitude', longitude.toString());
    url.searchParams.set('current', 'temperature_2m,weather_code');
    url.searchParams.set('timezone', 'auto');

    const response = await fetch(url.toString());
    
    if (!response.ok) {
      console.error(`Weather API error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const current = data.current;

    if (!current) {
      return null;
    }

    const weatherCode = current.weather_code as number;
    const temperature = current.temperature_2m as number;
    const condition = WEATHER_CODE_MAP[weatherCode] || 'cloudy';
    const temperatureCategory = getTemperatureCategory(temperature);

    const weatherData: WeatherData = {
      condition,
      temperature: temperatureCategory,
      temperatureCelsius: temperature,
      description: `${condition} ${temperatureCategory} weather`,
    };
    
    // Cache the result
    weatherCache.set(cacheKey, { data: weatherData, timestamp: Date.now() });
    
    return weatherData;
  } catch (error) {
    console.error('Weather fetch error:', error);
    return null;
  }
}

