# 资源分享与下载治理

后台“资源管理”包含全部资源、分享管理、导出与下载三个跨资源视图。单个资源详情继续提供概览、分享分析、导出下载和操作记录，用于查看链接级访问、步骤转化、来源/UTM、导出文件和下载历史。

## 下载完成口径

- 平台代理下载会记录 `requested` 并在文件读取成功后记录为 `completed`。
- S3 签名链接或 CDN 公开链接在跳转时只记录 `requested`，不会把跳转误报为下载完成。
- S3/CDN 的访问日志可以通过回传接口补充真实的 `completed` 事件。

先配置一个仅供日志处理程序使用的随机密钥：

```env
DOCFLOW_DOWNLOAD_LOG_INGEST_TOKEN=replace-with-a-long-random-secret
```

回传接口为 `POST /api/admin/resource-governance/download-events/ingest`，请求头使用 `X-DocFlow-Ingest-Token`：

```json
{
  "external_id": "cdn-log-unique-id",
  "export_job_id": "DocFlow 导出任务 ID",
  "source": "cdn",
  "status": "completed",
  "bytes_transferred": 1048576,
  "ip_address": "203.0.113.10",
  "user_agent": "Mozilla/5.0 ...",
  "referrer": "https://example.com/page",
  "country": "CN",
  "metadata": {"provider": "cloudfront"}
}
```

`external_id` 必须对应一条外部访问日志且全局唯一。重复回传是幂等的，不会重复增加下载次数。建议日志处理程序使用对象存储事件 ID、CDN request ID，或“日志文件 + 行号”的稳定哈希。
