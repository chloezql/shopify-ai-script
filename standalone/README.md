# AI Visual Generator

根据用户流量来源（Instagram/TikTok/Facebook）自动生成匹配风格的产品图背景。

## 快速开始

### 1. 配置环境变量

```bash
# 创建 .env 文件
cp .env.example .env

# 编辑 .env，填入 API Key
OPENAI_API_KEY=sk-xxx
FAL_KEY=xxx
```

### 2. 安装依赖

```bash
npm install
```

### 3. 启动开发服务器

```bash
npm run dev
```

服务运行在 http://localhost:3000

### 4. 测试 API

```bash
curl -X POST http://localhost:3000/api/generate \
  -H "Content-Type: application/json" \
  -d '{
    "imageUrl": "https://example.com/product.jpg",
    "utmSource": "instagram",
    "utmCampaign": "summer_sale"
  }'
```

---

## Shopify 集成

在 Shopify 主题的 `theme.liquid` 文件中，在 `</body>` 之前添加：

```html
<!-- AI Visual Generator -->
<script 
  src="https://your-domain.com/embed.js"
  data-api="https://your-domain.com/api"
  data-product-selector=".product__media img"
  data-banner-selector=".hero-banner img"
  defer>
</script>
```

### 配置选项

| 属性 | 说明 | 默认值 |
|------|------|--------|
| `data-api` | API 服务地址 | `http://localhost:3000/api` |
| `data-product-selector` | 产品图 CSS 选择器 | `.product__media img` |
| `data-banner-selector` | Banner 图 CSS 选择器 | `.hero-banner img` |
| `data-debug` | 开启调试日志 | `false` |

---

## 测试 URL

在 Shopify 商店中测试不同流量来源：

### Instagram 用户
```
https://your-shop.myshopify.com/?utm_source=instagram&utm_medium=paid&utm_campaign=summer_sale
https://your-shop.myshopify.com/products/xxx?utm_source=instagram&utm_content=story_ad
```

### TikTok 用户
```
https://your-shop.myshopify.com/?utm_source=tiktok&utm_medium=paid&utm_campaign=viral_product
https://your-shop.myshopify.com/products/xxx?utm_source=tiktok&utm_content=fyp_ad
```

### Facebook 用户
```
https://your-shop.myshopify.com/?utm_source=facebook&utm_medium=cpc&utm_campaign=retargeting
https://your-shop.myshopify.com/products/xxx?utm_source=fb&utm_content=carousel_ad
```

### Google 搜索用户
```
https://your-shop.myshopify.com/?utm_source=google&utm_medium=cpc&utm_campaign=brand_search
```

### 直接访问（无 UTM）
```
https://your-shop.myshopify.com/
```

---

## 流量来源 → 视觉风格

| 来源 | 生成风格 |
|------|----------|
| Instagram | 精致、暖色调、lifestyle 美学 |
| TikTok | 活力、霓虹、街头潮流 |
| Facebook | 温馨、家庭氛围、真实感 |
| Google | 专业、干净、产品聚焦 |
| Direct | 中性、优雅默认风格 |

---

## API 文档

### POST /api/generate

生成 AI 背景图片。

**请求体：**

```json
{
  "imageUrl": "https://...",     // 必填：原图 URL
  "imageType": "product",        // 可选：product | banner
  "utmSource": "instagram",      // 可选：UTM 来源
  "utmCampaign": "summer_sale",  // 可选：UTM 活动
  "timeOfDay": "afternoon",      // 可选：morning | afternoon | evening | night
  "season": "summer",            // 可选：spring | summer | autumn | winter
  "forceGenerate": false         // 可选：跳过缓存
}
```

**响应：**

```json
{
  "success": true,
  "imageUrl": "https://fal.ai/...",
  "prompt": "Warm cozy living room...",
  "cached": false,
  "processingTime": 3200,
  "context": {
    "trafficSource": "instagram",
    "timeOfDay": "afternoon",
    "season": "summer"
  }
}
```

### GET /api/generate/health

健康检查。

---

## 项目结构

```
standalone/
├── src/
│   ├── index.ts              # Hono 入口
│   ├── routes/
│   │   └── generate.ts       # API 路由
│   ├── services/
│   │   ├── openai.ts         # 场景提示词生成
│   │   ├── fal.ts            # 图片生成
│   │   ├── weather.ts        # 天气查询
│   │   └── cache.ts          # 内存缓存
│   ├── lib/
│   │   ├── context.ts        # 上下文处理
│   │   └── platforms.ts      # 平台风格预设
│   └── types.ts              # 类型定义
├── public/
│   ├── embed.js              # 前端嵌入脚本
│   └── demo.html             # 本地测试页
└── package.json
```

---

## 部署

### Vercel

```bash
npm i -g vercel
vercel
```

### Railway

```bash
railway up
```

### 手动部署

```bash
npm run build
npm start
```

