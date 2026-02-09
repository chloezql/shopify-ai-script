import { Hono } from 'hono';
import crypto from 'crypto';
import OpenAI from 'openai';

// =====================
// Types
// =====================

interface PersonalizeRequest {
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    utmContent?: string;
    utmTerm?: string;
}

interface PersonalizationCopy {
    heroTitle: string;
    featuredTitle: string;
    iwtTitle: string;
    iwtBody: string;
    vibeBarText: string;
    vibeBarIcon: string;
    trustItems: [string, string, string];
}

interface PersonalizationVisual {
    intensity: 'full' | 'light' | 'none';
    gridCols: 2 | 4;
    flipIWT: boolean;
}

interface PersonalizationConfig {
    sortHints: string[];
    copy: PersonalizationCopy;
    visual: PersonalizationVisual;
}

interface PersonalizeResponse {
    success: boolean;
    cached: boolean;
    config?: PersonalizationConfig;
    error?: string;
    processingTime: number;
}

// =====================
// Cache (in-memory, same pattern as image cache)
// =====================

interface CachedPersonalization {
    config: PersonalizationConfig;
    createdAt: number;
}

const personalizationCache = new Map<string, CachedPersonalization>();
const CACHE_TTL = 2 * 60 * 60 * 1000; // 2 hours (longer than image cache since UTM combos are stable)

function getCacheKey(req: PersonalizeRequest): string {
    const parts = [
        req.utmSource || '',
        req.utmCampaign || '',
        req.utmContent || '',
        req.utmMedium || '',
        req.utmTerm || '',
    ].join('|');
    return crypto.createHash('md5').update(parts).digest('hex');
}

function getCached(key: string): PersonalizationConfig | null {
    const entry = personalizationCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.createdAt > CACHE_TTL) {
        personalizationCache.delete(key);
        return null;
    }
    return entry.config;
}

function setCache(key: string, config: PersonalizationConfig): void {
    personalizationCache.set(key, { config, createdAt: Date.now() });
    // Cleanup if too large
    if (personalizationCache.size > 500) {
        const entries = Array.from(personalizationCache.entries());
        entries.sort((a, b) => a[1].createdAt - b[1].createdAt);
        for (let i = 0; i < 50; i++) {
            personalizationCache.delete(entries[i][0]);
        }
    }
}

// =====================
// OpenAI client (reuse singleton pattern)
// =====================

let openaiClient: OpenAI | null = null;

function getClient(): OpenAI {
    if (!openaiClient) {
        openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    return openaiClient;
}

// =====================
// LLM Prompt
// =====================

const SYSTEM_PROMPT = `You are a landing page personalization engine for "The Pet Brand Kura", a pet e-commerce store.

The store sells dog and cat products across these categories:
- Toys (tug toys, mouse toys, birdy toys)
- Treats/Snacks (pumpkin treats, fish snacks)
- Accessories (harnesses, beds, cat trees)

Given UTM ad campaign parameters, decide how to personalize the homepage. Consider the FULL context holistically — campaign name, content description, traffic source, keywords, audience targeting.

IMPORTANT RULES:
- All copy must be in English, warm, playful, pet-lover tone
- Keep titles SHORT and punchy (max 8 words)
- vibeBarIcon must be a single emoji
- trustItems must be exactly 3 items, each max 4 words
- sortHints should use these available tags: dog, cat, toy, treat, accessory, pet
- visual.intensity should be "full" for campaigns with clear content theme, "light" for generic/platform-only campaigns, "none" if UTM provides no useful context
- visual.gridCols: use 2 for focused campaigns (fewer products shown), 4 for broad campaigns
- visual.flipIWT: true adds visual variety for content campaigns

Return ONLY valid JSON with this exact structure:
{
  "sortHints": ["tag1", "tag2"],
  "copy": {
    "heroTitle": "...",
    "featuredTitle": "...",
    "iwtTitle": "...",
    "iwtBody": "...",
    "vibeBarText": "...",
    "vibeBarIcon": "🐾",
    "trustItems": ["...", "...", "..."]
  },
  "visual": {
    "intensity": "full",
    "gridCols": 2,
    "flipIWT": true
  }
}`;

function buildUserPrompt(req: PersonalizeRequest): string {
    const parts: string[] = [];

    if (req.utmSource) parts.push(`Traffic source: ${req.utmSource}`);
    if (req.utmMedium) parts.push(`Medium: ${req.utmMedium}`);
    if (req.utmCampaign) parts.push(`Campaign: ${req.utmCampaign}`);
    if (req.utmContent) parts.push(`Ad content: ${req.utmContent}`);
    if (req.utmTerm) parts.push(`Keywords/Audience: ${req.utmTerm}`);

    if (parts.length === 0) {
        parts.push('Direct visit with no UTM parameters');
    }

    return parts.join('\n');
}

async function callLLM(req: PersonalizeRequest): Promise<PersonalizationConfig> {
    const client = getClient();

    const response = await client.chat.completions.create({
        model: 'gpt-4.1-mini',
        temperature: 0.6,
        max_tokens: 500,
        response_format: { type: 'json_object' },
        messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: buildUserPrompt(req) },
        ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
        throw new Error('Empty LLM response');
    }

    const parsed = JSON.parse(content);

    // Validate and provide defaults for any missing fields
    return validateConfig(parsed);
}

function validateConfig(raw: any): PersonalizationConfig {
    return {
        sortHints: Array.isArray(raw.sortHints) ? raw.sortHints.filter((s: any) => typeof s === 'string') : [],
        copy: {
            heroTitle: typeof raw.copy?.heroTitle === 'string' ? raw.copy.heroTitle.slice(0, 60) : 'Pawsome Style for Your Fur Babies!',
            featuredTitle: typeof raw.copy?.featuredTitle === 'string' ? raw.copy.featuredTitle.slice(0, 60) : 'Featured Products',
            iwtTitle: typeof raw.copy?.iwtTitle === 'string' ? raw.copy.iwtTitle.slice(0, 50) : 'Stay Happy',
            iwtBody: typeof raw.copy?.iwtBody === 'string' ? raw.copy.iwtBody.slice(0, 150) : 'Try our toy subscription so you can keep your fur baby happy and surprised!',
            vibeBarText: typeof raw.copy?.vibeBarText === 'string' ? raw.copy.vibeBarText.slice(0, 80) : 'Curated Just for You',
            vibeBarIcon: typeof raw.copy?.vibeBarIcon === 'string' ? raw.copy.vibeBarIcon.slice(0, 4) : '🐾',
            trustItems: Array.isArray(raw.copy?.trustItems) && raw.copy.trustItems.length >= 3
                ? [String(raw.copy.trustItems[0]).slice(0, 30), String(raw.copy.trustItems[1]).slice(0, 30), String(raw.copy.trustItems[2]).slice(0, 30)]
                : ['Pet-Safe Materials', 'Free Shipping', '100% Natural'],
        },
        visual: {
            intensity: ['full', 'light', 'none'].includes(raw.visual?.intensity) ? raw.visual.intensity : 'light',
            gridCols: raw.visual?.gridCols === 2 ? 2 : 4,
            flipIWT: raw.visual?.flipIWT === true,
        },
    };
}

// =====================
// Fallback (when LLM fails)
// =====================

function buildFallbackConfig(req: PersonalizeRequest): PersonalizationConfig {
    const campaign = (req.utmCampaign || '').toLowerCase();
    const content = (req.utmContent || '').toLowerCase();
    const combined = campaign + ' ' + content;

    const isDog = /dog|puppy|pup|canine/.test(combined);
    const isCat = /cat|kitten|kitty|feline/.test(combined);

    if (isDog) {
        return {
            sortHints: ['dog', 'toy', 'treat'],
            copy: {
                heroTitle: 'Pawsome Style for Your Pup!',
                featuredTitle: 'Best Picks for Your Dog',
                iwtTitle: 'Keep Your Pup Happy',
                iwtBody: 'Try our toy subscription so you can keep your furry friend happy and surprised!',
                vibeBarText: 'Curated for Dog Lovers',
                vibeBarIcon: '🐕',
                trustItems: ['Vet Approved', 'Durable & Safe', '100% Natural'],
            },
            visual: { intensity: 'full', gridCols: 2, flipIWT: true },
        };
    }

    if (isCat) {
        return {
            sortHints: ['cat', 'toy', 'treat'],
            copy: {
                heroTitle: 'Purrfect Style for Your Cat!',
                featuredTitle: 'Purrfect Picks for Your Cat',
                iwtTitle: 'Keep Your Cat Happy',
                iwtBody: 'Try our toy subscription so you can keep your feline friend happy and surprised!',
                vibeBarText: 'Curated for Cat Parents',
                vibeBarIcon: '🐱',
                trustItems: ['Cat-Safe Materials', 'Purr-fect Quality', '100% Natural'],
            },
            visual: { intensity: 'full', gridCols: 2, flipIWT: true },
        };
    }

    // Generic/platform-only
    return {
        sortHints: [],
        copy: {
            heroTitle: 'Pawsome Style for Your Fur Babies!',
            featuredTitle: 'Featured Products',
            iwtTitle: 'Stay Happy',
            iwtBody: 'Try our toy subscription so you can keep your fur baby happy and surprised!',
            vibeBarText: 'Welcome to The Pet Brand',
            vibeBarIcon: '🐾',
            trustItems: ['Pet-Safe Materials', 'Free Shipping', '100% Natural'],
        },
        visual: { intensity: 'light', gridCols: 4, flipIWT: false },
    };
}

// =====================
// Router
// =====================

const personalizeRouter = new Hono();

personalizeRouter.post('/', async (c) => {
    const startTime = Date.now();

    try {
        const body = await c.req.json<PersonalizeRequest>();

        // No UTM at all → return minimal response fast
        if (!body.utmSource && !body.utmCampaign && !body.utmContent) {
            return c.json<PersonalizeResponse>({
                success: true,
                cached: false,
                config: buildFallbackConfig(body),
                processingTime: Date.now() - startTime,
            });
        }

        const cacheKey = getCacheKey(body);

        // Check cache
        const cached = getCached(cacheKey);
        if (cached) {
            console.log('[Personalize] Cache hit:', cacheKey.slice(0, 8));
            return c.json<PersonalizeResponse>({
                success: true,
                cached: true,
                config: cached,
                processingTime: Date.now() - startTime,
            });
        }

        // Call LLM
        console.log('[Personalize] Calling LLM for:', {
            source: body.utmSource,
            campaign: body.utmCampaign,
            content: body.utmContent,
        });

        let config: PersonalizationConfig;
        try {
            config = await callLLM(body);
            console.log('[Personalize] LLM response:', {
                intensity: config.visual.intensity,
                sortHints: config.sortHints,
                heroTitle: config.copy.heroTitle,
            });
        } catch (llmError) {
            // LLM failed → use fallback
            console.error('[Personalize] LLM error, using fallback:', llmError);
            config = buildFallbackConfig(body);
        }

        // Cache the result
        setCache(cacheKey, config);

        return c.json<PersonalizeResponse>({
            success: true,
            cached: false,
            config,
            processingTime: Date.now() - startTime,
        });
    } catch (error) {
        console.error('[Personalize] Error:', error);
        return c.json<PersonalizeResponse>({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            cached: false,
            processingTime: Date.now() - startTime,
        }, 500);
    }
});

personalizeRouter.get('/health', (c) => {
    return c.json({
        status: 'ok',
        cacheSize: personalizationCache.size,
        timestamp: new Date().toISOString(),
    });
});

export { personalizeRouter };
