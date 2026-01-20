import { Hono } from 'hono';
import type { GenerateRequest, GenerateResponse } from '../types.js';
import { buildUserContext } from '../lib/context.js';
import { generateScenePrompt } from '../services/openai.js';
import { generateProductBackground } from '../services/fal.js';
import { getCachedImage, setCachedImage, generateCacheKey } from '../services/cache.js';

const generateRouter = new Hono();

/**
 * POST /api/generate
 * 
 * Generate an AI-powered product image with contextual background
 */
generateRouter.post('/', async (c) => {
    const startTime = Date.now();

    try {
        // Parse request body
        const body = await c.req.json<GenerateRequest>();

        // Validate required fields
        if (!body.imageUrl) {
            return c.json<GenerateResponse>({
                success: false,
                error: 'imageUrl is required',
                cached: false,
                processingTime: Date.now() - startTime,
                context: {
                    trafficSource: 'direct',
                    timeOfDay: 'afternoon',
                    season: 'summer',
                },
            }, 400);
        }

        console.log('[Generate] Request received:', {
            imageUrl: body.imageUrl.substring(0, 50) + '...',
            utmSource: body.utmSource,
            forceGenerate: body.forceGenerate,
        });

        // Build user context
        const context = await buildUserContext(body);

        console.log('[Generate] Context built:', {
            trafficSource: context.trafficSource,
            timeOfDay: context.timeOfDay,
            season: context.season,
            weather: context.weather?.condition,
        });

        // Generate cache key
        const cacheKey = generateCacheKey(body.imageUrl, context);

        // Check cache (unless forceGenerate is true)
        if (!body.forceGenerate) {
            const cached = getCachedImage(cacheKey);
            if (cached) {
                console.log('[Generate] Cache hit!');
                return c.json<GenerateResponse>({
                    success: true,
                    imageUrl: cached.imageUrl,
                    prompt: cached.prompt,
                    cached: true,
                    processingTime: Date.now() - startTime,
                    context: {
                        trafficSource: context.trafficSource,
                        timeOfDay: context.timeOfDay,
                        season: context.season,
                        weather: context.weather?.condition,
                        campaign: context.utmCampaign,
                    },
                });
            }
        }

        // Generate scene prompt using OpenAI
        console.log('[Generate] Generating scene prompt...');
        const scenePrompt = await generateScenePrompt(context);
        console.log('[Generate] Scene prompt:', scenePrompt);

        // Generate image using fal.ai
        console.log('[Generate] Generating image...');
        const result = await generateProductBackground({
            imageUrl: body.imageUrl,
            prompt: scenePrompt,
            imageType: body.imageType || 'product',
        });

        // Cache the result
        setCachedImage(cacheKey, {
            imageUrl: result.imageUrl,
            prompt: scenePrompt,
            createdAt: Date.now(),
        });

        const processingTime = Date.now() - startTime;
        console.log(`[Generate] Complete in ${processingTime}ms`);

        return c.json<GenerateResponse>({
            success: true,
            imageUrl: result.imageUrl,
            prompt: scenePrompt,
            cached: false,
            processingTime,
            context: {
                trafficSource: context.trafficSource,
                timeOfDay: context.timeOfDay,
                season: context.season,
                weather: context.weather?.condition,
                campaign: context.utmCampaign,
            },
        });

    } catch (error) {
        console.error('[Generate] Error:', error);

        return c.json<GenerateResponse>({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            cached: false,
            processingTime: Date.now() - startTime,
            context: {
                trafficSource: 'direct',
                timeOfDay: 'afternoon',
                season: 'summer',
            },
        }, 500);
    }
});

/**
 * GET /api/generate/health
 * Health check endpoint
 */
generateRouter.get('/health', (c) => {
    return c.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
    });
});

export { generateRouter };

