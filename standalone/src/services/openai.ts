import OpenAI from 'openai';
import type { UserContext } from '../types.js';

let openaiClient: OpenAI | null = null;

/**
 * Get or create OpenAI client
 */
function getClient(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return openaiClient;
}

/**
 * Generate scene prompt based on user context
 * 
 * 产品图：创意场景设计，突出产品
 * Banner 图：只做风格/色调调整，保持原有场景内容
 */
export async function generateScenePrompt(context: UserContext): Promise<string> {
  const client = getClient();
  const styleHint = getStyleHint(context.trafficSource);
  const imageType = context.imageType || 'product';

  // 根据图片类型选择不同的 prompt 策略
  if (imageType === 'banner') {
    return generateBannerStylePrompt(client, context, styleHint);
  } else {
    return generateProductScenePrompt(client, context, styleHint);
  }
}

/**
 * 产品图：生成创意场景描述
 */
async function generateProductScenePrompt(
  client: OpenAI,
  context: UserContext,
  styleHint: string
): Promise<string> {
  // 构建产品信息
  let productInfo = '';
  if (context.productName || context.productCategory) {
    if (context.productName && context.productCategory) {
      productInfo = `Product: ${context.productName} (${context.productCategory})`;
    } else if (context.productName) {
      productInfo = `Product: ${context.productName}`;
    } else if (context.productCategory) {
      productInfo = `Product category: ${context.productCategory}`;
    }
  }

  const systemPrompt = `You are a creative director for premium e-commerce product photography.

Your task: Design a product showcase scene that feels premium and aspirational.

CREATIVE FREEDOM:
- You CAN change the product's position, size, and angle in the scene
- You CAN design creative backgrounds and environments  
- You CAN add RELEVANT props, surfaces, and atmospheric elements

QUALITY RULES:
1. Keep it PREMIUM - think luxury brand campaigns (Apple, Nike, Glossier)
2. Scene must feel REAL and NATURAL, not fake or CGI-looking
3. Product should be the HERO - clearly visible and appealing
4. Props and background must be RELEVANT to the product category
5. Professional photography quality - good lighting, composition, depth

CRITICAL: The scene MUST match the product category and the product itself!
- Analyze the product category and design a scene that makes sense for that specific type of product
- Props, background, and atmosphere should all be RELEVANT to what the product is
- Think about where this product would naturally be used or displayed
- If there's no product information provided, just extract the product from the source image. 
- If it's outdoor gear → outdoor setting. If it's home decor → home setting. And so on.

Output a scene description (max 25 words). Be specific about: surface, props, lighting, mood.`;

  // 解析广告内容主题
  const adTheme = parseAdTheme(context.utmContent);
  // 解析地区信息
  const regionHint = parseRegion(context.utmTerm);

  const userPrompt = `${productInfo ? productInfo + '\n' : ''}Time: ${context.timeOfDay}
Season: ${context.season}
Audience: ${styleHint}
${adTheme ? `Ad theme: ${adTheme}` : ''}
${regionHint ? `Region vibe: ${regionHint}` : ''}
${context.utmCampaign ? `Campaign: ${context.utmCampaign.replace(/[_|+]/g, ' ')}` : ''}

Design a premium showcase scene for this product:`;

  try {
    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 80,
      temperature: 0.7,
    });

    const result = response.choices[0]?.message?.content?.trim();
    if (!result) {
      return generateFallbackPrompt(context);
    }
    return result.replace(/^["']|["']$/g, '');
  } catch (error) {
    console.error('OpenAI error:', error);
    return generateFallbackPrompt(context);
  }
}

/**
 * Banner 图：基于原图风格和构图，创意重构
 * 可以改变结构，但要保持原图的视觉语言和品牌调性
 */
async function generateBannerStylePrompt(
  client: OpenAI,
  context: UserContext,
  styleHint: string
): Promise<string> {
  const systemPrompt = `You are a creative director reimagining hero banners for e-commerce brands.

Your task: Describe a NEW banner design that draws inspiration from the original image's style, composition, and visual language.

CREATIVE APPROACH:
1. LEARN from the original: its color palette, composition style, visual elements, brand vibe
2. REIMAGINE with the new context: adapt to the audience, time, season, campaign theme
3. CREATE a fresh version that feels like a natural evolution, not a copy

WHAT YOU CAN DO:
- Change the overall composition and layout
- Add or modify environmental elements
- Adjust lighting, atmosphere, and mood dramatically
- Introduce new props or background elements that fit the brand
- Shift the visual style while keeping brand consistency

QUALITY STANDARDS:
- Premium advertising quality (think Nike, Apple campaigns)
- Cinematic and aspirational
- Must feel cohesive with the brand's visual identity
- Professional photography aesthetic

GOOD examples:
- "Reimagine as a dramatic sunrise scene, golden light streaming through, same bold typography style, fresh energetic mood"
- "Transform into an urban nightscape, city lights bokeh, modern sleek aesthetic, keep the dynamic diagonal composition"
- "Evolve into a cozy winter setting, warm fireplace glow, soft textures, maintain the lifestyle aspirational feel"

Output a creative direction (max 30 words). Be specific about: atmosphere, lighting, composition style, mood.`;

  // 解析广告内容主题和地区
  const adTheme = parseAdTheme(context.utmContent);
  const regionHint = parseRegion(context.utmTerm);

  const userPrompt = `Time: ${context.timeOfDay}
Season: ${context.season}
Target audience: ${styleHint}
${adTheme ? `Campaign theme: ${adTheme}` : ''}
${regionHint ? `Regional vibe: ${regionHint}` : ''}
${context.utmCampaign ? `Campaign: ${context.utmCampaign.replace(/[_|+]/g, ' ')}` : ''}

Reimagine this banner with a fresh creative direction:`;

  try {
    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 40,
      temperature: 0.5,
    });

    const result = response.choices[0]?.message?.content?.trim();
    if (!result) {
      return generateBannerFallbackPrompt(context);
    }
    return result.replace(/^["']|["']$/g, '');
  } catch (error) {
    console.error('OpenAI error:', error);
    return generateBannerFallbackPrompt(context);
  }
}

/**
 * Banner 图的 fallback prompt
 */
function generateBannerFallbackPrompt(context: UserContext): string {
  const styleMap: Record<string, string> = {
    morning: 'Fresh morning atmosphere, soft golden sunrise light, energetic and inspiring mood, clean modern composition',
    afternoon: 'Bright vibrant scene, dynamic natural lighting, bold confident aesthetic, lifestyle aspirational feel',
    evening: 'Warm golden hour glow, cozy inviting atmosphere, premium lifestyle mood, cinematic depth',
    night: 'Sophisticated urban nightscape, elegant ambient lighting, modern luxury feel, dramatic contrast',
  };
  return styleMap[context.timeOfDay] || styleMap.afternoon;
}

/**
 * Get style preference based on traffic source
 * 根据来源匹配不同的视觉风格偏好
 */
function getStyleHint(source: string): string {
  const hints: Record<string, string> = {
    instagram: 'lifestyle aspirational, curated aesthetic, warm and inviting',
    tiktok: 'dynamic and fresh, modern energy, bold but tasteful',
    facebook: 'relatable and approachable, warm comfortable feel',
    google: 'clean and professional, product-centric, minimal distraction',
    direct: 'versatile premium look, elegant sophistication',
  };
  return hints[source] || hints.direct;
}

/**
 * 解析广告内容主题 (utm_content)
 * 例如: "New+Year+New+Posture+-+video" → "New Year, fresh start theme"
 */
function parseAdTheme(utmContent?: string): string | undefined {
  if (!utmContent) return undefined;

  // 清理 URL 编码
  const cleaned = decodeURIComponent(utmContent)
    .replace(/\+/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  // 识别常见主题关键词
  const themes: Record<string, string> = {
    'new year': 'fresh start, renewal, new beginnings',
    'christmas': 'festive, warm, holiday spirit',
    'holiday': 'festive, celebration, warm',
    'summer': 'bright, vibrant, energetic',
    'spring': 'fresh, light, renewal',
    'winter': 'cozy, elegant, crisp',
    'sale': 'exciting, urgent, value',
    'launch': 'fresh, new, innovative',
    'limited': 'exclusive, premium, special',
  };

  for (const [keyword, theme] of Object.entries(themes)) {
    if (cleaned.includes(keyword)) {
      return theme;
    }
  }

  // 如果没有匹配，返回清理后的内容（前30字符）
  return cleaned.substring(0, 30) || undefined;
}

/**
 * 解析地区信息 (utm_term)
 * 例如: "Lookalikes_SF+Bay+Area" → "urban California, tech-savvy"
 */
function parseRegion(utmTerm?: string): string | undefined {
  if (!utmTerm) return undefined;

  const cleaned = decodeURIComponent(utmTerm)
    .replace(/\+/g, ' ')
    .replace(/_/g, ' ')
    .toLowerCase();

  // 识别地区关键词并返回视觉风格提示
  const regions: Record<string, string> = {
    'sf': 'urban California, tech-forward, modern',
    'bay area': 'urban California, tech-savvy, contemporary',
    'la': 'sunny California, lifestyle, aspirational',
    'los angeles': 'sunny California, glamorous, lifestyle',
    'ny': 'urban sophisticated, dynamic, cosmopolitan',
    'new york': 'urban chic, sophisticated, fast-paced',
    'miami': 'vibrant tropical, colorful, beach lifestyle',
    'chicago': 'urban, classic, refined',
    'texas': 'warm, open, authentic',
    'seattle': 'modern, green, tech-forward',
  };

  for (const [keyword, vibe] of Object.entries(regions)) {
    if (cleaned.includes(keyword)) {
      return vibe;
    }
  }

  return undefined;
}

/**
 * Generate fallback prompt without API call
 */
function generateFallbackPrompt(context: UserContext): string {
  // Time-based scene suggestions
  const sceneMap: Record<string, string> = {
    morning: 'Product on clean marble surface, soft morning light streaming in, fresh minimal aesthetic',
    afternoon: 'Hero shot with dramatic studio lighting, clean gradient background, premium focus',
    evening: 'Warm ambient setting, product on wood surface, golden hour glow, lifestyle mood',
    night: 'Elegant low-key lighting, product on dark textured surface, sophisticated premium feel',
  };

  // Season-based mood enhancement
  const seasonMood: Record<string, string> = {
    spring: 'fresh and light atmosphere',
    summer: 'bright and vibrant energy',
    autumn: 'warm and rich tones',
    winter: 'crisp and elegant mood',
  };

  return `${sceneMap[context.timeOfDay]}, ${seasonMood[context.season]}`;
}
