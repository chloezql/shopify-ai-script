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
    promoBannerText: string;
    socialProofItems: [string, string, string];
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
// Hash-based theme selection (deterministic, no LLM needed)
// =====================

function selectThemeByHash(req: PersonalizeRequest): number {
    // Use campaign + content + term to deterministically select a theme
    // Different campaigns ALWAYS get different themes (mod 9 → themes 1-9, theme 10 reserved for no-UTM)
    const seed = [
        req.utmCampaign || '',
        req.utmContent || '',
        req.utmTerm || '',
    ].join('|');

    if (!seed.replace(/\|/g, '')) return 10; // No campaign info → clean default

    const hash = crypto.createHash('md5').update(seed).digest('hex');
    // Take first 8 hex chars → number, mod 9 → 0-8, +1 → 1-9
    const num = parseInt(hash.substring(0, 8), 16);
    const theme = (num % 9) + 1;

    console.log('[Personalize] Theme hash:', { seed: seed.substring(0, 60), hash: hash.substring(0, 8), theme });
    return theme;
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
THEME 1 - "Spotlight": Products→IWT→Collections. 2-column large grid with first card hero (spans 2 cols), card shadows, hover zoom, IWT flipped with overlap, sticky Vibe Bar, Promo Banner. DRAMATIC: big product photos, bold layout.
Best for: product launches, new arrivals, specific product campaigns, sales events.

THEME 2 - "Story Arc": IWT→Products→Collections (story-first). Default slider layout (no card changes), IWT flipped with overlap, spacious layout, section dividers, Social Proof Bar. DRAMATIC: brand story leads, emotional flow.
Best for: brand storytelling, new pet parent onboarding, emotional/nurturing campaigns, starter kits, first-time buyers.

THEME 3 - "Flash Deal": Products→Collections→IWT (shop-first). 2-column grid, hover zoom + lift effect, sticky Vibe Bar, Promo Banner, compact spacing. DRAMATIC: urgency-focused, dense product display.
Best for: flash sales, limited-time offers, promotions, discount campaigns, urgency/scarcity campaigns.

THEME 4 - "Gallery": Products→IWT→Collections (standard). Default slider layout (no card changes), parallax hero, spacious layout, Category Pills navigation. DRAMATIC: curated visual gallery feel.
Best for: visual/aesthetic campaigns, Instagram-style content, curated collections, lifestyle photography campaigns.

THEME 5 - "Discovery": Collections→IWT→Products (discovery journey). Default slider layout (no card changes), IWT flipped, parallax hero, section dividers, Category Pills. DRAMATIC: exploration-focused, collections lead.
Best for: new visitors, exploration campaigns, broad audience targeting, awareness campaigns, SEO/organic traffic.

THEME 6 - "Luxe": Products→IWT→Collections (standard). Default slider layout (no card changes), IWT overlap, spacious layout, Social Proof Bar. DRAMATIC: premium white-space, refined.
Best for: premium/luxury positioning, high-value products, gift campaigns, special occasions, quality-focused.

THEME 7 - "Playful": Products→Collections→IWT (shop-first). Default slider layout (no card changes), IWT flipped, sticky Vibe Bar, Promo Banner. DRAMATIC: energetic, fun layout.
Best for: active/outdoor campaigns, toys & play, young energetic audience, TikTok-style, fun/playful campaigns.

THEME 8 - "Cozy": IWT→Products→Collections (story-first). Default slider layout (no card changes), spacious layout, section dividers, Social Proof Bar. DRAMATIC: warm, relaxed, homey feel.
Best for: comfort products, beds & blankets, relaxation campaigns, returning customers, seasonal/holiday gifting.

THEME 9 - "Impact": Products→IWT→Collections (standard). 2-column grid with first card hero, card shadows + hover zoom + lift, IWT flipped with overlap, sticky Vibe Bar, Promo Banner, compact spacing. DRAMATIC: high-conversion, bold.
Best for: conversion-focused campaigns, retargeting, high-intent audiences, performance marketing, best-seller pushes.

THEME 10 - "Clean": Products→IWT→Collections (standard). Default slider layout (no card changes). Minimal visual changes, clean default look. Only Vibe Bar and Trust Block, no extra blocks.
Best for: generic/direct traffic, unclear campaign intent, catch-all default, simple browsing.
`;

// =====================
// LLM Prompt
// =====================

const SYSTEM_PROMPT = `You are a landing page copy & product ordering engine for "The Pet Brand Kura", a pet e-commerce store selling beds, toys, treats, harnesses, and overall pet related items.

Given UTM campaign parameters and the store's product catalog, you MUST:
1. Order ALL products by relevance to the campaign
2. Write personalized copy for multiple page sections
3. Choose appropriate icons

NOTE: Visual theme/layout is selected separately — you only handle copy, product order, and icons.

AVAILABLE ICONS (Lucide names):
${AVAILABLE_ICONS.join(', ')}

COPY RULES:
- All copy in English, warm/playful pet-lover tone
- heroTitle: punchy headline, max 8 words, reflects the campaign vibe
- featuredTitle: product section heading, max 6 words
- iwtTitle: "Image with Text" section heading, max 6 words
- iwtBody: 1-2 sentences, warm and compelling, max 200 chars
- vibeBarText: short tagline displayed below hero, max 60 chars
- trustItems: exactly 3 items, max 4 words each
- promoBannerText: promotional/urgency text for golden banner, max 60 chars. Write something compelling like "Free Shipping on Orders $40+" or "New Puppy? Get 15% Off Starter Kits!"
- socialProofItems: exactly 3 social proof stats, max 25 chars each. E.g. "10,000+ Happy Pets", "500+ Five-Star Reviews", "Vet Approved"

PRODUCT ORDERING:
- Return ALL product handles sorted by campaign relevance (most relevant first)
- Think semantically: "active_dog_gear" → harnesses and toys first, beds last
- Think about the audience: "new_puppy_parents" → starter essentials (bed, treats) first

ICON RULES:
- vibeIcon + trustIcons: choose from available Lucide icon names above
- Match icons to the campaign theme (e.g. heart for nurturing, zap for energetic)

Return ONLY valid JSON:
{
  "productOrder": ["handle-1", "handle-2", ...],
  "copy": {
    "heroTitle": "...",
    "featuredTitle": "...",
    "iwtTitle": "...",
    "iwtBody": "...",
    "vibeBarText": "...",
    "trustItems": ["...", "...", "..."],
    "promoBannerText": "...",
    "socialProofItems": ["...", "...", "..."]
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

    // Theme is selected by hash, not LLM
    const theme = selectThemeByHash(req);

    const response = await client.chat.completions.create({
        model: 'gpt-4.1-mini',
        temperature: 0.7,
        max_tokens: 600,
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
    return validateConfig(parsed, req.products || [], theme);
}

function validateConfig(raw: any, products: ProductInfo[], theme: number = 10): PersonalizationConfig {
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
        theme, // Determined by hash, not LLM
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
            promoBannerText: typeof raw.copy?.promoBannerText === 'string' ? raw.copy.promoBannerText.slice(0, 80) : 'Free Shipping on Orders Over $40!',
            socialProofItems: Array.isArray(raw.copy?.socialProofItems) && raw.copy.socialProofItems.length >= 3
                ? [String(raw.copy.socialProofItems[0]).slice(0, 40), String(raw.copy.socialProofItems[1]).slice(0, 40), String(raw.copy.socialProofItems[2]).slice(0, 40)]
                : ['10,000+ Happy Pets', '500+ Five-Star Reviews', 'Vet Approved'],
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
    const theme = selectThemeByHash(req);

    const isDog = /dog|puppy|pup|canine/.test(combined);
    const isCat = /cat|kitten|kitty|feline/.test(combined);

    if (isDog) {
        // Sort dog-tagged products first
        const sorted = sortHandlesByTags(req.products || [], ['dog']);
        return {
            theme,
            productOrder: sorted,
            copy: {
                heroTitle: 'Pawsome Style for Your Pup!',
                featuredTitle: 'Best Picks for Your Dog',
                iwtTitle: 'Keep Your Pup Happy',
                iwtBody: 'Try our toy subscription so you can keep your furry friend happy and surprised!',
                vibeBarText: 'Curated for Dog Lovers',
                trustItems: ['Vet Approved', 'Durable & Safe', '100% Natural'],
                promoBannerText: 'Free Shipping on Dog Essentials!',
                socialProofItems: ['10,000+ Happy Dogs', '500+ Five-Star Reviews', 'Vet Approved'],
            },
            vibeIcon: 'heart',
            trustIcons: ['shield-check', 'award', 'leaf'],
        };
    }

    if (isCat) {
        const sorted = sortHandlesByTags(req.products || [], ['cat']);
        return {
            theme,
            productOrder: sorted,
            copy: {
                heroTitle: 'Purrfect Style for Your Cat!',
                featuredTitle: 'Purrfect Picks for Your Cat',
                iwtTitle: 'Keep Your Cat Happy',
                iwtBody: 'Try our toy subscription so you can keep your feline friend happy and surprised!',
                vibeBarText: 'Curated for Cat Parents',
                trustItems: ['Cat-Safe Materials', 'Purr-fect Quality', '100% Natural'],
                promoBannerText: 'Free Shipping on Cat Essentials!',
                socialProofItems: ['10,000+ Happy Cats', '500+ Five-Star Reviews', 'Vet Approved'],
            },
            vibeIcon: 'heart',
            trustIcons: ['shield-check', 'star', 'leaf'],
        };
    }

    return {
        theme,
        productOrder: productHandles,
        copy: {
            heroTitle: 'Pawsome Style for Your Fur Babies!',
            featuredTitle: 'Featured Products',
            iwtTitle: 'Stay Happy',
            iwtBody: 'Try our toy subscription so you can keep your fur baby happy and surprised!',
            vibeBarText: 'Welcome to The Pet Brand',
            trustItems: ['Pet-Safe Materials', 'Free Shipping', '100% Natural'],
            promoBannerText: 'Free Shipping on Orders Over $40!',
            socialProofItems: ['10,000+ Happy Pets', '500+ Five-Star Reviews', 'Vet Approved'],
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
