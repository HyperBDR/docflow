# DocFlow

DocFlow 是一个面向内部操作文档的网页录制、交互演示和导出工具。浏览器扩展会同时保存页面截图和经过清洗的 DOM 快照；编辑和播放时优先还原 DOM，因此热点可以绑定真实元素，并在页面缩放或布局轻微变化后继续工作。

## 功能

- Chrome / Edge 扩展录制点击步骤、页面上下文、滚动位置和稳定选择器
- DOM 与旧版截图两种 Slide，已有演示可继续使用
- 多热点、拖拽和缩放、点击或悬停触发、下一步或跳转动作
- 提示框内容、上下左右位置、对齐、箭头、颜色、聚光灯和前后按钮主题
- 发布后的交互式在线播放
- Markdown 文本复制，以及包含页面、热点、引导卡片和导航主题的 Markdown 图片包、PDF、MP4 导出
- OpenAI 兼容接口生成演示标题、摘要、步骤标题、描述和热点提示
- 人工修改字段保护、单步骤重新生成和 AI 修改回退
- 主页面搜索和状态筛选、单选/全选、批量共享、复制副本、删除与取消共享
- 主页面使用第一个步骤截图作为资源缩略图
- 编辑器按内容、热点、引导、样式、AI、发布导出分类，并提供统一图标操作

## 快速启动

```bash
cp .env.example .env
docker compose up -d --build
```

- Web: http://localhost:5173
- API 文档: http://localhost:8001/docs
- 健康检查: http://localhost:8001/health

API 启动时会自动运行数据库迁移。首次构建 Worker 需要下载 Chromium、FFmpeg 和中文字体，镜像较大；这些依赖使用阿里云镜像并放在独立缓存层，之后修改应用代码不会重复下载。

首次打开 Web 后注册账号。扩展构建和安装方式见 [extension/README.md](extension/README.md)。升级扩展源码后，需要在浏览器扩展管理页点击“重新加载”。

## 局域网部署

如果其他电脑需要访问，请把 `.env` 中下面三个地址改成宿主机可访问的 IP 或域名，而不是 `localhost`：

```dotenv
DOCFLOW_PUBLIC_BASE_URL=http://192.168.10.68:8001
DOCFLOW_WEB_ORIGIN=http://192.168.10.68:5173
VITE_API_URL=http://192.168.10.68:8001
```

`VITE_API_URL` 会在 Web 镜像构建时写入前端；修改后需要执行：

```bash
docker compose up -d --build --force-recreate api web worker
```

## AI 配置

AI 默认关闭，不影响录制、编辑、播放和导出。要接入 OpenAI 或兼容服务，在 `.env` 中设置：

```dotenv
DOCFLOW_AI_ENABLED=true
DOCFLOW_AI_BASE_URL=https://api.openai.com/v1
DOCFLOW_AI_API_KEY=your-api-key
DOCFLOW_AI_MODEL=gpt-4.1-mini
DOCFLOW_AI_VISION_ENABLED=true
```

接口需兼容 `POST /v1/chat/completions`。HTML Cloning 录制中，每次选择元素只在上传阶段短暂锁定页面；入库后由后台 Worker 异步生成 AI 文案，用户可以立即继续录制下一步。模型接收清洗后的可见文本，以及开启视觉能力时的脱敏缩略图。AI 只自动填写未被人工修改的字段。

## DOM 快照的安全边界

DocFlow 保存的是用于文档演示的静态页面副本，不会继续运行原网页应用：

- 移除脚本、事件处理器、表单提交和外部网络资源
- 清理危险 CSS、URL 参数、Token、邮箱和电话号码
- 输入框统一遮罩，并保存截图作为失败回退
- 播放器使用隔离 iframe，还原页面外观和热点定位

因此 DOM Slide 看起来和原页面一致并可点击引导层，但不会执行业务请求，也不等同于把原系统完整嵌入 DocFlow。跨域 iframe、浏览器内部页面和高度动态的 Canvas 页面可能退化为截图。

## 常用命令

```bash
docker compose ps
docker compose logs -f api worker web
docker compose exec api alembic current
```

后端测试：

```bash
docker build -f backend/Dockerfile.test -t docflow-backend-test backend
docker run --rm docflow-backend-test pytest -q
```

前端与扩展检查：

```bash
cd web && npm ci && npm run build
cd ../extension && npm ci && npx tsc --noEmit && npm run build
```

## 本地开发

后端需要 Python 3.12、PostgreSQL 和 Redis；前端需要 Node.js 20。完整环境变量参考 `.env.example`。

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
alembic upgrade head
uvicorn app.main:app --reload
```

```bash
cd web
npm install
npm run dev
```
