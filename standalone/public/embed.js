/**
 * AI Visual Generator - Embed Script
 * 
 * Collects user context (UTM, time, etc.) and replaces product images
 * with AI-generated backgrounds based on traffic source.
 * 
 * Usage in Shopify theme.liquid:
 * <script src="https://your-domain.com/embed.js" 
 *         data-api="https://your-domain.com/api"
 *         data-product-selector=".product__media img"
 *         data-banner-selector=".hero-banner img"
 *         defer></script>
 */

(function () {
    'use strict';

    // Get configuration from script tag
    const scriptTag = document.currentScript;
    const CONFIG = {
        apiUrl: scriptTag?.getAttribute('data-api') || 'http://localhost:3000/api',
        productSelector: scriptTag?.getAttribute('data-product-selector') || '.product__media img',
        bannerSelector: scriptTag?.getAttribute('data-banner-selector') || '.hero-banner img',
        timeout: 15000,
        debug: scriptTag?.getAttribute('data-debug') === 'true',
    };

    // Logging helper
    const log = (...args) => {
        if (CONFIG.debug) {
            console.log('[AI Visual]', ...args);
        }
    };

    // =====================
    // UTM 参数持久化（跨页面保留 UTM）
    // =====================

    const UTM_STORAGE_KEY = 'ai_visual_utm';
    const UTM_SESSION_KEY = 'ai_visual_utm_session'; // 标记当前会话是否有 UTM

    /**
     * 检查是否是站内跳转（referrer 是同站）
     */
    function isInternalNavigation() {
        const referrer = document.referrer;
        if (!referrer) return false;
        try {
            const referrerHost = new URL(referrer).hostname;
            const currentHost = window.location.hostname;
            return referrerHost === currentHost;
        } catch {
            return false;
        }
    }

    /**
     * 从 sessionStorage 获取 UTM 参数
     */
    function getUtmFromSession() {
        try {
            const data = sessionStorage.getItem(UTM_STORAGE_KEY);
            if (!data) return null;
            return JSON.parse(data);
        } catch {
            return null;
        }
    }

    /**
     * 检查当前会话是否已经有过 UTM
     */
    function hasUtmSession() {
        return sessionStorage.getItem(UTM_SESSION_KEY) === 'true';
    }

    /**
     * 保存 UTM 参数到 sessionStorage
     * 完全覆盖：部分 UTM 时，没有的字段留空
     */
    function saveUtmToSession() {
        const params = new URLSearchParams(window.location.search);
        const utmSource = params.get('utm_source');
        const utmMedium = params.get('utm_medium');
        const utmCampaign = params.get('utm_campaign');
        const utmContent = params.get('utm_content');
        const utmTerm = params.get('utm_term');

        // 只有当 URL 中有 UTM 参数时才保存
        if (utmSource || utmCampaign) {
            // 完全覆盖，没有的字段就是 null
            const utmData = {
                utmSource: utmSource || null,
                utmMedium: utmMedium || null,
                utmCampaign: utmCampaign || null,
                utmContent: utmContent || null,
                utmTerm: utmTerm || null,
            };
            try {
                sessionStorage.setItem(UTM_STORAGE_KEY, JSON.stringify(utmData));
                sessionStorage.setItem(UTM_SESSION_KEY, 'true');
                log('📦 UTM saved to session:', utmData);
            } catch (e) {
                log('UTM save error:', e);
            }
        } else if (!isInternalNavigation()) {
            // 外部进入且没有 UTM → 清除之前的 UTM（新访问）
            sessionStorage.removeItem(UTM_STORAGE_KEY);
            sessionStorage.removeItem(UTM_SESSION_KEY);
            log('🗑️ External visit without UTM, cleared session');
        }
    }

    // 页面加载时立即处理 UTM
    saveUtmToSession();

    /**
     * Get UTM parameters (from URL or sessionStorage for internal navigation)
     */
    function getUtmParams() {
        // 优先从 URL 读取
        const params = new URLSearchParams(window.location.search);
        const urlUtmSource = params.get('utm_source');
        const urlUtmCampaign = params.get('utm_campaign');

        // 如果 URL 有 UTM 参数，使用 URL 的
        if (urlUtmSource || urlUtmCampaign) {
            return {
                utmSource: urlUtmSource || undefined,
                utmMedium: params.get('utm_medium') || undefined,
                utmCampaign: urlUtmCampaign || undefined,
                utmContent: params.get('utm_content') || undefined,  // 广告内容主题
                utmTerm: params.get('utm_term') || undefined,        // 受众定向/地区
            };
        }

        // 只有「站内跳转 + 此会话有过 UTM」时才从 sessionStorage 读取
        if (isInternalNavigation() && hasUtmSession()) {
            const savedUtm = getUtmFromSession();
            if (savedUtm) {
                log('📂 Using UTM from session (internal navigation):', savedUtm);
                return {
                    utmSource: savedUtm.utmSource || undefined,
                    utmMedium: savedUtm.utmMedium || undefined,
                    utmCampaign: savedUtm.utmCampaign || undefined,
                    utmContent: savedUtm.utmContent || undefined,
                    utmTerm: savedUtm.utmTerm || undefined,
                };
            }
        }

        // 没有任何 UTM 参数
        return {
            utmSource: undefined,
            utmMedium: undefined,
            utmCampaign: undefined,
            utmContent: undefined,
            utmTerm: undefined,
        };
    }

    /**
     * Get referrer domain
     */
    function getReferrer() {
        return document.referrer || undefined;
    }

    /**
     * Get time context
     */
    function getTimeContext() {
        const now = new Date();
        const hour = now.getHours();
        const month = now.getMonth();

        // Time of day
        let timeOfDay;
        if (hour >= 5 && hour < 12) timeOfDay = 'morning';
        else if (hour >= 12 && hour < 17) timeOfDay = 'afternoon';
        else if (hour >= 17 && hour < 21) timeOfDay = 'evening';
        else timeOfDay = 'night';

        // Season (Northern Hemisphere)
        let season;
        if (month >= 2 && month <= 4) season = 'spring';
        else if (month >= 5 && month <= 7) season = 'summer';
        else if (month >= 8 && month <= 10) season = 'autumn';
        else season = 'winter';

        return {
            timeOfDay,
            season,
            clientTime: now.toISOString(),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        };
    }

    /**
     * Extract product info from Shopify page
     */
    function getProductInfo() {
        // Try Shopify's built-in meta
        if (window.ShopifyAnalytics?.meta?.product) {
            const p = window.ShopifyAnalytics.meta.product;
            return {
                productName: p.title || undefined,
                productCategory: p.type || undefined,
            };
        }

        // Try meta.product from Shopify
        if (window.meta?.product) {
            return {
                productName: window.meta.product.title || undefined,
                productCategory: window.meta.product.type || undefined,
            };
        }

        // Fallback: extract from DOM
        const titleSelectors = [
            '.product__title',
            '.product-single__title',
            'h1.product-title',
            '[data-product-title]',
            '.product-info h1',
            'h1'
        ];

        let productName;
        for (const selector of titleSelectors) {
            const el = document.querySelector(selector);
            if (el?.textContent?.trim()) {
                productName = el.textContent.trim();
                break;
            }
        }

        // Try to get product description (short version)
        const descSelectors = [
            '.product__description',
            '.product-single__description',
            '[data-product-description]',
            '.product-description'
        ];

        let productDescription;
        for (const selector of descSelectors) {
            const el = document.querySelector(selector);
            if (el?.textContent?.trim()) {
                // Take first 100 chars
                productDescription = el.textContent.trim().substring(0, 100);
                break;
            }
        }

        return { productName, productDescription };
    }

    /**
     * Collect all context data
     */
    function collectContext() {
        return {
            ...getUtmParams(),
            referrer: getReferrer(),
            ...getTimeContext(),
            ...getProductInfo(),
        };
    }

    /**
     * Call the generate API
     */
    async function generateImage(imageUrl, imageType) {
        const context = collectContext();

        log('Generating image:', { imageUrl, imageType, context });

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), CONFIG.timeout);

        try {
            const response = await fetch(`${CONFIG.apiUrl}/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    imageUrl,
                    imageType,
                    ...context,
                }),
                signal: controller.signal,
            });

            clearTimeout(timeout);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Generation failed');
            }

            log('Generated:', {
                newUrl: data.imageUrl,
                cached: data.cached,
                processingTime: data.processingTime,
                trafficSource: data.context?.trafficSource,
            });

            return data;
        } catch (error) {
            clearTimeout(timeout);

            if (error.name === 'AbortError') {
                console.error('[AI Visual] Request timed out');
            } else {
                console.error('[AI Visual] Error:', error.message);
            }

            return null;
        }
    }

    /**
     * Replace image with fade transition
     */
    function replaceImage(img, newSrc) {
        return new Promise((resolve) => {
            const tempImg = new Image();

            tempImg.onload = () => {
                // Fade out
                img.style.transition = 'opacity 0.3s ease';
                img.style.opacity = '0.5';

                setTimeout(() => {
                    img.src = newSrc;
                    img.style.opacity = '1';
                    resolve(true);
                }, 150);
            };

            tempImg.onerror = () => {
                console.error('[AI Visual] Failed to load generated image');
                resolve(false);
            };

            tempImg.src = newSrc;
        });
    }

    /**
     * Process a single image element
     */
    async function processImage(img, imageType) {
        // Skip if already processed
        if (img.dataset.aiVisualProcessed) return;
        img.dataset.aiVisualProcessed = 'true';

        // Get original image URL
        const originalSrc = img.src || img.dataset.src;
        if (!originalSrc || !originalSrc.startsWith('http')) {
            log('Skipping invalid image:', originalSrc);
            return;
        }

        // Store original for fallback
        img.dataset.originalSrc = originalSrc;

        // Add loading indicator
        img.style.filter = 'blur(2px)';
        img.style.transition = 'filter 0.3s ease';

        // Generate new image
        const result = await generateImage(originalSrc, imageType);

        // Remove loading indicator
        img.style.filter = '';

        // Replace if successful
        if (result?.imageUrl) {
            await replaceImage(img, result.imageUrl);
            log('Image replaced successfully');
        } else {
            log('Keeping original image');
        }
    }

    /**
     * Check if we should process (has UTM or external referrer)
     */
    function shouldProcess() {
        const utm = getUtmParams();
        const referrer = getReferrer();

        // Process if any UTM parameter exists
        if (utm.utmSource || utm.utmCampaign) {
            return true;
        }

        // Process if referrer is from known platforms
        if (referrer) {
            const knownPlatforms = ['instagram', 'tiktok', 'facebook', 'google'];
            return knownPlatforms.some(p => referrer.toLowerCase().includes(p));
        }

        return false;
    }

    /**
     * Initialize and process images
     */
    function init() {
        log('Initializing...', CONFIG);

        // Check if we should process
        if (!shouldProcess()) {
            log('No relevant UTM/referrer, skipping');
            return;
        }

        log('UTM/referrer detected, processing images...');

        // Process product images
        const productImages = document.querySelectorAll(CONFIG.productSelector);
        productImages.forEach((img) => {
            processImage(img, 'product');
        });
        log(`Found ${productImages.length} product images`);

        // Process banner images
        const bannerImages = document.querySelectorAll(CONFIG.bannerSelector);
        bannerImages.forEach((img) => {
            processImage(img, 'banner');
        });
        log(`Found ${bannerImages.length} banner images`);
    }

    // Auto-init when DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        // Small delay for Shopify dynamic content
        setTimeout(init, 100);
    }

    // Expose API for manual control
    window.AIVisualGenerator = {
        init,
        processImage,
        generateImage,
        collectContext,
        config: CONFIG,
    };

})();

