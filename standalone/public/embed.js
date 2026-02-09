/**
 * AI Visual Generator v2 - Embed Script
 * 
 * 完整功能版本，与 theme-snippet.html 同步
 * 
 * Usage in Shopify theme.liquid:
 * <script src="https://shopify-ai-script-production.up.railway.app/embed.js" defer></script>
 */

(function () {
    'use strict';

    const CONFIG = {
        apiUrl: 'https://shopify-ai-script-production.up.railway.app/api',
        // Welcome Modal 配置
        showWelcomeModal: true,
        welcomeModalDelay: 500,
        // 首页产品卡片选择器（适配常见主题，根据实际主题调整）
        productCardSelector: [
            '.product-card-wrapper',  // Dawn 主题
            '.card-wrapper',          // Dawn 主题备选
            '.card--standard',        // Dawn 卡片
            '.product-card',
            '.product-item',
            '.grid__item[class*="product"]',
            '.collection-product-card',
            '.card--product',
            'product-card',
        ].join(', '),
        // 产品详情页媒体容器选择器
        productMediaContainerSelector: '.product__media-list, .product__media-wrapper, .product-media-container, .product__photos, .product-single__photos, .product__media-gallery, .product-gallery, media-gallery',
        // 产品详情页单个媒体项选择器
        productMediaItemSelector: '.product__media-item, .product-media, .product__photo-wrapper, li[data-media-id], .media-gallery__item, .product__media-item--image',
        // Banner/Hero Image 选择器
        bannerSelector: '.banner__media img, .hero-banner img, .slideshow__image, .hero__image img, .image-hero img',
        // Collection Image 选择器
        collectionImageSelector: '.collection-card-wrapper img, .collection-list__item img, .collection-hero img, .collection__image img',
        // Image with Text 选择器
        imageWithTextSelector: '.image-with-text__media img, .image-with-text__media-item img, .image-with-text img',
        maxConcurrent: 8,  // 最大并发生成数（可调整：4-12）
        timeout: 60000,
        debug: true,
        // 使用 sessionStorage 跨页面缓存
        useSessionCache: true,
    };

    const log = (...args) => { if (CONFIG.debug) console.log('[AI Visual]', ...args); };

    // 生成状态管理（内存缓存）
    const generationState = new Map(); // key -> { status, imageUrl, targetImg }

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
     * 检查当前会话是否已经有过 UTM（用于判断站内跳转时是否应该使用存储的 UTM）
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

        log('🔍 saveUtmToSession called:', {
            urlHasUtm: !!(utmSource || utmCampaign),
            utmSource,
            utmCampaign,
            isInternal: isInternalNavigation(),
            currentSession: sessionStorage.getItem(UTM_SESSION_KEY),
            currentUtm: sessionStorage.getItem(UTM_STORAGE_KEY)
        });

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
                sessionStorage.setItem(UTM_SESSION_KEY, 'true'); // 标记此会话有 UTM
                log('📦 UTM saved to session:', utmData);
            } catch (e) {
                log('❌ UTM save error:', e);
            }
        } else if (!isInternalNavigation()) {
            // 外部进入且没有 UTM → 清除之前的 UTM（新访问）
            sessionStorage.removeItem(UTM_STORAGE_KEY);
            sessionStorage.removeItem(UTM_SESSION_KEY);
            log('🗑️ External visit without UTM, cleared session');
        } else {
            log('📍 Internal navigation without UTM, keeping session');
        }
    }

    // 页面加载时立即处理 UTM
    saveUtmToSession();

    // =====================
    // Landing Page 个性化 - 产品元数据预加载
    // =====================

    let _productMetaPromise = null;
    let _productMetaCache = null;

    /**
     * 预加载产品元数据（tags/title/handle）
     * 在脚本加载时立即发起，不等 DOM
     * 到 init() 执行时（300ms 后）数据通常已就绪
     */
    function preloadProductMeta() {
        if (_productMetaPromise) return _productMetaPromise;

        _productMetaPromise = fetch(window.location.origin + '/products.json?limit=250')
            .then(function (res) { return res.ok ? res.json() : null; })
            .then(function (data) {
                if (!data || !data.products) return {};
                var meta = {};
                data.products.forEach(function (p) {
                    // Shopify products.json tags 可能是数组也可能是逗号分隔字符串
                    var rawTags = p.tags;
                    var parsedTags;
                    if (Array.isArray(rawTags)) {
                        parsedTags = rawTags.map(function (t) { return String(t).toLowerCase().trim(); });
                    } else if (typeof rawTags === 'string' && rawTags.length > 0) {
                        parsedTags = rawTags.split(',').map(function (t) { return t.toLowerCase().trim(); }).filter(Boolean);
                    } else {
                        parsedTags = [];
                    }
                    meta[p.handle] = {
                        handle: p.handle,
                        title: (p.title || '').toLowerCase(),
                        tags: parsedTags,
                        type: (p.product_type || '').toLowerCase(),
                        price: p.variants && p.variants[0] ? parseFloat(p.variants[0].price) : 0,
                        available: p.variants ? p.variants.some(function (v) { return v.available; }) : false,
                    };
                });
                _productMetaCache = meta;
                log('[AI-LP] Product meta loaded:', Object.keys(meta).length, 'products');
                return meta;
            })
            .catch(function (err) {
                log('[AI-LP] Product meta fetch failed:', err && err.message ? err.message : err);
                return {};
            });

        return _productMetaPromise;
    }

    // 立即开始预加载（不等 DOM，尽早完成）
    preloadProductMeta();

    // =====================
    // SessionStorage 缓存（跨页面持久化）
    // =====================

    const CACHE_KEY = 'ai_visual_cache';
    const CACHE_TTL = 30 * 60 * 1000; // 30 分钟过期

    function getSessionCache() {
        if (!CONFIG.useSessionCache) return {};
        try {
            const data = sessionStorage.getItem(CACHE_KEY);
            if (!data) return {};
            const parsed = JSON.parse(data);
            // 清理过期缓存
            const now = Date.now();
            Object.keys(parsed).forEach(key => {
                if (parsed[key].timestamp && now - parsed[key].timestamp > CACHE_TTL) {
                    delete parsed[key];
                }
            });
            return parsed;
        } catch {
            return {};
        }
    }

    function setSessionCache(key, imageUrl) {
        if (!CONFIG.useSessionCache) return;
        try {
            const cache = getSessionCache();
            cache[key] = { imageUrl, timestamp: Date.now() };
            sessionStorage.setItem(CACHE_KEY, JSON.stringify(cache));
        } catch (e) {
            log('Cache write error:', e);
        }
    }

    function getCachedUrl(key) {
        const cache = getSessionCache();
        return cache[key]?.imageUrl || null;
    }

    // 生成包含 UTM 信息的缓存 Key
    function getUtmCacheKey(baseKey) {
        const utm = getUtmParams();
        const utmPart = [
            utm.utmSource || '',
            utm.utmCampaign || '',
            utm.utmContent || '',
            utm.utmTerm || '',
        ].filter(Boolean).join('_') || 'direct';
        return `${baseKey}__${utmPart}`;
    }

    // 注入 CSS 动画样式
    const style = document.createElement('style');
    style.textContent = `
    @keyframes ai-shimmer {
        0% { transform: translateX(-100%); }
        100% { transform: translateX(100%); }
    }
    
    @keyframes ai-pulse {
        0%, 100% { opacity: 0.6; }
        50% { opacity: 1; }
    }
    
    @keyframes ai-reveal {
        0% { clip-path: inset(0 100% 0 0); }
        100% { clip-path: inset(0 0 0 0); }
    }
    
    .ai-loading-overlay {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.03);
        overflow: hidden;
        pointer-events: none;
        z-index: 10;
    }
    
    /* 移除文字提示，只保留 shimmer 效果 */
    
    .ai-loading-overlay::after {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: linear-gradient(
            90deg,
            transparent 0%,
            rgba(255,255,255,0.4) 50%,
            transparent 100%
        );
        animation: ai-shimmer 1.5s ease-in-out infinite;
    }
    
    .ai-reveal {
        animation: ai-reveal 0.8s ease-out forwards;
    }
    
    .ai-generated-badge {
        position: absolute;
        top: 8px;
        right: 8px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        font-size: 10px;
        padding: 4px 8px;
        border-radius: 12px;
        z-index: 5;
        pointer-events: none;
        opacity: 0.9;
    }
    
    /* 产品卡片第二张图的容器样式 */
    .ai-secondary-image-wrapper {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        opacity: 0;
        transition: opacity 0.3s ease;
    }
    
    .product-card:hover .ai-secondary-image-wrapper,
    .card--product:hover .ai-secondary-image-wrapper,
    [class*="product"]:hover .ai-secondary-image-wrapper {
        opacity: 1;
    }
    
    /* ===================== */
    /* Welcome Modal - Warm Theme */
    /* ===================== */
    
    @keyframes ai-modal-fade-in {
        from { opacity: 0; }
        to { opacity: 1; }
    }
    
    @keyframes ai-modal-slide-up {
        from { 
            opacity: 0;
            transform: translate(-50%, -48%);
        }
        to { 
            opacity: 1;
            transform: translate(-50%, -50%);
        }
    }
    
    @keyframes ai-paw-float {
        0%, 100% { transform: translateY(0) rotate(-5deg); }
        50% { transform: translateY(-8px) rotate(5deg); }
    }
    
    .ai-welcome-overlay {
        position: fixed !important;
        top: 0 !important;
        left: 0 !important;
        right: 0 !important;
        bottom: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        background: rgba(20, 15, 10, 0.7) !important;
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        z-index: 999998 !important;
        animation: ai-modal-fade-in 0.25s ease-out forwards;
    }
    
    .ai-welcome-modal {
        position: fixed !important;
        top: 50% !important;
        left: 50% !important;
        transform: translate(-50%, -50%) !important;
        width: 94%;
        max-width: 780px;
        max-height: 90vh;
        overflow-y: auto;
        background: linear-gradient(180deg, #FFFCF8 0%, #FFF9F2 100%);
        border-radius: 20px;
        padding: 36px 48px;
        z-index: 999999 !important;
        box-shadow: 0 25px 60px rgba(60, 40, 20, 0.3);
        animation: ai-modal-slide-up 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        color: #3D2E1F;
        text-align: center;
    }
    
    .ai-welcome-image {
        width: calc(100% + 96px);
        height: 160px;
        margin: -36px -48px 20px -48px;
        overflow: hidden;
    }
    
    .ai-welcome-image img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        object-position: center 30%;
    }
    
    .ai-welcome-title {
        font-size: 26px;
        font-weight: 700;
        margin-bottom: 12px;
        color: #2D2016;
        letter-spacing: -0.02em;
    }
    
    .ai-welcome-subtitle {
        font-size: 12px;
        color: #96640F;
        text-transform: uppercase;
        letter-spacing: 2px;
        font-weight: 600;
        margin-bottom: 16px;
    }
    
    .ai-welcome-text {
        font-size: 15px;
        line-height: 1.7;
        color: #5C4A3A;
        margin-bottom: 20px;
        max-width: 600px;
        margin-left: auto;
        margin-right: auto;
    }
    
    .ai-welcome-text strong {
        color: #96640F;
        font-weight: 600;
    }
    
    .ai-welcome-features {
        display: flex;
        justify-content: center;
        gap: 20px;
        margin-bottom: 24px;
        flex-wrap: wrap;
    }
    
    .ai-welcome-feature {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        color: #6B5344;
        background: rgba(150, 100, 15, 0.08);
        padding: 8px 14px;
        border-radius: 20px;
    }
    
    .ai-welcome-feature-icon {
        font-size: 16px;
    }
    
    .ai-welcome-close {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: #96640F;
        color: #FFFFFF;
        border: none;
        padding: 14px 48px;
        font-size: 15px;
        font-weight: 600;
        border-radius: 10px;
        cursor: pointer;
        transition: all 0.2s ease;
    }
    
    .ai-welcome-close:hover {
        background: #7D5410;
        transform: translateY(-2px);
        box-shadow: 0 6px 20px rgba(150, 100, 15, 0.35);
    }
    
    .ai-welcome-close:active {
        transform: translateY(0);
    }
    
    @media (max-width: 700px) {
        .ai-welcome-modal {
            padding: 28px 24px;
            max-width: 380px;
        }
        
        .ai-welcome-image {
            width: calc(100% + 48px);
            height: 120px;
            margin: -28px -24px 16px -24px;
        }
        
        .ai-welcome-title {
            font-size: 22px;
        }
        
        .ai-welcome-text {
            font-size: 14px;
        }
        
        .ai-welcome-features {
            gap: 10px;
        }
        
        .ai-welcome-feature {
            padding: 6px 12px;
            font-size: 12px;
        }
        
        .ai-welcome-close {
            padding: 12px 36px;
            font-size: 14px;
        }
    }
    
    /* ===================== */
    /* Landing Page 个性化 */
    /* ===================== */
    
    .ai-lp-hidden {
        display: none !important;
    }
    
    /* Grid 2-column layout override */
    .ai-lp-grid-2col {
        grid-template-columns: repeat(2, 1fr) !important;
    }
    
    @media (max-width: 749px) {
        .ai-lp-grid-2col {
            grid-template-columns: repeat(1, 1fr) !important;
        }
    }
    
    /* Image-with-text flip */
    .ai-lp-iwt-flip .image-with-text,
    .ai-lp-iwt-flip .image-with-text__grid,
    .ai-lp-iwt-flip > .grid,
    .ai-lp-iwt-flip > div > .grid {
        direction: rtl;
    }
    .ai-lp-iwt-flip .image-with-text > *,
    .ai-lp-iwt-flip .image-with-text__grid > *,
    .ai-lp-iwt-flip > .grid > *,
    .ai-lp-iwt-flip > div > .grid > * {
        direction: ltr;
    }
    
    /* Vibe Bar */
    .ai-lp-vibe-bar {
        width: 100%;
        padding: 14px 24px;
        background: linear-gradient(135deg, #FFF8F0 0%, #FFF3E6 50%, #FFF0DB 100%);
        border-bottom: 1px solid rgba(150, 100, 15, 0.12);
        text-align: center;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        box-sizing: border-box;
    }
    
    .ai-lp-vibe-bar__icon {
        font-size: 22px;
        line-height: 1;
    }
    
    .ai-lp-vibe-bar__text {
        font-size: 15px;
        font-weight: 600;
        color: #5C3D0E;
        letter-spacing: 0.02em;
    }
    
    /* Trust Block */
    .ai-lp-trust-block {
        width: 100%;
        padding: 32px 24px;
        background: #FAFAF8;
        border-top: 1px solid #F0EDE8;
        border-bottom: 1px solid #F0EDE8;
        display: flex;
        justify-content: center;
        gap: 40px;
        flex-wrap: wrap;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        box-sizing: border-box;
    }
    
    .ai-lp-trust-item {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        min-width: 120px;
    }
    
    .ai-lp-trust-item__icon {
        font-size: 28px;
        line-height: 1;
    }
    
    .ai-lp-trust-item__text {
        font-size: 13px;
        font-weight: 600;
        color: #5C4A3A;
        text-align: center;
    }
    
    @media (max-width: 749px) {
        .ai-lp-trust-block {
            gap: 24px;
            padding: 24px 16px;
        }
        .ai-lp-trust-item__icon {
            font-size: 24px;
        }
        .ai-lp-trust-item__text {
            font-size: 12px;
        }
        .ai-lp-vibe-bar__text {
            font-size: 13px;
        }
    }
`;
    document.head.appendChild(style);

    // =====================
    // Welcome Modal
    // =====================

    const MODAL_SHOWN_KEY = 'ai_visual_modal_shown';

    function shouldShowWelcomeModal() {
        if (!CONFIG.showWelcomeModal) return false;
        if (sessionStorage.getItem(MODAL_SHOWN_KEY)) return false;
        return true;
    }

    function showWelcomeModal() {
        if (!shouldShowWelcomeModal()) {
            log('Welcome modal already shown or disabled');
            return;
        }

        sessionStorage.setItem(MODAL_SHOWN_KEY, 'true');

        // Get traffic source for title
        const utm = getUtmParams();
        const sourceText = utm.utmSource
            ? utm.utmSource.charAt(0).toUpperCase() + utm.utmSource.slice(1)
            : null;

        const titleText = sourceText
            ? `Welcome from ${sourceText}!`
            : 'A Personalized Experience Awaits';

        const modalHTML = `
            <div class="ai-welcome-overlay" id="ai-welcome-overlay"></div>
            <div class="ai-welcome-modal" id="ai-welcome-modal">
                <div class="ai-welcome-image">
                    <img src="https://shopify-ai-script-production.up.railway.app/public/KWFfp1g77kxJMSnHD87aX_WNRvdBZc.png" alt="Happy pets">
                </div>
                <div class="ai-welcome-subtitle">Personalized Pet Experience</div>
                <h2 class="ai-welcome-title">${titleText}</h2>
                <p class="ai-welcome-text">
                    We're excited to show you something special! Our store uses <strong>AI-powered dynamic product imagery</strong> 
                    to create a unique shopping experience tailored just for you and your furry friends.
                    <br><br>
                    Every product photo you see is <strong>generated in real-time</strong>, matching current trends, 
                    seasonal vibes, and your browsing context. Images may take a few moments to appear — 
                    it's worth the wait!
                </p>
                <div class="ai-welcome-features">
                    <div class="ai-welcome-feature">
                        <span class="ai-welcome-feature-icon">✨</span>
                        <span>AI-Generated</span>
                    </div>
                    <div class="ai-welcome-feature">
                        <span class="ai-welcome-feature-icon">🎯</span>
                        <span>Personalized</span>
                    </div>
                    <div class="ai-welcome-feature">
                        <span class="ai-welcome-feature-icon">🐾</span>
                        <span>Pet-Focused</span>
                    </div>
                </div>
                <button class="ai-welcome-close" id="ai-welcome-close">
                    Start Shopping
                </button>
            </div>
        `;

        const container = document.createElement('div');
        container.id = 'ai-welcome-container';
        container.innerHTML = modalHTML;
        document.body.appendChild(container);

        const closeModal = () => {
            const overlay = document.getElementById('ai-welcome-overlay');
            const modal = document.getElementById('ai-welcome-modal');

            if (overlay) {
                overlay.style.transition = 'opacity 0.25s ease';
                overlay.style.opacity = '0';
            }
            if (modal) {
                modal.style.transition = 'all 0.25s ease';
                modal.style.opacity = '0';
                modal.style.transform = 'translate(-50%, -48%)';
            }

            setTimeout(() => container.remove(), 250);
            log('Welcome modal closed');
        };

        document.getElementById('ai-welcome-close')?.addEventListener('click', closeModal);
        document.getElementById('ai-welcome-overlay')?.addEventListener('click', closeModal);

        const handleEsc = (e) => {
            if (e.key === 'Escape') {
                closeModal();
                document.removeEventListener('keydown', handleEsc);
            }
        };
        document.addEventListener('keydown', handleEsc);

        log('Welcome modal shown');
    }

    // =====================
    // 工具函数
    // =====================

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
                utmContent: params.get('utm_content') || undefined,
                utmTerm: params.get('utm_term') || undefined,
            };
        }

        // 调试：检查条件
        const isInternal = isInternalNavigation();
        const hasSession = hasUtmSession();
        const savedUtm = getUtmFromSession();
        log('🔍 UTM check:', { isInternal, hasSession, savedUtm, referrer: document.referrer });

        // 只有「站内跳转 + 此会话有过 UTM」时才从 sessionStorage 读取
        if (isInternal && hasSession && savedUtm) {
            log('📂 Using UTM from session (internal navigation):', savedUtm);
            return {
                utmSource: savedUtm.utmSource || undefined,
                utmMedium: savedUtm.utmMedium || undefined,
                utmCampaign: savedUtm.utmCampaign || undefined,
                utmContent: savedUtm.utmContent || undefined,
                utmTerm: savedUtm.utmTerm || undefined,
            };
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

    function getTimeContext() {
        const now = new Date();
        const hour = now.getHours();
        const month = now.getMonth();
        let timeOfDay = hour >= 5 && hour < 12 ? 'morning' : hour >= 12 && hour < 17 ? 'afternoon' : hour >= 17 && hour < 21 ? 'evening' : 'night';
        let season = month >= 2 && month <= 4 ? 'spring' : month >= 5 && month <= 7 ? 'summer' : month >= 8 && month <= 10 ? 'autumn' : 'winter';
        return { timeOfDay, season, clientTime: now.toISOString() };
    }

    function shouldProcess() {
        const utm = getUtmParams();
        const referrer = document.referrer || '';
        if (utm.utmSource || utm.utmCampaign) return true;
        return ['instagram', 'tiktok', 'facebook', 'google'].some(p => referrer.toLowerCase().includes(p));
    }

    function getProductHandleFromCard(card) {
        const link = card.querySelector('a[href*="/products/"]');
        if (!link) return null;
        const match = link.getAttribute('href')?.match(/\/products\/([^?#\/]+)/);
        return match ? match[1] : null;
    }

    function getProductHandleFromUrl() {
        const match = window.location.pathname.match(/\/products\/([^?#\/]+)/);
        return match ? match[1] : null;
    }

    function getCollectionInfo() {
        // 从 URL 获取 collection handle
        const urlMatch = window.location.pathname.match(/\/collections\/([^?#\/]+)/);
        const collectionHandle = urlMatch ? urlMatch[1] : null;

        // 从 Shopify Analytics 获取
        const shopifyCollection = window.ShopifyAnalytics?.meta?.page?.pageType === 'collection'
            ? window.ShopifyAnalytics.meta.page
            : null;

        // 从 DOM 获取 collection 标题
        const titleElement = document.querySelector('.collection-hero__title, .collection__title, h1.title, .page-header__title');
        const collectionTitle = titleElement?.textContent?.trim() || null;

        // 从 DOM 获取 collection 描述
        const descElement = document.querySelector('.collection-hero__description, .collection__description, .rte');
        const collectionDescription = descElement?.textContent?.trim()?.slice(0, 200) || null;

        // 获取页面上的产品名称列表
        const productNames = [];
        const productCards = document.querySelectorAll('.product-card-wrapper, .card-wrapper, .product-card');
        productCards.forEach(card => {
            const nameEl = card.querySelector('.card__heading, .product-card__title, .card-information__text, h3 a');
            if (nameEl) {
                const name = nameEl.textContent?.trim();
                if (name && productNames.length < 5) {  // 最多取5个
                    productNames.push(name);
                }
            }
        });

        const info = {
            handle: collectionHandle,
            title: collectionTitle || collectionHandle?.replace(/-/g, ' '),
            description: collectionDescription,
            productNames: productNames,
            productCount: productCards.length,
        };

        log('Collection info:', info);
        return info;
    }

    // =====================
    // API 请求
    // =====================

    async function generateImage(imageUrl, imageType, productName = '') {
        return generateImageWithContext(imageUrl, imageType, { productName });
    }

    async function generateImageWithContext(imageUrl, imageType, extraContext = {}) {
        const context = {
            ...getUtmParams(),
            referrer: document.referrer,
            ...getTimeContext(),
            ...extraContext,
        };
        log('Generating:', { imageUrl, imageType, context });

        try {
            const response = await fetch(`${CONFIG.apiUrl}/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imageUrl, imageType, ...context }),
            });
            const data = await response.json();
            log('Result:', data);
            return data.success ? data.imageUrl : null;
        } catch (error) {
            console.error('[AI Visual] Error:', error);
            return null;
        }
    }

    // =====================
    // 首页产品卡片处理
    // =====================

    function findProductCards() {
        // 首先尝试配置的选择器
        let cards = document.querySelectorAll(CONFIG.productCardSelector);

        if (cards.length === 0) {
            // 尝试更多通用选择器
            const fallbackSelectors = [
                // Dawn 主题
                '.product-card-wrapper',
                '.card-wrapper',
                // 其他常见主题
                '.grid-product',
                '.product-grid-item',
                '.product-index',
                '.product-block',
                '.collection-product',
                // 通用模式：包含产品链接的卡片
                '[class*="product"][class*="card"]',
                '[class*="product"][class*="item"]',
                '.grid__item a[href*="/products/"]',
                // 更宽松的匹配
                'a[href*="/products/"]',
            ];

            for (const selector of fallbackSelectors) {
                try {
                    const found = document.querySelectorAll(selector);
                    if (found.length > 0) {
                        log(`Found ${found.length} cards with fallback selector: ${selector}`);
                        // 如果是链接，找到其父容器
                        if (selector.includes('a[href')) {
                            cards = Array.from(found).map(a => {
                                // 向上找到合适的卡片容器
                                let parent = a.parentElement;
                                for (let i = 0; i < 5 && parent; i++) {
                                    if (parent.querySelector('img')) {
                                        return parent;
                                    }
                                    parent = parent.parentElement;
                                }
                                return a.parentElement;
                            });
                            // 去重
                            cards = [...new Set(cards)];
                        } else {
                            cards = found;
                        }
                        break;
                    }
                } catch (e) {
                    // 某些选择器可能无效
                }
            }
        }

        log(`Found ${cards.length} product cards`);

        // 调试：显示找到的第一个卡片的类名
        if (cards.length > 0) {
            const firstCard = cards[0];
            log('First card classes:', firstCard.className);
            log('First card tag:', firstCard.tagName);
        } else {
            log('💡 No product cards found. Check your theme\'s HTML structure.');
            log('💡 Look for elements containing product links like: a[href*="/products/"]');
        }

        return Array.from(cards);
    }

    function getCardImages(card) {
        // 尝试多种选择器找到图片（Dawn 主题优先）
        const imgSelectors = [
            '.card__media .media img',     // Dawn 主题
            '.card__media img',            // Dawn 主题备选
            '.media--hover-effect img',    // Dawn hover 效果图片
            '.product-card__image img',
            '.product-card-wrapper img',
            '.media img',
            'img[srcset]',
            'img',
        ];

        for (const selector of imgSelectors) {
            const imgs = card.querySelectorAll(selector);
            if (imgs.length > 0) {
                log(`Found ${imgs.length} images with selector: ${selector}`);
                return Array.from(imgs);
            }
        }
        return [];
    }

    function addLoadingOverlay(element) {
        const parent = element.parentElement;
        if (!parent || parent.querySelector('.ai-loading-overlay')) return null;

        const pos = getComputedStyle(parent).position;
        if (pos === 'static') parent.style.position = 'relative';

        const overlay = document.createElement('div');
        overlay.className = 'ai-loading-overlay';
        parent.appendChild(overlay);
        return overlay;
    }

    function createSecondaryImageSlot(card, primaryImg) {
        // 检查是否已有第二张图或我们创建的 wrapper
        const existingWrapper = card.querySelector('.ai-secondary-image-wrapper');
        if (existingWrapper) return existingWrapper.querySelector('img');

        const imgs = getCardImages(card);
        if (imgs.length >= 2) {
            // 已有第二张图，直接使用
            return imgs[1];
        }

        // 创建第二张图的容器
        const imgContainer = primaryImg.closest('.card__media, .product-card__image, .media') || primaryImg.parentElement;
        if (!imgContainer) return null;

        const pos = getComputedStyle(imgContainer).position;
        if (pos === 'static') imgContainer.style.position = 'relative';

        const wrapper = document.createElement('div');
        wrapper.className = 'ai-secondary-image-wrapper';

        const newImg = document.createElement('img');
        newImg.className = 'ai-generated-image';
        newImg.style.cssText = 'width: 100%; height: 100%; object-fit: cover;';
        newImg.alt = 'AI Generated';

        wrapper.appendChild(newImg);
        imgContainer.appendChild(wrapper);

        return newImg;
    }

    async function processProductCard(card, index) {
        // 跳过被个性化引擎隐藏的卡片（节省 API 调用）
        if (card.classList.contains('ai-lp-hidden')) {
            log('Skipping hidden card (personalization):', index);
            return;
        }

        const productHandle = getProductHandleFromCard(card);
        if (!productHandle) {
            log('No product handle found for card', index);
            return;
        }

        // 检查是否已处理
        if (generationState.has(productHandle)) {
            log('Already processing/processed:', productHandle);
            return;
        }

        const imgs = getCardImages(card);
        if (imgs.length === 0) {
            log('No images found in card:', productHandle);
            return;
        }

        const primaryImg = imgs[0];
        const originalSrc = primaryImg.src || primaryImg.dataset.src || primaryImg.currentSrc;

        if (!originalSrc || !originalSrc.startsWith('http')) {
            log('Invalid image src:', originalSrc);
            return;
        }

        // 获取或创建第二张图的位置
        const secondaryImg = createSecondaryImageSlot(card, primaryImg);
        if (!secondaryImg) {
            log('Could not create secondary image slot');
            return;
        }

        // 设置状态
        generationState.set(productHandle, {
            status: 'loading',
            imageUrl: null,
            targetImg: secondaryImg,
            card: card,
        });

        // 添加 loading 状态到第二张图
        const overlay = addLoadingOverlay(secondaryImg);

        // 检查 sessionStorage 缓存（包含 UTM 信息）
        const cacheKey = getUtmCacheKey(productHandle);
        const cachedUrl = getCachedUrl(cacheKey);
        if (cachedUrl) {
            log(`Using cached image for: ${cacheKey}`);
            if (overlay) overlay.remove();  // 立即移除 loading
            applyImageToTarget(cachedUrl, secondaryImg, null, productHandle, true);  // skipAnimation = true
            generationState.set(productHandle, { status: 'done', imageUrl: cachedUrl });
            return;
        }

        log(`Starting generation for: ${productHandle} (cache key: ${cacheKey})`);

        try {
            // 使用第一张图（清晰裸图）作为素材
            const newUrl = await generateImage(originalSrc, 'product', productHandle);

            if (newUrl) {
                // 保存到内存和 sessionStorage（使用包含 UTM 的 key）
                generationState.set(productHandle, {
                    status: 'done',
                    imageUrl: newUrl,
                    targetImg: secondaryImg,
                });
                setSessionCache(cacheKey, newUrl);

                applyImageToTarget(newUrl, secondaryImg, overlay, productHandle);
            } else {
                if (overlay) overlay.remove();
                generationState.set(productHandle, { status: 'error' });
            }
        } catch (error) {
            if (overlay) overlay.remove();
            generationState.set(productHandle, { status: 'error' });
            log('Error:', error);
        }
    }

    function applyImageToTarget(newUrl, targetImg, overlay, logName, skipAnimation = false) {
        log(`Attempting to apply image to ${logName}...`);
        log(`Target img element:`, targetImg);
        log(`New URL:`, newUrl);

        if (!targetImg) {
            log(`❌ Target image element is null/undefined for ${logName}`);
            if (overlay) overlay.remove();
            return;
        }

        const preload = new Image();
        preload.crossOrigin = 'anonymous';  // 尝试处理 CORS

        preload.onload = () => {
            log(`✅ Image preloaded successfully for ${logName}`);
            if (overlay) overlay.remove();

            // 清除可能存在的 srcset
            targetImg.removeAttribute('srcset');
            targetImg.removeAttribute('data-srcset');

            // 清除 picture source
            const picture = targetImg.closest('picture');
            if (picture) {
                picture.querySelectorAll('source').forEach(s => s.remove());
                log(`Removed picture sources`);
            }

            // 设置新图片
            const oldSrc = targetImg.src;
            targetImg.src = newUrl;
            log(`Image src changed: ${oldSrc?.slice(0, 40)}... → ${newUrl.slice(0, 40)}...`);

            // 缓存命中时不显示动画
            if (!skipAnimation) {
                targetImg.classList.add('ai-reveal');
            }

            // 显示 wrapper（如果是我们创建的）
            const wrapper = targetImg.closest('.ai-secondary-image-wrapper');
            if (wrapper) {
                wrapper.style.opacity = '0'; // hover 时才显示
                log(`Set wrapper opacity to 0 (hover to show)`);
            }

            log(`✅ Applied image for ${logName}`);
        };

        preload.onerror = (e) => {
            if (overlay) overlay.remove();
            log(`❌ Failed to load generated image for ${logName}`);
            log(`Error event:`, e);
            log(`Attempted URL:`, newUrl);

            // 尝试直接设置（不预加载）
            log(`Attempting direct src set without preload...`);
            targetImg.src = newUrl;
        };

        preload.src = newUrl;
    }

    async function processAllProductCards() {
        const cards = findProductCards();
        if (cards.length === 0) {
            log('No product cards found on page');
            return;
        }

        log(`Processing ${cards.length} product cards...`);

        // 并行处理，但限制并发数
        const chunks = [];
        for (let i = 0; i < cards.length; i += CONFIG.maxConcurrent) {
            chunks.push(cards.slice(i, i + CONFIG.maxConcurrent));
        }

        for (const chunk of chunks) {
            await Promise.all(chunk.map((card, i) => processProductCard(card, i)));
        }

        log('All product cards processed');
    }

    // =====================
    // Banner/Hero Image 处理
    // =====================

    async function processBannerImages() {
        const banners = document.querySelectorAll(CONFIG.bannerSelector);
        if (banners.length === 0) {
            log('No banner images found');
            return;
        }

        log(`Found ${banners.length} banner images`);

        // Banner 通常只有 1-2 个，全部并行处理
        await Promise.all(Array.from(banners).map((img, index) => processBannerImage(img, index)));
    }

    async function processBannerImage(img, index) {
        if (img.dataset.aiProcessed) return;
        img.dataset.aiProcessed = 'true';

        const originalSrc = img.src || img.dataset.src || img.currentSrc;
        if (!originalSrc?.startsWith('http')) return;

        // 缓存 Key 包含 UTM 信息
        const baseCacheKey = `banner_${index}_${originalSrc.slice(-50)}`;
        const cacheKey = getUtmCacheKey(baseCacheKey);

        // 检查缓存
        const cachedUrl = getCachedUrl(cacheKey);
        if (cachedUrl) {
            log(`Using cached banner image ${index} (${cacheKey})`);
            applyBannerImage(img, cachedUrl, true);  // skipAnimation = true
            return;
        }

        const overlay = addLoadingOverlay(img);
        log(`Processing banner ${index} (cache key: ${cacheKey})...`);

        try {
            const newUrl = await generateImage(originalSrc, 'banner', `banner_${index}`);

            if (newUrl) {
                setSessionCache(cacheKey, newUrl);  // 使用包含 UTM 的 key
                if (overlay) overlay.remove();
                applyBannerImage(img, newUrl);
                log(`✅ Banner ${index} updated`);
            } else {
                if (overlay) overlay.remove();
            }
        } catch (error) {
            if (overlay) overlay.remove();
            log('Banner error:', error);
        }
    }

    function applyBannerImage(img, newUrl, skipAnimation = false) {
        log(`Applying banner image...`);

        const preload = new Image();
        preload.crossOrigin = 'anonymous';

        preload.onload = () => {
            log(`✅ Banner image preloaded`);
            img.removeAttribute('srcset');
            img.removeAttribute('data-srcset');

            const picture = img.closest('picture');
            if (picture) {
                picture.querySelectorAll('source').forEach(s => s.remove());
            }

            if (!skipAnimation) {
                img.classList.add('ai-reveal');
            }
            img.src = newUrl;
            log(`✅ Banner image applied`);
        };

        preload.onerror = (e) => {
            log(`❌ Banner image preload failed, trying direct set...`);
            img.src = newUrl;
        };

        preload.src = newUrl;
    }

    // =====================
    // Collection Image 处理
    // =====================

    async function processCollectionImages() {
        const collectionImgs = document.querySelectorAll(CONFIG.collectionImageSelector);
        if (collectionImgs.length === 0) {
            log('No collection images found');
            return;
        }

        log(`Found ${collectionImgs.length} collection images`);

        // 获取 Collection 信息
        const collectionInfo = getCollectionInfo();

        await Promise.all(Array.from(collectionImgs).map((img, index) =>
            processCollectionImage(img, index, collectionInfo)
        ));
    }

    async function processCollectionImage(img, index, collectionInfo) {
        if (img.dataset.aiProcessed) return;
        img.dataset.aiProcessed = 'true';

        const originalSrc = img.src || img.dataset.src || img.currentSrc;
        if (!originalSrc?.startsWith('http')) return;

        const baseCacheKey = `collection_${collectionInfo.handle || index}_${originalSrc.slice(-30)}`;
        const cacheKey = getUtmCacheKey(baseCacheKey);

        // 检查缓存
        const cachedUrl = getCachedUrl(cacheKey);
        if (cachedUrl) {
            log(`Using cached collection image ${index}`);
            applyGenericImage(img, cachedUrl, true);
            return;
        }

        const overlay = addLoadingOverlay(img);
        log(`Processing collection ${index} with info:`, collectionInfo);

        try {
            // 传递 collection 信息给 API
            const newUrl = await generateImageWithContext(originalSrc, 'collection', {
                collectionTitle: collectionInfo.title,
                collectionDescription: collectionInfo.description,
                productNames: collectionInfo.productNames,
                productCount: collectionInfo.productCount,
            });

            if (newUrl) {
                setSessionCache(cacheKey, newUrl);
                if (overlay) overlay.remove();
                applyGenericImage(img, newUrl);
                log(`✅ Collection ${index} updated`);
            } else {
                if (overlay) overlay.remove();
            }
        } catch (error) {
            if (overlay) overlay.remove();
            log('Collection error:', error);
        }
    }

    // =====================
    // Image with Text 处理
    // =====================

    async function processImageWithTextImages() {
        const images = document.querySelectorAll(CONFIG.imageWithTextSelector);
        if (images.length === 0) {
            log('No image-with-text images found');
            return;
        }

        log(`Found ${images.length} image-with-text images`);
        await Promise.all(Array.from(images).map((img, index) => processGenericImage(img, 'imageWithText', index)));
    }

    // =====================
    // 通用图片处理（Collection, Image with Text 等）
    // =====================

    async function processGenericImage(img, type, index) {
        if (img.dataset.aiProcessed) return;
        img.dataset.aiProcessed = 'true';

        const originalSrc = img.src || img.dataset.src || img.currentSrc;
        if (!originalSrc?.startsWith('http')) return;

        const baseCacheKey = `${type}_${index}_${originalSrc.slice(-50)}`;
        const cacheKey = getUtmCacheKey(baseCacheKey);

        // 检查缓存
        const cachedUrl = getCachedUrl(cacheKey);
        if (cachedUrl) {
            log(`Using cached ${type} image ${index}`);
            applyGenericImage(img, cachedUrl, true);
            return;
        }

        const overlay = addLoadingOverlay(img);
        log(`Processing ${type} ${index} (cache key: ${cacheKey})...`);

        try {
            const newUrl = await generateImage(originalSrc, 'banner', `${type}_${index}`);

            if (newUrl) {
                setSessionCache(cacheKey, newUrl);
                if (overlay) overlay.remove();
                applyGenericImage(img, newUrl);
                log(`✅ ${type} ${index} updated`);
            } else {
                if (overlay) overlay.remove();
            }
        } catch (error) {
            if (overlay) overlay.remove();
            log(`${type} error:`, error);
        }
    }

    function applyGenericImage(img, newUrl, skipAnimation = false) {
        const preload = new Image();
        preload.crossOrigin = 'anonymous';

        preload.onload = () => {
            img.removeAttribute('srcset');
            img.removeAttribute('data-srcset');

            const picture = img.closest('picture');
            if (picture) {
                picture.querySelectorAll('source').forEach(s => s.remove());
            }

            if (!skipAnimation) {
                img.classList.add('ai-reveal');
            }
            img.src = newUrl;
        };

        preload.onerror = () => {
            img.src = newUrl;
        };

        preload.src = newUrl;
    }

    // =====================
    // 产品详情页处理
    // =====================

    function findProductDetailImages() {
        // 尝试多种容器选择器（Dawn 主题优先）
        const containerSelectors = [
            '.product__media-list',           // Dawn 主题
            '.product__media-wrapper',        // Dawn 主题
            'media-gallery',                  // Dawn custom element
            'slider-component',               // Dawn slider
            '.product__media-gallery',
            '.product-gallery',
            '.product__images',
            '.product-images',
            '[data-product-media-container]',
            '.product-single__media-wrapper',
            CONFIG.productMediaContainerSelector,
        ];

        let container = null;
        for (const selector of containerSelectors) {
            container = document.querySelector(selector);
            if (container) {
                log('Found product media container:', selector);
                break;
            }
        }

        if (!container) {
            // 最后尝试：找包含多个产品图片的容器
            const allProductImgs = document.querySelectorAll('[class*="product"] img, [data-product] img');
            log('Fallback: found', allProductImgs.length, 'product images');
            if (allProductImgs.length >= 2) {
                return {
                    primary: allProductImgs[0],
                    secondary: allProductImgs[1],
                };
            }
            log('No product media container found');
            return { primary: null, secondary: null };
        }

        // 尝试多种媒体项选择器
        const mediaItemSelectors = [
            CONFIG.productMediaItemSelector,
            '.product__media-item',
            '.product-media-item',
            '.media-gallery__item',
            'li[data-media-id]',
            '.product__media > *',
        ];

        let mediaItems = [];
        for (const selector of mediaItemSelectors) {
            mediaItems = container.querySelectorAll(selector);
            if (mediaItems.length >= 2) {
                log('Found media items with:', selector, 'count:', mediaItems.length);
                break;
            }
        }

        if (mediaItems.length < 2) {
            // 直接找图片
            const allImgs = container.querySelectorAll('img');
            log('Direct image search in container, found:', allImgs.length);
            return {
                primary: allImgs[0] || null,
                secondary: allImgs[1] || null,
            };
        }

        const primaryImg = mediaItems[0]?.querySelector('img');
        const secondaryImg = mediaItems[1]?.querySelector('img');

        log('Primary img:', primaryImg?.src?.slice(0, 50));
        log('Secondary img:', secondaryImg?.src?.slice(0, 50));

        return { primary: primaryImg, secondary: secondaryImg };
    }

    async function processProductDetailPage() {
        log('Processing product detail page...');

        const productHandle = getProductHandleFromUrl();
        if (!productHandle) {
            log('❌ Could not extract product handle from URL');
            return;
        }
        log('Product handle:', productHandle);

        // 先检查内存缓存
        const existing = generationState.get(productHandle);
        if (existing?.status === 'done' && existing.imageUrl) {
            log('Using memory cached result for:', productHandle);
            applyToDetailPage(existing.imageUrl);
            return;
        }

        // 再检查 sessionStorage 缓存（跨页面持久化，包含 UTM）
        const cacheKey = getUtmCacheKey(productHandle);
        const cachedUrl = getCachedUrl(cacheKey);
        if (cachedUrl) {
            log('Using session cached result for:', cacheKey);
            applyToDetailPage(cachedUrl, true);  // skipAnimation = true
            return;
        }

        log('No cache found, searching for product images...');
        const { primary, secondary } = findProductDetailImages();

        if (!primary) {
            log('❌ No primary image found on detail page');
            log('💡 Check if productMediaContainerSelector matches your theme');
            return;
        }

        if (!secondary) {
            log('❌ No secondary image found on detail page');
            log('💡 This product may only have 1 image - need at least 2');
            return;
        }

        log('✅ Found primary and secondary images');

        const originalSrc = primary.src || primary.dataset.src || primary.currentSrc;
        if (!originalSrc?.startsWith('http')) return;

        // 添加 loading
        const overlay = addLoadingOverlay(secondary);

        log(`Processing detail page: ${productHandle}`);

        try {
            const newUrl = await generateImage(originalSrc, 'product', productHandle);

            if (newUrl) {
                // 保存到内存和 sessionStorage（使用包含 UTM 的 key）
                generationState.set(productHandle, { status: 'done', imageUrl: newUrl });
                setSessionCache(cacheKey, newUrl);

                log(`Applying to detail page secondary image...`);
                const preload = new Image();
                preload.crossOrigin = 'anonymous';

                preload.onload = () => {
                    log(`✅ Detail page image preloaded`);
                    if (overlay) overlay.remove();

                    // 清除 srcset 避免覆盖
                    secondary.removeAttribute('srcset');
                    secondary.removeAttribute('data-srcset');

                    const picture = secondary.closest('picture');
                    if (picture) {
                        picture.querySelectorAll('source').forEach(s => s.remove());
                    }

                    secondary.classList.add('ai-reveal');
                    secondary.src = newUrl;

                    log(`✅ Detail page updated for ${productHandle}`);
                };

                preload.onerror = (e) => {
                    log(`❌ Detail page image preload failed, trying direct set...`);
                    if (overlay) overlay.remove();
                    secondary.src = newUrl;
                };

                preload.src = newUrl;
            } else {
                if (overlay) overlay.remove();
            }
        } catch (error) {
            if (overlay) overlay.remove();
            log('Error on detail page:', error);
        }
    }

    function applyToDetailPage(imageUrl, skipAnimation = false) {
        const { secondary } = findProductDetailImages();
        if (!secondary) {
            log('Cannot apply to detail page: secondary image not found');
            return;
        }

        secondary.removeAttribute('srcset');
        secondary.removeAttribute('data-srcset');

        const picture = secondary.closest('picture');
        if (picture) {
            picture.querySelectorAll('source').forEach(s => s.remove());
        }

        if (!skipAnimation) {
            secondary.classList.add('ai-reveal');
        }
        secondary.src = imageUrl;
        log('Applied AI image to detail page (skipAnimation:', skipAnimation, ')');
    }

    // =====================
    // Landing Page 个性化引擎 (LLM-Driven)
    // =====================

    const LP_CACHE_KEY = 'ai_lp_layout_state';
    const LP_CACHE_TTL = 30 * 60 * 1000; // 30 分钟
    const LP_PERSONALIZATION_KEY = 'ai_lp_personalization'; // LLM 结果缓存

    // --- LLM 个性化预加载 ---

    let _personalizationPromise = null;
    let _personalizationCache = null;

    /**
     * 预加载 LLM 个性化决策
     * 在脚本加载时立即发起，与 products.json 并行
     */
    function preloadPersonalization() {
        var utm = getUtmParams();
        if (!utm.utmSource && !utm.utmCampaign && !utm.utmContent) {
            return Promise.resolve(null);
        }

        // 先检查 sessionStorage（SPA 导航缓存）
        var fingerprint = getUtmFingerprint();
        try {
            var stored = sessionStorage.getItem(LP_PERSONALIZATION_KEY);
            if (stored) {
                var parsed = JSON.parse(stored);
                if (parsed.fingerprint === fingerprint && Date.now() - parsed.timestamp < LP_CACHE_TTL) {
                    _personalizationCache = parsed.config;
                    log('[AI-LP] Personalization loaded from session cache');
                    return Promise.resolve(parsed.config);
                }
            }
        } catch (e) { /* ignore */ }

        var _llmFetchStart = Date.now();
        log('[AI-LP] ⏱️ Personalization fetch started at', new Date().toISOString());

        _personalizationPromise = fetch(CONFIG.apiUrl + '/personalize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                utmSource: utm.utmSource,
                utmMedium: utm.utmMedium,
                utmCampaign: utm.utmCampaign,
                utmContent: utm.utmContent,
                utmTerm: utm.utmTerm,
            }),
        })
        .then(function (res) {
            log('[AI-LP] ⏱️ Personalization fetch response:', res.status, 'in', (Date.now() - _llmFetchStart) + 'ms');
            return res.ok ? res.json() : null;
        })
        .then(function (data) {
            var elapsed = Date.now() - _llmFetchStart;
            if (data && data.success && data.config) {
                _personalizationCache = data.config;
                try {
                    sessionStorage.setItem(LP_PERSONALIZATION_KEY, JSON.stringify({
                        fingerprint: fingerprint,
                        config: data.config,
                        timestamp: Date.now(),
                    }));
                } catch (e) { /* ignore */ }
                log('[AI-LP] ⏱️ LLM personalization loaded in', elapsed + 'ms', data.cached ? '(server-cached)' : '(fresh)', 'serverTime:', data.processingTime + 'ms');
                return data.config;
            }
            log('[AI-LP] ⏱️ Personalization response invalid/empty in', elapsed + 'ms');
            return null;
        })
        .catch(function (err) {
            var elapsed = Date.now() - _llmFetchStart;
            log('[AI-LP] ⏱️ Personalization fetch FAILED in', elapsed + 'ms:', err && err.message ? err.message : err);
            return null;
        });

        return _personalizationPromise;
    }

    // 立即开始预加载
    preloadPersonalization();

    // --- 产品过滤（关键词驱动，不依赖 LLM，保持瞬时） ---

    /**
     * 从 UTM campaign/content 提取内容关键词
     */
    function extractContentIntent(campaign, content) {
        var raw = [campaign, content].filter(Boolean).join('-').toLowerCase();
        if (!raw) return [];
        var tokens = raw.split(/[-_\s.]+/).filter(function (t) { return t.length > 2; });

        var stopWords = [
            'utm', 'source', 'medium', 'campaign', 'content', 'term',
            'ad', 'ads', 'video', 'image', 'carousel', 'story', 'reel', 'post',
            'static', 'dynamic', 'feed', 'explore', 'reels',
            'v1', 'v2', 'v3', 'test', 'draft', 'final',
            'the', 'for', 'and', 'with', 'from', 'new', 'best', 'top',
            'spring', 'summer', 'fall', 'autumn', 'winter',
            'jan', 'feb', 'mar', 'apr', 'may', 'jun',
            'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
            'lovers', 'fans', 'owners', 'parents', 'people',
            'retarget', 'retargeting', 'lookalike', 'broad', 'interest',
            'sale', 'promo', 'discount', 'offer', 'deal',
        ];
        var stopSet = {};
        stopWords.forEach(function (w) { stopSet[w] = true; });

        return tokens.filter(function (t) { return !stopSet[t] && !/^\d+$/.test(t); });
    }

    /**
     * 产品过滤配置（硬编码，不等 LLM，保持瞬时）
     * 仅基于 dog/cat 关键词做白名单过滤
     */
    var FILTER_RULES = [
        { keywords: ['dog', 'puppy', 'canine', 'pup'], relevantTags: ['dog'], relevantKeywords: ['dog', 'puppy', 'pup'] },
        { keywords: ['cat', 'kitten', 'feline', 'kitty'], relevantTags: ['cat'], relevantKeywords: ['cat', 'kitten', 'kitty', 'mouse', 'mousey', 'birdy', 'fish'] },
    ];

    function getFilterAction(contentIntent) {
        for (var i = 0; i < FILTER_RULES.length; i++) {
            var rule = FILTER_RULES[i];
            var match = rule.keywords.some(function (kw) { return contentIntent.indexOf(kw) !== -1; });
            if (match) return { relevantTags: rule.relevantTags, relevantKeywords: rule.relevantKeywords };
        }
        return { relevantTags: null, relevantKeywords: null };
    }

    function isProductRelevant(handle, meta, action) {
        var relevantTags = action.relevantTags;
        var relevantKeywords = action.relevantKeywords;
        if (!relevantTags || relevantTags.length === 0) return true;

        if (meta && meta.tags && meta.tags.length > 0) {
            var tagMatch = relevantTags.some(function (rt) { return meta.tags.indexOf(rt) !== -1; });
            if (tagMatch) return true;
        }

        if (relevantKeywords && relevantKeywords.length > 0) {
            var searchStr = ((handle || '') + ' ' + (meta && meta.title ? meta.title : '')).toLowerCase();
            var kwMatch = relevantKeywords.some(function (kw) { return searchStr.indexOf(kw) !== -1; });
            if (kwMatch) return true;
        }

        if (!meta || (!meta.tags || meta.tags.length === 0)) return true;
        return false;
    }

    function filterByRelevance(cards, productMeta, action) {
        if (!action.relevantTags || action.relevantTags.length === 0) {
            return { visibleCards: cards.slice(), hiddenHandles: [] };
        }

        var relevant = [];
        var irrelevant = [];

        cards.forEach(function (card) {
            var handle = getProductHandleFromCard(card);
            var meta = handle ? productMeta[handle] : null;
            if (isProductRelevant(handle, meta, action)) {
                relevant.push({ card: card, handle: handle });
            } else {
                irrelevant.push({ card: card, handle: handle });
            }
        });

        var MIN_VISIBLE = 2;
        if (relevant.length < MIN_VISIBLE) {
            log('[AI-LP] Only', relevant.length, 'relevant products, skipping filter');
            return { visibleCards: cards.slice(), hiddenHandles: [] };
        }

        var hiddenHandles = [];
        irrelevant.forEach(function (item) {
            item.card.classList.add('ai-lp-hidden');
            var unit = getReorderableUnit(item.card);
            if (unit !== item.card) unit.classList.add('ai-lp-hidden');
            if (item.handle) hiddenHandles.push(item.handle);
        });
        relevant.forEach(function (item) {
            item.card.classList.remove('ai-lp-hidden');
            var unit = getReorderableUnit(item.card);
            if (unit !== item.card) unit.classList.remove('ai-lp-hidden');
        });

        log('[AI-LP] Filtered:', relevant.length, 'visible,', irrelevant.length, 'hidden');
        return {
            visibleCards: relevant.map(function (r) { return r.card; }),
            hiddenHandles: hiddenHandles,
        };
    }

    // --- 产品排序 ---

    function reorderByRelevance(cards, productMeta, boostTags) {
        if (!boostTags || boostTags.length === 0) return;
        if (cards.length <= 1) return;

        var scored = cards.map(function (card, originalIndex) {
            var handle = getProductHandleFromCard(card);
            var meta = handle ? productMeta[handle] : null;
            var tags = (meta && meta.tags) ? meta.tags : [];
            var score = 0;

            boostTags.forEach(function (bt, priority) {
                var matched = tags.some(function (t) {
                    return t.indexOf(bt) !== -1 || bt.indexOf(t) !== -1;
                });
                if (matched) score += (boostTags.length - priority) * 10;
            });

            return { card: card, score: score, originalIndex: originalIndex };
        });

        scored.sort(function (a, b) {
            if (a.score !== b.score) return b.score - a.score;
            return a.originalIndex - b.originalIndex;
        });

        var container = findCardsContainer(cards);
        if (!container) return;

        var units = scored.map(function (s) { return getReorderableUnit(s.card); });
        for (var i = 0; i < units.length; i++) {
            container.appendChild(units[i]);
        }
        log('[AI-LP] Reordered', scored.length, 'products by:', boostTags.join(', '));
    }

    function findCardsContainer(cards) {
        if (cards.length === 0) return null;
        var units = cards.map(function (c) { return getReorderableUnit(c); });
        var parentCounts = new Map();
        units.forEach(function (unit) {
            var parent = unit.parentElement;
            if (parent) parentCounts.set(parent, (parentCounts.get(parent) || 0) + 1);
        });
        var best = null;
        var bestCount = 0;
        parentCounts.forEach(function (count, parent) {
            if (count > bestCount) { bestCount = count; best = parent; }
        });
        return best;
    }

    function getReorderableUnit(card) {
        var current = card;
        for (var i = 0; i < 5 && current.parentElement; i++) {
            var parent = current.parentElement;
            var tag = parent.tagName.toLowerCase();
            if (tag === 'ul' || tag === 'ol' ||
                parent.classList.contains('grid') ||
                parent.classList.contains('product-grid') ||
                parent.classList.contains('collection-product-list') ||
                parent.classList.contains('product-list')) {
                return current;
            }
            current = parent;
        }
        return card.parentElement || card;
    }

    // --- 视觉组件注入 ---

    function findSectionByPattern(patterns) {
        var main = document.querySelector('#MainContent, main, [role="main"]');
        if (!main) return null;
        var sections = main.querySelectorAll('.shopify-section, section');
        for (var i = 0; i < sections.length; i++) {
            var id = (sections[i].id || '').toLowerCase();
            for (var j = 0; j < patterns.length; j++) {
                if (id.includes(patterns[j])) return sections[i];
            }
        }
        return null;
    }

    function injectVibeBar(config) {
        try {
            if (document.querySelector('[data-ai-lp-vibe-bar]')) return;
            if (!config || !config.copy || !config.copy.vibeBarText) return;

            var heroSection = findSectionByPattern(['image_banner', 'slideshow', 'hero']);
            if (!heroSection) return;

            var bar = document.createElement('div');
            bar.className = 'ai-lp-vibe-bar';
            bar.setAttribute('data-ai-lp-vibe-bar', 'true');
            bar.innerHTML = '<span class="ai-lp-vibe-bar__icon">' + (config.copy.vibeBarIcon || '🐾') + '</span>' +
                            '<span class="ai-lp-vibe-bar__text">' + config.copy.vibeBarText + '</span>';

            heroSection.parentElement.insertBefore(bar, heroSection.nextSibling);
            log('[AI-LP] ✅ Vibe Bar injected');
        } catch (err) {
            log('[AI-LP] Vibe Bar error:', err);
        }
    }

    function injectTrustBlock(config) {
        try {
            if (document.querySelector('[data-ai-lp-trust-block]')) return;
            if (!config || !config.copy || !config.copy.trustItems) return;
            if (config.visual && config.visual.intensity !== 'full') return;

            var productsSection = findSectionByPattern(['featured', 'collection']);
            // 注意排除 collection_list
            if (productsSection && (productsSection.id || '').toLowerCase().includes('collection_list')) {
                productsSection = null;
            }
            if (!productsSection) return;

            var trustIcons = ['✅', '🚚', '🌿'];
            var items = config.copy.trustItems;

            var block = document.createElement('div');
            block.className = 'ai-lp-trust-block';
            block.setAttribute('data-ai-lp-trust-block', 'true');

            for (var i = 0; i < 3 && i < items.length; i++) {
                block.innerHTML += '<div class="ai-lp-trust-item">' +
                    '<span class="ai-lp-trust-item__icon">' + trustIcons[i] + '</span>' +
                    '<span class="ai-lp-trust-item__text">' + items[i] + '</span>' +
                    '</div>';
            }

            productsSection.parentElement.insertBefore(block, productsSection.nextSibling);
            log('[AI-LP] ✅ Trust Block injected');
        } catch (err) {
            log('[AI-LP] Trust Block error:', err);
        }
    }

    function applyGridLayout(container, cols) {
        try {
            if (!container || !cols) return;
            if (cols === 2) {
                container.classList.add('ai-lp-grid-2col');
            } else {
                container.classList.remove('ai-lp-grid-2col');
            }
            log('[AI-LP] Grid layout:', cols, 'columns');
        } catch (err) {
            log('[AI-LP] Grid layout error:', err);
        }
    }

    function flipImageWithText(shouldFlip) {
        try {
            var iwtSection = findSectionByPattern(['image_with_text']);
            if (!iwtSection) return;

            if (shouldFlip) {
                iwtSection.classList.add('ai-lp-iwt-flip');
            } else {
                iwtSection.classList.remove('ai-lp-iwt-flip');
            }
            log('[AI-LP] IWT flip:', shouldFlip);
        } catch (err) {
            log('[AI-LP] IWT flip error:', err);
        }
    }

    function applyTextFromConfig(config) {
        try {
            if (!config || !config.copy) return;

            var textRules = [
                { patterns: ['image_banner', 'slideshow', 'hero'], selector: 'h2, .banner__heading, .slideshow__heading', text: config.copy.heroTitle },
                { patterns: ['featured'], selector: 'h2, .title, .collection__title', text: config.copy.featuredTitle },
                { patterns: ['image_with_text'], selector: 'h2, .image-with-text__heading', text: config.copy.iwtTitle },
                { patterns: ['image_with_text'], selector: '.image-with-text__text p, .rte p, p', text: config.copy.iwtBody },
            ];

            textRules.forEach(function (rule) {
                if (!rule.text) return;
                var section = findSectionByPattern(rule.patterns);
                if (!section) return;
                var el = section.querySelector(rule.selector);
                if (!el) return;
                if (!el.dataset.aiOriginalText) {
                    el.dataset.aiOriginalText = el.textContent;
                }
                el.textContent = rule.text;
                log('[AI-LP] Text: "' + (el.dataset.aiOriginalText || '').slice(0, 25) + '..." → "' + rule.text + '"');
            });
        } catch (err) {
            log('[AI-LP] Text personalization error:', err);
        }
    }

    /**
     * 应用所有 LLM 驱动的视觉变化（Phase 2）
     */
    function applyLLMVisualChanges(config, container) {
        if (!config) return;

        var visual = config.visual || {};
        var intensity = visual.intensity || 'none';

        if (intensity === 'none') {
            log('[AI-LP] Visual intensity: none, skipping visual changes');
            return;
        }

        // 文案个性化（light + full）
        applyTextFromConfig(config);

        // Vibe Bar（light + full）
        injectVibeBar(config);

        if (intensity === 'full') {
            // Trust Block
            injectTrustBlock(config);

            // Grid layout
            if (container && visual.gridCols) {
                applyGridLayout(container, visual.gridCols);
            }

            // IWT flip
            if (visual.flipIWT) {
                flipImageWithText(true);
            }
        }

        log('[AI-LP] ✅ Visual changes applied (intensity: ' + intensity + ')');
    }

    function cleanupInjectedElements() {
        try {
            var vibeBar = document.querySelector('[data-ai-lp-vibe-bar]');
            if (vibeBar) vibeBar.remove();
            var trustBlock = document.querySelector('[data-ai-lp-trust-block]');
            if (trustBlock) trustBlock.remove();
            var elements = document.querySelectorAll('[data-ai-original-text]');
            elements.forEach(function (el) {
                el.textContent = el.dataset.aiOriginalText;
                el.removeAttribute('data-ai-original-text');
            });
            var flipped = document.querySelectorAll('.ai-lp-iwt-flip');
            flipped.forEach(function (el) { el.classList.remove('ai-lp-iwt-flip'); });
            var gridOverrides = document.querySelectorAll('.ai-lp-grid-2col');
            gridOverrides.forEach(function (el) { el.classList.remove('ai-lp-grid-2col'); });
        } catch (err) { /* ignore */ }
    }

    // --- 布局缓存 ---

    function getUtmFingerprint() {
        var utm = getUtmParams();
        return [utm.utmSource || '', utm.utmCampaign || '', utm.utmContent || ''].join('|');
    }

    function cacheLayoutDecision(decision) {
        try {
            sessionStorage.setItem(LP_CACHE_KEY, JSON.stringify({
                productOrder: decision.productOrder,
                hiddenProducts: decision.hiddenProducts,
                utmFingerprint: decision.utmFingerprint,
                timestamp: Date.now(),
            }));
        } catch (e) {
            log('[AI-LP] Cache write failed:', e);
        }
    }

    function restoreLayoutDecision() {
        try {
            var raw = sessionStorage.getItem(LP_CACHE_KEY);
            if (!raw) return null;
            var state = JSON.parse(raw);
            if (state.utmFingerprint !== getUtmFingerprint()) {
                sessionStorage.removeItem(LP_CACHE_KEY);
                return null;
            }
            if (Date.now() - state.timestamp > LP_CACHE_TTL) {
                sessionStorage.removeItem(LP_CACHE_KEY);
                return null;
            }
            return state;
        } catch (e) { return null; }
    }

    function restoreFromCache(cards, cached) {
        if (cached.productOrder && cached.productOrder.length > 0) {
            var container = findCardsContainer(cards);
            if (container) {
                var unitMap = new Map();
                cards.forEach(function (card) {
                    var handle = getProductHandleFromCard(card);
                    if (handle) unitMap.set(handle, getReorderableUnit(card));
                });
                var placed = {};
                cached.productOrder.forEach(function (handle) {
                    var unit = unitMap.get(handle);
                    if (unit) { container.appendChild(unit); placed[handle] = true; }
                });
                cards.forEach(function (card) {
                    var handle = getProductHandleFromCard(card);
                    if (handle && !placed[handle]) container.appendChild(getReorderableUnit(card));
                });
            }
        }

        if (cached.hiddenProducts && cached.hiddenProducts.length > 0) {
            var hiddenSet = {};
            cached.hiddenProducts.forEach(function (h) { hiddenSet[h] = true; });
            cards.forEach(function (card) {
                var handle = getProductHandleFromCard(card);
                var unit = getReorderableUnit(card);
                if (handle && hiddenSet[handle]) {
                    card.classList.add('ai-lp-hidden');
                    if (unit !== card) unit.classList.add('ai-lp-hidden');
                } else {
                    card.classList.remove('ai-lp-hidden');
                    if (unit !== card) unit.classList.remove('ai-lp-hidden');
                }
            });
        }
        log('[AI-LP] Restored product layout from cache');
    }

    // --- 主入口（两阶段） ---

    async function applyLandingPersonalization() {
        try {
            var path = window.location.pathname;
            if (path !== '/' && path !== '') return;

            var allCards = findProductCards();
            var cards = allCards.filter(function (card) {
                return getProductHandleFromCard(card) !== null;
            });
            if (!cards || cards.length === 0) return;

            var container = findCardsContainer(cards);
            if (!container) {
                log('[AI-LP] No card container found, skipping');
                return;
            }

            // 幂等检查
            if (container.getAttribute('data-ai-lp-applied') === 'true') {
                log('[AI-LP] Already applied, skipping');
                return;
            }

            // 清理上一次的注入（SPA 导航后重新应用时需要）
            cleanupInjectedElements();

            var utm = getUtmParams();
            var contentIntent = extractContentIntent(utm.utmCampaign, utm.utmContent);

            // ========================================
            // Phase 1: 瞬时操作（不等 LLM）
            // ========================================

            // 1a. 等待产品元数据
            var productMeta = _productMetaCache;
            if (!productMeta) {
                productMeta = await Promise.race([
                    _productMetaPromise || Promise.resolve({}),
                    new Promise(function (resolve) { setTimeout(function () { resolve(null); }, 500); }),
                ]);
                if (!productMeta) productMeta = {};
            }

            // 1b. 产品过滤（硬编码关键词，瞬时）
            var filterAction = getFilterAction(contentIntent);
            var filterResult = filterByRelevance(cards, productMeta, filterAction);
            var visibleCards = filterResult.visibleCards;
            var hiddenHandles = filterResult.hiddenHandles;

            log('[AI-LP] Phase 1 done: filtered', visibleCards.length, 'visible,', hiddenHandles.length, 'hidden');

            // 1c. 检查布局缓存（SPA 返回时恢复排序）
            var cached = restoreLayoutDecision();
            if (cached) {
                restoreFromCache(cards, cached);
                visibleCards = cards.filter(function (c) { return !c.classList.contains('ai-lp-hidden'); });
            }

            // ========================================
            // Phase 2: LLM 驱动（异步，最多等 10s）
            // ========================================

            var _phase2Start = Date.now();
            var llmConfig = _personalizationCache;
            if (llmConfig) {
                log('[AI-LP] ⏱️ Phase 2: LLM config already in cache (0ms wait)');
            }
            if (!llmConfig) {
                log('[AI-LP] ⏱️ Phase 2: Waiting for LLM response (max 10s)...');
                llmConfig = await Promise.race([
                    _personalizationPromise || Promise.resolve(null),
                    new Promise(function (resolve) { setTimeout(function () { resolve(null); }, 10000); }),
                ]);
                log('[AI-LP] ⏱️ Phase 2: LLM wait completed in', (Date.now() - _phase2Start) + 'ms', llmConfig ? '(got config)' : '(timeout/null)');
            }

            if (llmConfig) {
                log('[AI-LP] Phase 2: LLM config available, applying...');

                // 2a. LLM 驱动的产品排序
                var sortHints = llmConfig.sortHints || [];
                if (sortHints.length > 0) {
                    reorderByRelevance(visibleCards, productMeta, sortHints);
                }

                // 2b. 视觉变化（Vibe Bar, Trust Block, Grid, IWT flip, Text）
                applyLLMVisualChanges(llmConfig, container);
            } else {
                log('[AI-LP] Phase 2: No LLM config, using fallback');

                // 降级：用 contentIntent 做基本排序
                if (contentIntent.length > 0) {
                    reorderByRelevance(visibleCards, productMeta, contentIntent);
                }
            }

            // 收集最终排序并缓存
            var orderedHandles = visibleCards.map(function (c) {
                return getProductHandleFromCard(c);
            }).filter(Boolean);

            container.setAttribute('data-ai-lp-applied', 'true');
            cacheLayoutDecision({
                productOrder: orderedHandles,
                hiddenProducts: hiddenHandles,
                utmFingerprint: getUtmFingerprint(),
            });

            log('[AI-LP] ✅ Personalization complete' +
                (llmConfig ? ' (LLM-driven)' : ' (fallback)') +
                ', visible=' + visibleCards.length +
                ', hidden=' + hiddenHandles.length);

        } catch (err) {
            log('[AI-LP] ❌ Error (graceful degradation):', err);
            if (typeof console !== 'undefined' && console.error) {
                console.error('[AI-LP] Personalization error:', err);
            }
        }
    }

    // =====================
    // 入口
    // =====================

    function init() {
        log('AI Visual v2 checking conditions...');
        log('URL:', window.location.href);
        log('Referrer:', document.referrer);
        log('UTM params:', getUtmParams());

        if (!shouldProcess()) {
            log('❌ No UTM/referrer detected, skipping AI generation');
            log('💡 Tip: Add ?utm_source=test to URL to test');
            return;
        }

        log('✅ AI Visual v2 initializing...');

        // Show welcome modal on first visit
        setTimeout(() => showWelcomeModal(), CONFIG.welcomeModalDelay);

        const isProductPage = window.location.pathname.includes('/products/');
        const isHomePage = window.location.pathname === '/' || window.location.pathname === '';
        const isCollectionPage = window.location.pathname.includes('/collections/');

        log('Page type:', { isHomePage, isCollectionPage, isProductPage });

        // 收集所有需要执行的任务
        const tasks = [];

        // 首页或集合页：处理产品卡片、Banner、Collection、Image with Text
        if (isHomePage || isCollectionPage || !isProductPage) {
            if (isHomePage) {
                // ★ 首页：先执行个性化（过滤/排序），再生成图片
                // 个性化完成后才开始 processAllProductCards，确保隐藏的卡片不浪费 API
                tasks.push(
                    applyLandingPersonalization().then(() => processAllProductCards())
                );
            } else {
                tasks.push(processAllProductCards());
            }
            tasks.push(processBannerImages());
            tasks.push(processCollectionImages());      // Collection 图片
            tasks.push(processImageWithTextImages());   // Image with Text 图片
        }

        // 产品详情页：处理详情图
        if (isProductPage) {
            tasks.push(processProductDetailPage());
        }

        // 并行执行所有任务
        Promise.all(tasks).then(() => {
            log('All processing complete');
        });
    }

    // 等待 DOM 和图片加载
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(init, 300));
    } else {
        setTimeout(init, 300);
    }

    // 监听 SPA 路由变化（Shopify 有些主题用 AJAX）
    let lastUrl = location.href;
    new MutationObserver(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            log('URL changed, re-initializing...');
            setTimeout(init, 500);
        }
    }).observe(document.body, { subtree: true, childList: true });

})();
