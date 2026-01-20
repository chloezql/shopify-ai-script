import { fal } from '@fal-ai/client';
import type { ImageType } from '../types.js';

// Configure fal client
fal.config({
    credentials: process.env.FAL_KEY,
});

export interface GenerateImageInput {
    imageUrl: string;
    prompt: string;
    imageType?: ImageType;
}

export interface GenerateImageOutput {
    imageUrl: string;
    requestId: string;
}

/**
 * 使用 nano-banana-pro/edit 进行图片编辑
 * 
 * 直接在原图基础上修改：
 * - 产品图：保留产品突出，改变氛围和设计
 * - Banner 图：基于现有图进行风格变化
 */
export async function generateProductBackground(
    input: GenerateImageInput
): Promise<GenerateImageOutput> {
    const imageType = input.imageType || 'product';

    console.log(`[fal.ai] Starting ${imageType} edit with nano-banana-pro...`);
    console.log('[fal.ai] Image URL:', input.imageUrl);
    console.log('[fal.ai] Prompt:', input.prompt);

    // 构建完整的 prompt
    const fullPrompt = buildPrompt(input.prompt, imageType);
    console.log('[fal.ai] Full prompt:', fullPrompt);

    try {
        // 添加超时控制 (3分钟)
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('fal.ai request timeout after 3 minutes')), 180000);
        });

        let progressCount = 0;
        const generatePromise = fal.subscribe('fal-ai/nano-banana-pro/edit', {
            input: {
                prompt: fullPrompt,
                image_urls: [input.imageUrl],
                output_format: 'webp',  // WebP 格式，文件更小加载更快
            },
            logs: true,
            onQueueUpdate: (update) => {
                if (update.status === 'IN_PROGRESS') {
                    progressCount++;
                    // 每10次只打印一次，避免刷屏
                    if (progressCount % 10 === 1) {
                        console.log(`[fal.ai] Generation in progress... (${progressCount})`);
                    }
                } else if (update.status === 'IN_QUEUE') {
                    console.log('[fal.ai] Waiting in queue...');
                }
            },
        });

        const result = await Promise.race([generatePromise, timeoutPromise]) as Awaited<typeof generatePromise>;

        console.log('[fal.ai] Raw result:', JSON.stringify(result.data, null, 2));

        const data = result.data as {
            images?: Array<{ url: string }>;
            image?: { url: string };
        };

        const imageUrl = data.images?.[0]?.url || data.image?.url;

        if (!imageUrl) {
            throw new Error('No image generated from fal.ai');
        }

        console.log('[fal.ai] Generation complete:', imageUrl);

        return {
            imageUrl,
            requestId: result.requestId,
        };
    } catch (error) {
        console.error('[fal.ai] Generation error:', error);
        throw error;
    }
}

/**
 * 根据图片类型构建不同的 prompt
 * 
 * 产品图：可以自由设计场景，但产品本身不变
 * Banner 图：只做色调/风格调整，不改变场景内容
 */
function buildPrompt(basePrompt: string, imageType: ImageType): string {
    if (imageType === 'product') {
        // 产品图：产品细节不变，但可以自由设计展示场景
        return `Transform into premium advertising image.
The product itself must stay unchanged (same appearance, color, texture, details).
You CAN freely adjust: product position, size, angle, background, scene composition, add relevant props.
Scene design: ${basePrompt}
Quality: High-end e-commerce photography, luxury brand aesthetic.`;
    } else {
        // Banner 图：基于原图风格创意重构
        return `Reimagine this banner image with a fresh creative direction.
Learn from the original: its visual style, color palette, brand aesthetic.
Create a new version: ${basePrompt}
Quality: Cinematic advertising photography, premium brand campaign aesthetic.`;
    }
}

