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

    /**
     * Get UTM parameters from URL
     */
    function getUtmParams() {
        const params = new URLSearchParams(window.location.search);
        return {
            utmSource: params.get('utm_source') || undefined,
            utmMedium: params.get('utm_medium') || undefined,
            utmCampaign: params.get('utm_campaign') || undefined,
            utmContent: params.get('utm_content') || undefined,  // 广告内容主题
            utmTerm: params.get('utm_term') || undefined,        // 受众定向/地区
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

