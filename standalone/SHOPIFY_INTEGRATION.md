# Shopify 集成指南

## 版本选择

我们提供两个版本的集成脚本：

| 版本 | 文件 | 特点 |
|------|------|------|
| **v1 (基础版)** | `embed.js` | 产品页替换第一张图 |
| **v2 (推荐)** | `theme-snippet.html` | 首页预加载 + 替换第二张图 + 并行生成 |

### v2 版本特点
- ✅ 在首页/集合页就开始预加载 AI 图片
- ✅ 使用第一张产品图（清晰裸图）作为素材
- ✅ 生成结果替换到第二张图位置（保留原始裸图）
- ✅ 支持多产品并行生成（最多 4 个同时）
- ✅ Hover 时显示 AI 生成的图片
- ✅ 产品详情页复用已生成的缓存

---

## 步骤 1：部署 API 服务

首先将服务部署到云端（Vercel/Railway 等），获取 API 地址，例如：
- `https://ai-visual.vercel.app`

## 步骤 2：编辑 theme.liquid

1. 登录 Shopify 后台
2. 进入 **Online Store** → **Themes**
3. 点击 **Actions** → **Edit code**
4. 找到 `Layout` 文件夹下的 `theme.liquid`
5. 在 `</body>` 标签之前添加以下代码：

```html
<!-- AI Visual Generator - 根据流量来源自动优化产品图 -->
{% comment %}
  配置说明：
  - data-api: 你的 API 服务地址
  - data-product-selector: 产品图片的 CSS 选择器（根据你的主题调整）
  - data-banner-selector: Banner 图片的 CSS 选择器（根据你的主题调整）
{% endcomment %}
<script 
  src="https://YOUR_DOMAIN.com/embed.js"
  data-api="https://YOUR_DOMAIN.com/api"
  data-product-selector=".product__media-item img, .product-single__photo img"
  data-banner-selector=".hero__image img, .slideshow__image img"
  defer>
</script>
```

## 步骤 3：找到正确的 CSS 选择器

不同 Shopify 主题使用不同的 CSS 类名。以下是常见主题的选择器：

### Dawn 主题（默认）
```html
data-product-selector=".product__media img"
data-banner-selector=".banner__media img"
```

### Debut 主题
```html
data-product-selector=".product-single__photo img"
data-banner-selector=".hero__image img"
```

### Brooklyn 主题
```html
data-product-selector=".product-featured-img"
data-banner-selector=".hero--medium img"
```

### 如何找到你主题的选择器？

1. 在 Shopify 商店打开产品页面
2. 右键点击产品图片 → **检查元素**
3. 找到 `<img>` 标签的父元素 class 名称
4. 组合成选择器，例如 `.parent-class img`

---

## 完整示例

假设你的服务部署在 `https://ai-visual.example.com`：

```html
</head>
<body>
  <!-- 你的主题内容 -->
  
  {{ content_for_layout }}
  
  <!-- AI Visual Generator -->
  <script 
    src="https://ai-visual.example.com/embed.js"
    data-api="https://ai-visual.example.com/api"
    data-product-selector=".product__media img"
    data-banner-selector=".hero-banner img"
    defer>
  </script>
</body>
</html>
```

---

## 使用 v2 版本（推荐）

v2 版本在首页就开始预加载 AI 图片，并替换到第二张图的位置。

1. 打开 `standalone/public/theme-snippet.html`
2. 复制 `<script>` 标签的全部内容
3. 粘贴到 Shopify 主题的 `theme.liquid` 文件中，放在 `</body>` 之前

### 配置说明

根据你的主题，可能需要调整以下选择器：

```javascript
const CONFIG = {
    apiUrl: 'https://你的域名/api',
    
    // 首页产品卡片选择器（根据主题调整）
    productCardSelector: [
        '.product-card',
        '.card--product',
        // 添加你主题的选择器...
    ].join(', '),
    
    // 产品详情页媒体容器选择器
    productMediaContainerSelector: '.product__media-list, ...',
    
    // 最大并发生成数
    maxConcurrent: 4,
};
```

### 工作流程

```
用户从 Instagram 点击广告进入首页
           ↓
检测所有产品卡片，提取第一张图 URL（清晰裸图）
           ↓
并行发起 AI 生成请求（最多 4 个同时）
           ↓
生成完成后，结果放到第二张图的位置
           ↓
用户 hover 产品卡片时，看到 AI 生成的图片
           ↓
进入产品详情页时，复用已生成的图片替换第二张图
```

---

## 验证集成

### 测试链接

用以下 URL 访问你的商店，验证不同流量来源的效果：

**Instagram 用户：**
```
https://your-shop.myshopify.com/?utm_source=instagram&utm_campaign=test
```

**TikTok 用户：**
```
https://your-shop.myshopify.com/?utm_source=tiktok&utm_campaign=test
```

**Facebook 用户：**
```
https://your-shop.myshopify.com/?utm_source=facebook&utm_campaign=test
```

### 检查控制台

1. 打开浏览器开发者工具（F12）
2. 切换到 **Console** 标签
3. 添加 `data-debug="true"` 到脚本标签
4. 刷新页面，查看 `[AI Visual]` 开头的日志

```html
<script 
  src="https://YOUR_DOMAIN.com/embed.js"
  data-api="https://YOUR_DOMAIN.com/api"
  data-product-selector=".product__media img"
  data-debug="true"
  defer>
</script>
```

---

## 工作原理

```
用户点击 Instagram 广告
         ↓
进入 Shopify 商店（URL 带有 utm_source=instagram）
         ↓
embed.js 脚本检测到 UTM 参数
         ↓
发送请求到 API：{ imageUrl, utmSource: "instagram" }
         ↓
API 生成 Instagram 风格的背景（暖色调、lifestyle）
         ↓
替换页面上的产品图
```

---

## 常见问题

### Q: 图片没有变化？

1. 检查 URL 是否包含 UTM 参数（`?utm_source=xxx`）
2. 打开控制台查看是否有错误
3. 确认 CSS 选择器是否正确

### Q: API 返回 CORS 错误？

确保 API 服务正确配置了 CORS。我们的服务默认允许所有来源。

### Q: 生成速度太慢？

首次生成需要 3-5 秒。之后相同请求会命中缓存（约 50ms）。

### Q: 主题更新后脚本消失了？

主题更新可能覆盖你的修改。建议：
1. 备份修改过的 theme.liquid
2. 更新后重新添加脚本

