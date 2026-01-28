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
  if (imageType === 'banner' || imageType === 'imageWithText') {
    // Banner 和 Image with Text 使用相同的 prompt 策略
    return generateBannerStylePrompt(client, context, styleHint);
  } else if (imageType === 'collection') {
    // Collection 有专门的 prompt，利用 collection 信息
    return generateCollectionPrompt(client, context, styleHint);
  } else {
    return generateProductScenePrompt(client, context, styleHint);
  }
}

/**
 * 产品图：生成创意场景描述（宠物产品专用）
 * UTM信息是核心决策因素，突出产品的同时融入宠物元素
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

  // 整理UTM信息
  const utmInfo = formatUtmInfo(context);

  const systemPrompt = `You are a creative director for premium PET PRODUCT e-commerce photography.

Your task: Generate a structured scene prompt with 3 clear sections.

## CRITICAL: PRESERVE UTM KEYWORDS
Any specific pet type or breed mentioned in UTM parameters MUST appear in your output:
- If UTM says "cat" → your prompt MUST mention a cat
- If UTM says "dog" or specific breed (golden retriever, corgi, etc.) → MUST include that exact pet
- If UTM says "kitten" or "puppy" → MUST use that exact term
- NEVER change cat→dog or dog→cat. The UTM pet type is MANDATORY.

## UTM INTERPRETATION EXAMPLES
- utm_campaign=cat_beds_winter, utm_content=cozy_cat → "PET: A fluffy cat curled up contentedly..."
- utm_term=golden_retriever_lovers → "PET: A golden retriever resting nearby..."
- utm_campaign=puppy_essentials → "PET: An adorable puppy sniffing curiously..."
- utm_term=SF_Bay_Area, utm_campaign=modern_cat_furniture → "PET: A sleek cat in modern urban setting..."

## OUTPUT FORMAT (follow this structure exactly)
Generate a prompt with these 3 sections:

1. PET ELEMENT (REQUIRED):
   - Specify exact pet type from UTM (cat/dog/specific breed)
   - Describe what the pet is doing (using the product, resting nearby, playing, curious about it)
   - The pet should interact with or show interest in the product
   
2. SCENE SETTING:
   - Environment that matches UTM campaign theme
   - Surface, background, props
   - Lighting and mood
   
3. COMPOSITION:
   - Product as hero, pet as emotional anchor
   - Camera angle and framing

Keep output under 150 words. Be specific and visual.`;

  const userPrompt = `## UTM INFO (EXTRACT PET TYPE AND KEYWORDS FROM HERE):
${utmInfo}

## PRODUCT CONTEXT:
${productInfo ? productInfo + '\n' : ''}Time: ${context.timeOfDay}, ${context.season}
Style: ${styleHint}

IMPORTANT: Look for pet keywords in the UTM parameters above (cat, dog, kitten, puppy, breed names). These MUST appear in your output.

Generate a structured scene prompt with: 1) PET ELEMENT 2) SCENE SETTING 3) COMPOSITION:`;

  try {
    const response = await client.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 150,
      temperature: 0.7,
    });

    const result = response.choices[0]?.message?.content?.trim();
    if (!result) {
      const fallback = generateFallbackPrompt(context);
      console.log('[Product Prompt] Using fallback:', fallback);
      return fallback;
    }
    const finalPrompt = result.replace(/^["']|["']$/g, '');
    console.log('[Product Prompt] Generated:', finalPrompt);
    return finalPrompt;
  } catch (error) {
    console.error('OpenAI error:', error);
    const fallback = generateFallbackPrompt(context);
    console.log('[Product Prompt] Using fallback due to error:', fallback);
    return fallback;
  }
}

/**
 * Banner 图 (Hero Image)：为宠物品牌首页设计有冲击力的英雄图
 * UTM信息是核心决策因素，完全重新设计创造情感连接
 */
async function generateBannerStylePrompt(
  client: OpenAI,
  context: UserContext,
  styleHint: string
): Promise<string> {
  // 整理UTM信息
  const utmInfo = formatUtmInfo(context);

  const systemPrompt = `You are a creative director designing HERO BANNERS for a premium pet brand homepage.

Your task: Create a COMPLETELY NEW hero image concept that captures the essence of pet-human bonding and drives emotional engagement.

## CRITICAL: UTM INFORMATION IS YOUR PRIMARY INPUT
The UTM parameters tell you WHO the audience is, WHAT campaign they came from, and WHAT message resonates with them. This should DRIVE your entire creative direction:

Examples of how to interpret UTM and create matching hero images:
- utm_source=instagram, utm_campaign=summer_adventure_dogs 
  → Energetic golden retriever running on beach at golden hour, splashing through waves, pure joy and freedom, cinematic wide shot
  
- utm_source=facebook, utm_campaign=senior_pet_comfort, utm_content=orthopedic_beds
  → Peaceful senior dog resting on plush bed by window, soft afternoon light, gentle eyes showing contentment, warm intimate mood
  
- utm_source=tiktok, utm_campaign=kitten_playtime
  → Adorable kitten mid-pounce on colorful toy, bright playful energy, freeze-frame action, fun viral-worthy moment
  
- utm_campaign=rescue_stories, utm_content=adoption_love
  → Rescued dog and owner tender moment on couch, emotional connection, heartwarming eye contact, soft natural light, storytelling composition
  
- utm_term=NYC_urban_pet_parents, utm_campaign=modern_pet_lifestyle
  → Stylish french bulldog in minimalist modern apartment, city views through window, designer aesthetic, sophisticated urban vibe
  
- utm_campaign=holiday_gift_guide, utm_content=christmas_pets
  → Cozy holiday scene with dog wearing festive bandana by fireplace, warm Christmas lights, family togetherness, magical atmosphere

## HERO IMAGE REQUIREMENTS
1. EMOTIONAL IMPACT
   - Feature adorable pets (dogs/cats) as the emotional centerpiece
   - Show genuine moments: playful energy, loyal companionship, cozy cuddles
   - The image should make pet parents feel understood and inspired

2. HOMEPAGE-WORTHY COMPOSITION
   - Cinematic, wide format suitable for hero banners
   - Clear visual hierarchy with breathing room for text overlays
   - Magazine-cover quality that stops the scroll
   - Premium lifestyle photography aesthetic

3. BRAND-ALIGNED AESTHETICS
   - Modern pet lifestyle aesthetic (Wild One, Fable Pets, Casper Dog vibes)
   - Real, candid moments - NOT stock photo generic
   - Aspirational yet relatable pet parent lifestyle

DO NOT:
- Create generic pet store imagery
- Make it feel like a product catalog
- Use fake or overly posed looks
- Create cluttered or busy compositions

Output a detailed, vivid hero image concept. Be specific about: pet type & breed, action/pose, setting/environment, lighting, emotional tone, composition, and color mood. Quality over brevity.`;

  const userPrompt = `## UTM & CAMPAIGN INFO (PRIMARY - this drives your creative direction):
${utmInfo}

## CONTEXT (secondary influence):
Time of day: ${context.timeOfDay}
Season: ${context.season}
Platform style: ${styleHint}

Create a stunning hero banner concept. Let the UTM information guide your pet choice, mood, setting, and overall creative direction:`;

  try {
    const response = await client.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 200,
      temperature: 0.7,
    });

    const result = response.choices[0]?.message?.content?.trim();
    if (!result) {
      const fallback = generateBannerFallbackPrompt(context);
      console.log('[Banner Prompt] Using fallback:', fallback);
      return fallback;
    }
    const finalPrompt = result.replace(/^["']|["']$/g, '');
    console.log('[Banner Prompt] Generated:', finalPrompt);
    return finalPrompt;
  } catch (error) {
    console.error('OpenAI error:', error);
    const fallback = generateBannerFallbackPrompt(context);
    console.log('[Banner Prompt] Using fallback due to error:', fallback);
    return fallback;
  }
}

/**
 * Banner 图的 fallback prompt（宠物品牌专用）
 */
function generateBannerFallbackPrompt(context: UserContext): string {
  const styleMap: Record<string, string> = {
    morning: 'Golden retriever stretching in warm morning sunlight, modern living room with designer pet bed, fresh energetic start to the day, magazine-quality lifestyle shot',
    afternoon: 'Playful corgi mid-action in bright airy space, natural window light, joyful dynamic energy, happy pet parent lifestyle',
    evening: 'Cat curled up on soft blanket with golden hour glow streaming through window, cozy warm atmosphere, peaceful contentment, cinematic warmth',
    night: 'Peaceful sleeping puppy in elegant home setting, soft ambient lighting, calm serene mood, premium comfort aesthetic',
  };
  return styleMap[context.timeOfDay] || styleMap.afternoon;
}

/**
 * Get style preference based on traffic source
 * 根据来源匹配不同的视觉风格偏好（宠物品牌专用）
 */
function getStyleHint(source: string): string {
  const hints: Record<string, string> = {
    instagram: 'aesthetic pet lifestyle, curated cozy moments, warm emotional connection, shareable cuteness',
    tiktok: 'dynamic playful energy, trendy pet parent vibes, fun authentic moments, viral-worthy charm',
    facebook: 'relatable pet family moments, heartwarming connection, trustworthy pet care, community feeling',
    google: 'clean professional product focus, credible pet brand, quality-focused, informative clarity',
    pinterest: 'aspirational pet home aesthetic, beautifully styled pet spaces, dreamy inspiration',
    direct: 'premium pet lifestyle brand, modern pet parent aesthetic, elegant yet approachable',
  };
  return hints[source] || hints.direct;
}

/**
 * 格式化UTM信息，清理并整理成可读格式给模型
 * 保留原始关键词便于模型识别
 */
function formatUtmInfo(context: UserContext): string {
  const parts: string[] = [];

  // 清理函数：将URL编码转为可读文本，但保留关键分隔符以保持词汇完整性
  const cleanUtmValue = (value: string): string => {
    return decodeURIComponent(value)
      .replace(/\+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  // 提取宠物相关关键词
  const extractPetKeywords = (value: string): string[] => {
    const keywords: string[] = [];
    const petPatterns = [
      /\b(cat|cats|kitten|kittens|feline)\b/gi,
      /\b(dog|dogs|puppy|puppies|canine)\b/gi,
      /\b(golden.?retriever|corgi|bulldog|poodle|labrador|husky|beagle|terrier|shiba|persian|siamese|maine.?coon|ragdoll|british.?shorthair)\b/gi,
    ];
    for (const pattern of petPatterns) {
      const matches = value.match(pattern);
      if (matches) {
        keywords.push(...matches.map(m => m.toLowerCase()));
      }
    }
    return [...new Set(keywords)];
  };

  // 收集所有UTM值用于提取宠物关键词
  const allUtmValues: string[] = [];

  if (context.utmSource) {
    parts.push(`utm_source: ${context.utmSource}`);
    allUtmValues.push(context.utmSource);
  }
  if (context.utmMedium) {
    const cleaned = cleanUtmValue(context.utmMedium);
    parts.push(`utm_medium: ${cleaned}`);
    allUtmValues.push(cleaned);
  }
  if (context.utmCampaign) {
    const cleaned = cleanUtmValue(context.utmCampaign);
    parts.push(`utm_campaign: ${cleaned}`);
    allUtmValues.push(cleaned);
  }
  if (context.utmContent) {
    const cleaned = cleanUtmValue(context.utmContent);
    parts.push(`utm_content: ${cleaned}`);
    allUtmValues.push(cleaned);
  }
  if (context.utmTerm) {
    const cleaned = cleanUtmValue(context.utmTerm);
    // utm_term 通常包含受众定向信息，可能有宠物类型/品种
    parts.push(`utm_term (audience/targeting): ${cleaned}`);
    allUtmValues.push(cleaned);
  }

  // 如果没有任何UTM信息
  if (parts.length === 0) {
    return 'No UTM parameters available - use general premium pet brand aesthetic';
  }

  // 提取并高亮显示宠物关键词
  const allText = allUtmValues.join(' ');
  const petKeywords = extractPetKeywords(allText);
  if (petKeywords.length > 0) {
    parts.push(`\n⚠️ DETECTED PET KEYWORDS (MUST USE): ${petKeywords.join(', ')}`);
  }

  return parts.join('\n');
}

/**
 * Generate fallback prompt without API call（宠物产品专用）
 */
function generateFallbackPrompt(context: UserContext): string {
  // Time-based scene suggestions with pet elements
  const sceneMap: Record<string, string> = {
    morning: 'Product prominently displayed on natural wood surface, curious puppy peeking from behind, soft morning light, cozy home setting',
    afternoon: 'Product hero shot on clean surface, playful cat paw reaching toward it, bright natural lighting, premium pet lifestyle aesthetic',
    evening: 'Product on cozy blanket surface, sleepy dog curled up nearby, warm golden hour glow through window, homey atmosphere',
    night: 'Product elegantly lit on textured surface, peaceful sleeping pet in soft focus background, warm ambient lighting, serene mood',
  };

  // Season-based mood enhancement
  const seasonMood: Record<string, string> = {
    spring: 'fresh spring energy with blooming pet-friendly plants nearby',
    summer: 'bright vibrant summer vibes with happy energetic pet presence',
    autumn: 'warm cozy autumn tones with snuggly pet atmosphere',
    winter: 'crisp elegant winter mood with cozy indoor pet comfort',
  };

  return `${sceneMap[context.timeOfDay]}, ${seasonMood[context.season]}`;
}

/**
 * Collection 图片：展示系列/集合的整体氛围
 * 利用 collection 信息和包含的产品来生成更相关的场景
 */
async function generateCollectionPrompt(
  client: OpenAI,
  context: UserContext,
  styleHint: string
): Promise<string> {
  // 构建 collection 信息
  let collectionInfo = '';
  if (context.collectionTitle) {
    collectionInfo += `Collection: "${context.collectionTitle}"`;
  }
  if (context.collectionDescription) {
    collectionInfo += `\nDescription: ${context.collectionDescription.slice(0, 150)}`;
  }
  if (context.productNames && context.productNames.length > 0) {
    collectionInfo += `\nProducts in this collection: ${context.productNames.join(', ')}`;
  }
  if (context.productCount) {
    collectionInfo += ` (${context.productCount} products total)`;
  }

  const utmInfo = formatUtmInfo(context);

  const systemPrompt = `You are a creative director for premium PET PRODUCT e-commerce.

Your task: Generate a cohesive visual prompt for a COLLECTION hero image.

## COLLECTION INFO
${collectionInfo || 'General pet products collection'}

## UTM & AUDIENCE CONTEXT
${utmInfo}

## REQUIREMENTS
1. Create a lifestyle scene that represents the ENTIRE collection theme
2. Show multiple products or a curated arrangement that suggests variety
3. Include relevant pets based on UTM keywords or collection theme
4. Maintain brand consistency with premium aesthetic
5. The image should tell a story about the collection's purpose

## OUTPUT FORMAT
Generate a single cohesive prompt (2-3 sentences) describing:
- The overall scene composition
- The mood and atmosphere matching the collection theme
- Relevant pet presence (based on UTM or collection context)
- ${styleHint} aesthetic`;

  try {
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Generate a collection hero image prompt for this ${context.season} ${context.timeOfDay} scene.` }
      ],
      max_tokens: 200,
      temperature: 0.8,
    });

    return completion.choices[0]?.message?.content?.trim() || generateCollectionFallback(context);
  } catch (error) {
    console.error('[OpenAI] Collection prompt error:', error);
    return generateCollectionFallback(context);
  }
}

function generateCollectionFallback(context: UserContext): string {
  const title = context.collectionTitle || 'premium pet products';
  return `Elegant flat lay arrangement showcasing ${title} collection, with curious pet peeking into frame, ${context.season} ${context.timeOfDay} lighting, premium lifestyle photography`;
}

