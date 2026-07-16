# DocFlow 浏览器扩展发布指南

本文档说明如何生成 DocFlow Recorder 的正式安装包，并发布到 Chrome Web Store 和 Microsoft Edge Add-ons。开发环境的构建与加载方式见 [README.md](README.md)。

## 发布前提

- Web 和 API 已部署到外部用户可以访问的 HTTPS 地址。
- 正式环境已验证登录、扩展授权、录制、上传和编辑流程。
- 已准备公开访问的隐私政策、支持邮箱和产品网站。
- Chrome Web Store 或 Microsoft Edge Add-ons 开发者账号已完成注册。

扩展的 API 和 Web 地址会在构建时写入 JavaScript。一个商店安装包默认只能连接一个 DocFlow 服务。如果需要让不同客户连接各自的私有部署，应先实现自定义服务器地址，或者为客户单独分发安装包。

## 1. 更新版本号

每次向商店上传新版本，都必须递增 `src/manifest.json` 中的 `version`。同时更新 `package.json` 中的版本，确保 Manifest、源码和安装包文件名一致。

例如，将两个文件中的版本都更新为：

```json
"version": "0.9.1"
```

## 2. 使用正式地址构建

以下示例假设：

- API：`https://api.docflow.example.com`
- Web：`https://docflow.example.com`

在项目根目录执行：

```bash
cd extension
npm ci
npx tsc --noEmit

DOCFLOW_EXTENSION_API_URL="https://api.docflow.example.com" \
DOCFLOW_EXTENSION_WEB_URL="https://docflow.example.com" \
npm run build
```

`DOCFLOW_EXTENSION_API_URL` 和 `DOCFLOW_EXTENSION_WEB_URL` 的优先级高于项目根目录 `.env`，适合在本地发布脚本或 CI 中显式传入。

正式包不能包含 `localhost`、局域网 IP 或测试域名。构建后检查：

```bash
rg "localhost|127\.0\.0\.1|192\.168\.|10\.[0-9]+\." dist
```

正常情况下不应匹配到构建配置。如果业务内容或第三方依赖本身包含这些文本，需要人工确认匹配位置。

## 3. 本地安装验收

在 Chrome 或 Edge 的扩展管理页启用开发者模式，选择“加载已解压的扩展”，加载 `extension/dist`。

发布前至少验证：

- 能从扩展打开正式 DocFlow，并完成账号连接。
- 连接过期后能提示用户重新授权。
- HTML Cloning 和 Screenshot 两种模式均可开始、暂停、恢复和停止录制。
- 切换标签页、打开新标签页和页面跳转后仍能继续录制。
- 截图、DOM 快照和热点能够正确上传并在编辑器中打开。
- 中文和英文名称、说明及界面文本正确。
- 断开账号后本地凭证被清除。
- API 暂时不可用时有清晰的错误反馈。

可以再次运行发布检查：

```bash
npm run check:i18n
npx tsc --noEmit
```

## 4. 生成 ZIP 安装包

商店要求 ZIP 根目录直接包含 `manifest.json`，不能把 `dist` 目录本身作为 ZIP 内的第一层目录。

在 `extension` 目录执行：

```bash
rm -f docflow-extension-v0.9.1.zip

(
  cd dist
  zip -r ../docflow-extension-v0.9.1.zip .
)

unzip -l docflow-extension-v0.9.1.zip
```

检查压缩包中至少包含：

```text
manifest.json
background.js
content.js
popup.html
popup.js
popup.css
icons/
_locales/
```

不要上传源码目录、`node_modules`、项目根目录或包含开发配置的旧 `dist`。

## 5. 权限与审核说明

当前扩展使用 Manifest V3，并申请以下权限：

| 权限 | 用途 |
| --- | --- |
| `storage` | 保存账号连接信息、录制偏好和教程状态 |
| `activeTab` | 操作用户当前选择的录制页面 |
| `tabs` | 获取当前页面、管理跨标签页录制和打开编辑器 |
| `webNavigation` | 跟踪录制期间创建的新页面和页面跳转 |
| `scripting` | 为已打开但尚未加载录制脚本的页面补充注入脚本 |
| `<all_urls>` | 在用户选择的任意网站录制操作，并读取录制所需的页面资源 |

`<all_urls>`、`tabs` 和脚本注入属于敏感能力，可能触发更严格的人工审核。商店说明应强调：

- 扩展的单一用途是把用户主动选择的网页操作录制为 DocFlow 交互文档。
- 截图和 DOM 快照只在用户主动开始录制后采集。
- 广泛站点访问是录制任意业务系统所必需的，不用于广告、跟踪或出售数据。
- 所有权限都应和代码中的实际功能对应；发布前应定期检查是否可以删除不再使用的权限。

如果功能验证允许，可以将 `host_permissions` 和 content script 的匹配范围收紧为 HTTP/HTTPS：

```json
["http://*/*", "https://*/*"]
```

修改权限后必须重新验证跨标签页录制以及跨域图片、字体和样式资源的抓取。

## 6. 隐私政策与数据申报

扩展可能处理以下数据：

- 页面 URL、标题和用户选择的点击目标。
- 网页截图、经过清洗的 DOM、CSS 和页面资源。
- DocFlow 登录令牌与账号连接状态。
- 用户主动填写或编辑的演示内容。
- 开启 AI 时，为生成演示文案而提交的录制内容或脱敏缩略图。

隐私政策和商店后台的数据使用申报必须与代码行为一致，并至少说明：

- 收集的数据类型、处理目的和触发条件。
- 数据发送到哪个 DocFlow 服务，以及是否交给第三方 AI 服务。
- 数据的保存期限、安全措施和删除方式。
- 数据是否用于广告、分析或出售。
- 用户如何注销、删除录制数据和联系维护方。

隐私政策应部署在公开 HTTPS 页面，例如：

```text
https://docflow.example.com/privacy
```

不要为了减少商店申报而遗漏实际处理的数据类型；申报不一致通常比申请敏感权限更容易导致拒审或下架。

## 7. 商店素材

发布前准备：

- 扩展名称、短描述和详细介绍的中英文版本。
- `128×128` 扩展图标；项目中已有对应图标，但发布前应确认其为正式品牌素材。
- 展示账号连接、录制和编辑结果的真实截图，建议使用 `1280×800`。
- 产品网站、隐私政策 URL 和支持邮箱。
- 权限用途说明和数据使用声明。
- 可供审核人员使用的测试账号或清晰的免账号体验说明；不要在公开描述中暴露密码。

具体图片规格和必填字段可能随商店政策变化，提交时以商店后台显示的最新要求为准。

## 8. 发布到 Chrome Web Store

1. 登录 Chrome Web Store Developer Dashboard。
2. 创建新扩展并上传生成的 ZIP。
3. 填写商店详情、分类、语言、截图、网站和支持信息。
4. 在 Privacy Practices 中如实填写数据类型和用途。
5. 为敏感权限逐项提供与本指南一致的用途说明。
6. 建议先用非公开或受限可见性完成内部测试。
7. 确认正式域名、账号连接和录制链路后，再提交公开审核。

商店会管理安装与自动更新，不需要在 Manifest 中手工添加商店的更新地址。

## 9. 发布到 Microsoft Edge Add-ons

Edge 基于 Chromium，通常可以复用同一个 Manifest V3 ZIP：

1. 登录 Microsoft Partner Center 的 Edge Add-ons 页面。
2. 创建扩展并上传与 Chrome 相同的 ZIP。
3. 填写商店详情、隐私政策、权限说明和测试信息。
4. 提交认证，并在通过后验证 Edge 商店安装版本。

如果 Chrome 和 Edge 使用相同代码，两个商店的版本号和发布说明应保持一致。

## 10. 后续版本发布清单

- [ ] 递增 `src/manifest.json` 和 `package.json` 版本号。
- [ ] 确认正式 API/Web HTTPS 地址。
- [ ] 执行 `npm ci`、多语言检查和 TypeScript 检查。
- [ ] 使用显式生产环境变量重新构建。
- [ ] 检查构建包中没有本地、局域网或测试地址。
- [ ] 通过解压加载完成核心功能回归。
- [ ] 确认新增功能、权限和隐私政策申报一致。
- [ ] 从 `dist` 内容生成 ZIP，并检查 ZIP 根目录。
- [ ] 先发布到测试渠道，再提交公开审核。
- [ ] 上线后从商店重新安装并执行一次完整录制。
