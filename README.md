# DocFlow

DocFlow 是一个面向内部操作文档的网页录制、交互演示和导出工具。它支持 Chrome/Edge 录制、步骤编辑、在线播放，以及 Markdown、PDF、MP4 导出。

## 快速启动

```bash
cp .env.example .env
docker compose up --build
```

- Web: http://localhost:5173
- API 文档: http://localhost:8000/docs

首次打开 Web 后注册账号。扩展构建和安装方式见 `extension/README.md`。

## 本地开发

后端需要 Python 3.12、PostgreSQL 和 Redis；前端需要 Node.js 20。完整环境变量参考 `.env.example`。

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -e '.[dev]'
alembic upgrade head
uvicorn app.main:app --reload
```

```bash
cd web
npm install
npm run dev
```

