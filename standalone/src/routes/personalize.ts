import { Hono } from 'hono';
import crypto from 'crypto';
import OpenAI from 'openai';

// =====================
// Types
// =====================

interface ProductInfo {
    handle: string;
    title: string;
    tags: string[];
}

interface PersonalizeRequest {
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    utmContent?: string;
    utmTerm?: string;
    products?: ProductInfo[];
}

interface PersonalizationCopy {
    heroTitle: string;
    featuredTitle: string;
    iwtTitle: string;
    iwtBody: string;
    vibeBarText: string;
    trustItems: [string, string, string];
}

interface PersonalizationConfig {
    theme: number; // 1-10
    productOrder: string[]; // ordered product handles
    copy: PersonalizationCopy;
    vibeIcon: string; // lucide icon name
    trustIcons: [string, string, string]; // lucide icon names
}

interface PersonalizeResponse {
    success: boolean;
    cached: boolean;
    config?: PersonalizationConfig;
    error?: string;
    processingTime: number;
}

// =====================
// Cache
// =====================

interface CachedPersonalization {
    config: PersonalizationConfig;
    createdAt: number;
}

const personalizationCache = new Map<string, CachedPersonalization>();
const CACHE_TTL = 2 * 60 * 60 * 1000;

function getCacheKey(req: PersonalizeRequest): string {
    const parts = [
        req.utmSource || '',
        req.utmCampaign || '',
        req.utmContent || '',
        req.utmMedium || '',
        req.utmTerm || '',
        // Include product handles in cache key so different product sets get different results
        (req.products || []).map(p => p.handle).sort().join(','),
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
    if (personalizationCache.size > 500) {
        const entries = Array.from(personalizationCache.entries());
        entries.sort((a, b) => a[1].createdAt - b[1].createdAt);
        for (let i = 0; i < 50; i++) {
            personalizationCache.delete(entries[i][0]);
        }
    }
}

// =====================
// OpenAI client
// =====================

let openaiClient: OpenAI | null = null;

function getClient(): OpenAI {
    if (!openaiClient) {
        openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    return openaiClient;
}

// =====================
// Available Lucide icon names (subset we have embedded in frontend)
// =====================

const AVAILABLE_ICONS = [
    'paw-print', 'heart', 'star', 'sparkles', 'shield-check',
    'truck', 'leaf', 'award', 'check-circle', 'gift',
    'smile', 'sun', 'zap', 'home', 'package',
];

// =====================
// Theme definitions (for LLM context)
// =====================

const THEME_DESCRIPTIONS = `
THEME 1 - "Bold Showcase": Products-first layout. 2-column large product grid, IWT flipped, card hover zoom effect, sticky Vibe Bar. Best for: product-focused campaigns, sales, new arrivals.

THEME 2 - "Story First": IWT moved right after hero (story before products). 4-column grid, IWT flipped with image overlap effect, decorative section dividers. Best for: brand storytelling, emotional campaigns, lifestyle content.

THEME 3 - "Quick Shop": Products immediately after hero, then Collections, IWT last. 2-column grid, compact hero (half height), sticky Vibe Bar, card hover zoom. Best for: flash sales, promotions, urgency-driven campaigns.

THEME 4 - "Gallery": Standard section order. 2-column large grid, rounded product cards, parallax hero scrolling effect. Best for: visual/aesthetic campaigns, Instagram-style, curated collections.

THEME 5 - "Discovery": IWT first, then Collections, Products last (discovery journey). 4-column grid, IWT flipped, parallax hero, decorative dividers. Best for: new visitors, exploration-focused, broad audience campaigns.

THEME 6 - "Premium": Standard order. 2-column grid, IWT image overlap effect, extra section spacing, parallax hero, card hover zoom. Best for: premium/luxury positioning, high-value products.

THEME 7 - "Energetic": Standard order. 4-column grid, IWT flipped, compact hero, first product card enlarged spanning 2 columns, sticky Vibe Bar. Best for: energetic/playful campaigns, young audience, TikTok-style.

THEME 8 - "Cozy Browse": IWT first then Products then Collections. 4-column grid, rounded cards, decorative dividers, extra spacing. Best for: relaxed browsing, comfort/cozy themed campaigns, returning customers.

THEME 9 - "Impact": Products first, then Collections, IWT last. 2-column grid, IWT flipped with overlap, compact hero, first card enlarged, card hover zoom. Best for: high-impact product launches, bold campaigns, conversion-focused.

THEME 10 - "Clean Default": Standard order. 4-column grid, subtle hover zoom only. Minimal changes, clean look. Best for: generic traffic, unclear campaign intent, direct visits.
`;

// =====================
// LLM Prompt
// =====================

const SYSTEM_PROMPT = `You are a landing page personalization engine for "The Pet Brand Kura", a pet e-commerce store.

Given UTM campaign parameters and the store's current product catalog, you must:
1. Choose the best visual THEME (1-10) for this visitor
2. Order the products by relevance to the campaign (most relevant first)
3. Write personalized copy
4. Choose appropriate icons

AVAILABLE THEMES:
${THEME_DESCRIPTIONS}

AVAILABLE ICONS (Lucide icon names):
${AVAILABLE_ICONS.join(', ')}

RULES:
- All copy in English, warm/playful pet-lover tone
- Titles: SHORT and punchy (max 8 words)
- trustItems: exactly 3 items, max 4 words each
- productOrder: return ALL product handles, sorted by campaign relevance (most relevant first). Think about what products match the campaign semantically — e.g. "outdoorsy active dog" campaign → harnesses and balls before beds and treats
- vibeIcon + trustIcons: choose from the available Lucide icon names listed above
- theme: pick the number (1-10) that best matches the campaign vibe and intent

Return ONLY valid JSON:
{
  "theme": 1,
  "productOrder": ["handle-1", "handle-2", ...],
  "copy": {
    "heroTitle": "...",
    "featuredTitle": "...",
    "iwtTitle": "...",
    "iwtBody": "...",
    "vibeBarText": "...",
    "trustItems": ["...", "...", "..."]
  },
  "vibeIcon": "paw-print",
  "trustIcons": ["shield-check", "truck", "leaf"]
}`;

function buildUserPrompt(req: PersonalizeRequest): string {
    const parts: string[] = [];

    // UTM info
    if (req.utmSource) parts.push(`Traffic source: ${req.utmSource}`);
    if (req.utmMedium) parts.push(`Medium: ${req.utmMedium}`);
    if (req.utmCampaign) parts.push(`Campaign: ${req.utmCampaign}`);
    if (req.utmContent) parts.push(`Ad content: ${req.utmContent}`);
    if (req.utmTerm) parts.push(`Keywords/Audience: ${req.utmTerm}`);

    if (parts.length === 0) {
        parts.push('Direct visit with no UTM parameters');
    }

    // Product catalog
    if (req.products && req.products.length > 0) {
        parts.push('');
        parts.push('PRODUCT CATALOG:');
        req.products.forEach((p, i) => {
            parts.push(`${i + 1}. handle="${p.handle}" title="${p.title}" tags=[${p.tags.join(', ')}]`);
        });
    }

    return parts.join('\n');
}

async function callLLM(req: PersonalizeRequest): Promise<PersonalizationConfig> {
    const client = getClient();

    const response = await client.chat.completions.create({
        model: 'gpt-4.1-mini',
        temperature: 0.6,
        max_tokens: 800,
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
    return validateConfig(parsed, req.products || []);
}

function validateConfig(raw: any, products: ProductInfo[]): PersonalizationConfig {
    const productHandles = products.map(p => p.handle);

    // Validate productOrder: must be valid handles
    let productOrder: string[] = [];
    if (Array.isArray(raw.productOrder)) {
        // Keep only valid handles from LLM response
        const ordered = raw.productOrder.filter((h: any) => typeof h === 'string' && productHandles.includes(h));
        // Add any missing handles at the end (LLM might miss some)
        const missing = productHandles.filter(h => !ordered.includes(h));
        productOrder = [...ordered, ...missing];
    } else {
        productOrder = productHandles; // default order
    }

    // Validate icon names
    const validIcon = (name: any) => typeof name === 'string' && AVAILABLE_ICONS.includes(name);

    return {
        theme: typeof raw.theme === 'number' && raw.theme >= 1 && raw.theme <= 10 ? raw.theme : 10,
        productOrder,
        copy: {
            heroTitle: typeof raw.copy?.heroTitle === 'string' ? raw.copy.heroTitle.slice(0, 60) : 'Pawsome Style for Your Fur Babies!',
            featuredTitle: typeof raw.copy?.featuredTitle === 'string' ? raw.copy.featuredTitle.slice(0, 60) : 'Featured Products',
            iwtTitle: typeof raw.copy?.iwtTitle === 'string' ? raw.copy.iwtTitle.slice(0, 50) : 'Stay Happy',
            iwtBody: typeof raw.copy?.iwtBody === 'string' ? raw.copy.iwtBody.slice(0, 200) : 'Try our toy subscription so you can keep your fur baby happy and surprised!',
            vibeBarText: typeof raw.copy?.vibeBarText === 'string' ? raw.copy.vibeBarText.slice(0, 80) : 'Curated Just for You',
            trustItems: Array.isArray(raw.copy?.trustItems) && raw.copy.trustItems.length >= 3
                ? [String(raw.copy.trustItems[0]).slice(0, 30), String(raw.copy.trustItems[1]).slice(0, 30), String(raw.copy.trustItems[2]).slice(0, 30)]
                : ['Pet-Safe Materials', 'Free Shipping', '100% Natural'],
        },
        vibeIcon: validIcon(raw.vibeIcon) ? raw.vibeIcon : 'paw-print',
        trustIcons: Array.isArray(raw.trustIcons) && raw.trustIcons.length >= 3
            ? [
                validIcon(raw.trustIcons[0]) ? raw.trustIcons[0] : 'shield-check',
                validIcon(raw.trustIcons[1]) ? raw.trustIcons[1] : 'truck',
                validIcon(raw.trustIcons[2]) ? raw.trustIcons[2] : 'leaf',
            ]
            : ['shield-check', 'truck', 'leaf'],
    };
}

// =====================
// Fallback (when LLM fails)
// =====================

function buildFallbackConfig(req: PersonalizeRequest): PersonalizationConfig {
    const campaign = (req.utmCampaign || '').toLowerCase();
    const content = (req.utmContent || '').toLowerCase();
    const combined = campaign + ' ' + content;
    const productHandles = (req.products || []).map(p => p.handle);

    const isDog = /dog|puppy|pup|canine/.test(combined);
    const isCat = /cat|kitten|kitty|feline/.test(combined);

    if (isDog) {
        // Sort dog-tagged products first
        const sorted = sortHandlesByTags(req.products || [], ['dog']);
        return {
            theme: 1,
            productOrder: sorted,
            copy: {
                heroTitle: 'Pawsome Style for Your Pup!',
                featuredTitle: 'Best Picks for Your Dog',
                iwtTitle: 'Keep Your Pup Happy',
                iwtBody: 'Try our toy subscription so you can keep your furry friend happy and surprised!',
                vibeBarText: 'Curated for Dog Lovers',
                trustItems: ['Vet Approved', 'Durable & Safe', '100% Natural'],
            },
            vibeIcon: 'heart',
            trustIcons: ['shield-check', 'award', 'leaf'],
        };
    }

    if (isCat) {
        const sorted = sortHandlesByTags(req.products || [], ['cat']);
        return {
            theme: 1,
            productOrder: sorted,
            copy: {
                heroTitle: 'Purrfect Style for Your Cat!',
                featuredTitle: 'Purrfect Picks for Your Cat',
                iwtTitle: 'Keep Your Cat Happy',
                iwtBody: 'Try our toy subscription so you can keep your feline friend happy and surprised!',
                vibeBarText: 'Curated for Cat Parents',
                trustItems: ['Cat-Safe Materials', 'Purr-fect Quality', '100% Natural'],
            },
            vibeIcon: 'heart',
            trustIcons: ['shield-check', 'star', 'leaf'],
        };
    }

    return {
        theme: 10,
        productOrder: productHandles,
        copy: {
            heroTitle: 'Pawsome Style for Your Fur Babies!',
            featuredTitle: 'Featured Products',
            iwtTitle: 'Stay Happy',
            iwtBody: 'Try our toy subscription so you can keep your fur baby happy and surprised!',
            vibeBarText: 'Welcome to The Pet Brand',
            trustItems: ['Pet-Safe Materials', 'Free Shipping', '100% Natural'],
        },
        vibeIcon: 'paw-print',
        trustIcons: ['shield-check', 'truck', 'leaf'],
    };
}

function sortHandlesByTags(products: ProductInfo[], boostTags: string[]): string[] {
    const scored = products.map(p => {
        let score = 0;
        boostTags.forEach(bt => {
            if (p.tags.some(t => t.includes(bt))) score += 10;
        });
        return { handle: p.handle, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.map(s => s.handle);
}

// =====================
// Router
// =====================

const personalizeRouter = new Hono();

personalizeRouter.post('/', async (c) => {
    const startTime = Date.now();

    try {
        const body = await c.req.json<PersonalizeRequest>();

        if (!body.utmSource && !body.utmCampaign && !body.utmContent) {
            return c.json<PersonalizeResponse>({
                success: true,
                cached: false,
                config: buildFallbackConfig(body),
                processingTime: Date.now() - startTime,
            });
        }

        const cacheKey = getCacheKey(body);

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

        console.log('[Personalize] Calling LLM for:', {
            source: body.utmSource,
            campaign: body.utmCampaign,
            content: body.utmContent,
            productCount: body.products?.length || 0,
        });

        let config: PersonalizationConfig;
        try {
            config = await callLLM(body);
            console.log('[Personalize] LLM response:', {
                theme: config.theme,
                productOrder: config.productOrder,
                heroTitle: config.copy.heroTitle,
            });
        } catch (llmError) {
            console.error('[Personalize] LLM error, using fallback:', llmError);
            config = buildFallbackConfig(body);
        }

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
