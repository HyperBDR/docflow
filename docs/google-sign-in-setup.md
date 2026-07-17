# DocFlow Google Sign-in 配置指南

本文说明如何在 Google Cloud 中申请 OAuth 2.0 客户端，并在 DocFlow 中启用 Google 登录、自动注册和账号绑定。

## 1. 配置前准备

你需要具备：

- 一个可管理 Google Cloud 项目的 Google 账号
- DocFlow 平台管理员账号
- 已启用 HTTPS 的 DocFlow 域名
- 确认最终使用的授权回调地址

DocFlow 生产环境当前使用的回调地址是：

```text
https://docflow.oneprocloud.com/backend/api/auth/google/callback
```

回调地址必须与 Google Cloud 中填写的地址完全一致，包括协议、域名、端口、路径和末尾是否有 `/`。

> 建议为生产环境和本地开发分别创建 OAuth Client，避免测试配置、测试用户和生产密钥互相影响。

## 2. 创建或选择 Google Cloud 项目

1. 打开 [Google Cloud Console](https://console.cloud.google.com/)。
2. 点击页面顶部的项目选择器。
3. 选择现有项目，或者点击“新建项目”。
4. 输入项目名称，例如 `DocFlow Production`。
5. 选择正确的组织和结算账号（如果控制台要求），然后创建项目。
6. 确认页面顶部当前选中的就是刚才的项目。

创建 OAuth 客户端本身通常不产生费用，也不要求 DocFlow 调用额外的付费 Google API。

## 3. 配置 Google Auth Platform

在 Google Cloud Console 中搜索并进入 `Google Auth Platform`，也可以直接打开 [Google Auth Platform Overview](https://console.cloud.google.com/auth/overview)。新版控制台通常包含 Overview、Branding、Audience、Clients 和 Data Access；旧版控制台可能显示为“API 和服务 → OAuth 同意屏幕”。两者配置内容相同。

### 3.1 Branding（应用信息）

首次进入时点击“Get started”或“开始使用”，然后填写：

- App name：例如 `DocFlow`
- User support email：用户遇到授权问题时联系的邮箱
- App logo：可选
- Developer contact information：负责维护 Google 登录的邮箱

如果控制台要求填写应用域名，可使用：

```text
Application home page: https://docflow.oneprocloud.com
Authorized domain: oneprocloud.com
```

隐私政策和服务条款在内部测试阶段可能不是必填项；面向外部用户正式发布时，建议提供公开可访问的页面。

### 3.2 Audience（用户范围）

根据使用范围选择：

- Internal：仅限当前 Google Workspace 组织内的用户。适合公司内部系统，但只有 Workspace 管理组织中的账号可以登录。
- External：允许个人 Gmail、其他 Workspace 组织及外部 Google 账号登录。

如果选择 External，建议先保持 `Testing` 状态，并在 Test users 中加入实际测试人员的 Google 邮箱。未加入测试名单的用户可能看到“Access blocked”或“应用尚未完成验证”。

测试完成后，可在 Audience 页面点击“Publish app”切换为正式发布状态。DocFlow 只申请基础身份信息，一般不涉及敏感或受限权限。

### 3.3 Data Access（授权范围）

DocFlow 只使用以下 OpenID Connect 基础范围：

```text
openid
https://www.googleapis.com/auth/userinfo.email
https://www.googleapis.com/auth/userinfo.profile
```

在 Google 控制台中它们可能显示为：

- See your primary Google Account email address
- See your personal info, including any personal info you've made publicly available
- Associate you with your personal info on Google

不要额外添加 Gmail、Drive、Calendar 或其他敏感权限。DocFlow 不需要读取这些数据。

## 4. 创建 OAuth Client ID

1. 打开 Google Auth Platform 的 `Clients` 页面。
2. 点击 `Create client` 或“创建客户端”。
3. Application type 选择 `Web application`。
4. Name 填写容易识别的名称，例如 `DocFlow Production Web`。
5. 在 Authorized JavaScript origins 中填写：

   ```text
   https://docflow.oneprocloud.com
   ```

   DocFlow 当前使用后端授权码流程，不依赖浏览器直接调用 Google SDK，因此此项不是核心校验项；填写后有利于保持 Web 客户端配置完整。

6. 在 Authorized redirect URIs 中填写：

   ```text
   https://docflow.oneprocloud.com/backend/api/auth/google/callback
   ```

7. 点击 Create。
8. 保存生成的 `Client ID` 和 `Client Secret`。

Client ID 通常类似：

```text
123456789012-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com
```

Client Secret 属于敏感凭据，不要放入 Git、聊天记录、前端代码、截图或公开文档。

## 5. 在 DocFlow 后台配置

1. 使用平台管理员账号登录 DocFlow。
2. 进入“管理后台 → 系统设置”。
3. 打开“登录与注册”标签页。
4. 填写 Google Cloud 生成的 OAuth Client ID。
5. 填写 OAuth Client Secret。
6. 根据需要设置“允许 Google 用户自动注册”。
7. 根据需要填写允许的邮箱域名，例如：

   ```text
   oneprocloud.com
   ```

8. 检查页面显示的授权回调地址与 Google Cloud 中的 Authorized redirect URI 完全相同。
9. 保存配置。
10. 点击“检查连接”，确认 Google OpenID 服务可访问。
11. 最后开启 Google 登录并再次保存。

Client Secret 会使用 DocFlow 的 `DOCFLOW_SECRET_KEY` 派生密钥加密保存，保存后不会再返回浏览器。以后编辑其他配置时，Secret 留空表示保留原值。

“检查连接”只验证 Google OpenID 服务的连通性；Client ID、Secret、回调地址和用户授权是否正确，需要通过一次真实 Google 登录完成最终验证。

## 6. 注册和邮箱域名策略

### 6.1 允许自动注册

开启后，没有 DocFlow 账号的 Google 用户可以在首次登录时自动创建账号。

建议上线初期采用以下配置：

```text
Google 登录：开启
允许自动注册：关闭
允许的邮箱域名：oneprocloud.com
```

先让现有用户完成账号绑定，确认流程稳定后，再决定是否开启自动注册。

### 6.2 允许的邮箱域名

域名采用精确匹配，一行一个，也可以使用逗号分隔。例如：

```text
oneprocloud.com
example.com
```

留空表示不限制 Google 邮箱域名。为了避免任意 Gmail 用户创建内部账号，生产环境通常应配置企业邮箱域名。

域名限制同时作用于 Google 登录、绑定和自动注册。它不支持 `*.example.com` 这样的通配符。

## 7. 现有账号绑定 Google

如果 Google 邮箱与现有 DocFlow 密码账号邮箱相同，DocFlow 不会自动合并账号。这是为了防止同邮箱身份被错误接管。

现有用户应按以下步骤操作：

1. 先使用邮箱和密码登录 DocFlow。
2. 进入“个人设置 → 密码与安全”。
3. 在 Google 登录区域点击“绑定 Google”。
4. 选择与 DocFlow 登录邮箱完全相同的 Google 账号。
5. 完成 Google 授权。
6. 返回安全设置页面，确认 Google 账号已显示为“已连接”。
7. 退出 DocFlow，再使用“使用 Google 登录”验证。

如果选择了不同邮箱，会出现邮箱不一致提示，且不会建立绑定。

## 8. 新用户使用 Google 注册

新用户自动注册需要同时满足：

- Google 登录已启用
- “允许 Google 用户自动注册”已开启
- Google 邮箱已验证
- 邮箱域名在允许范围内，或者平台未设置域名限制
- Google 账号未绑定到其他 DocFlow 用户

Google 自动注册的账号不设置本地密码。Google 是其唯一登录方式，因此在没有其他登录方式前不能解除 Google 绑定。

DocFlow 不会长期保存 Google Access Token 或 Refresh Token，只保存 Google 用户标识、已验证邮箱、显示名称、头像地址和 DocFlow 自己的登录会话。

## 9. 推荐测试流程

### 场景一：现有密码账号

1. Google Auth Platform 保持 Testing 状态。
2. 将现有用户的 Google 邮箱加入 Test users。
3. DocFlow 开启 Google 登录，但关闭自动注册。
4. 使用密码登录并主动绑定 Google。
5. 退出后使用 Google 登录。
6. 检查个人设置中的绑定信息和后台审计日志。

### 场景二：新 Google 用户

1. 将新用户加入 Google Test users。
2. 在 DocFlow 开启自动注册。
3. 设置允许的邮箱域名。
4. 在无登录状态下点击“使用 Google 登录”。
5. 确认用户被创建，并拥有个人空间。
6. 确认不允许解除唯一的 Google 登录方式。

### 场景三：安全限制

建议额外验证：

- 非允许域名用户无法登录或注册
- 已停用 DocFlow 用户不能通过 Google 绕过限制
- 相同邮箱的密码账号不会被自动合并
- 不同 Google 邮箱不能绑定到当前用户
- 一个 Google 身份不能绑定到多个 DocFlow 用户

## 10. 本地开发配置

Google Web OAuth 通常要求 HTTPS，HTTP 例外主要面向 `localhost`。不要直接使用类似下面的私网 HTTP 回调：

```text
http://192.168.10.68:8001/api/auth/google/callback
```

在浏览器和 DocFlow 都运行于同一台开发电脑时，可以创建独立的开发 OAuth Client，并使用：

```text
http://localhost:8001/api/auth/google/callback
```

对应的本地 `.env` 应保持同一主机名：

```dotenv
DOCFLOW_PUBLIC_BASE_URL=http://localhost:8001
DOCFLOW_WEB_ORIGIN=http://localhost:5173
VITE_API_URL=http://localhost:8001
```

修改后重新构建前端和 API：

```bash
docker compose up -d --build --force-recreate api web
```

如果需要从其他电脑访问本地开发环境，建议使用带 HTTPS 的开发域名或安全隧道，并把最终 HTTPS 回调地址加入 Google Cloud。不要让生产域名回调到本地测试服务。

## 11. 常见问题

### `Error 400: redirect_uri_mismatch`

原因通常是 Google 收到的回调地址与 Authorized redirect URIs 不完全一致。

检查：

- 是否使用了 `https`
- 是否包含 `/backend`
- 路径是否为 `/api/auth/google/callback`
- 是否多写或少写了末尾 `/`
- 是否把 Authorized JavaScript origin 误当成 redirect URI
- 是否修改后尚未等待 Google 配置生效

生产环境正确值是：

```text
https://docflow.oneprocloud.com/backend/api/auth/google/callback
```

### `Access blocked` 或“应用未完成 Google 验证”

- 确认 Audience 当前是 Internal 还是 External
- External + Testing 状态下，把用户加入 Test users
- Internal 应用只能由对应 Google Workspace 组织内的账号使用
- 检查是否误添加了敏感权限

### DocFlow 提示“该邮箱已有账号，需要先绑定”

这是预期的安全策略。先使用密码登录，再到“个人设置 → 密码与安全”绑定 Google。

### DocFlow 提示“未开放 Google 自动注册”

该 Google 邮箱还没有 DocFlow 账号，且管理员关闭了自动注册。管理员可开启自动注册，或者先通过现有注册/邀请流程创建账号，再进行绑定。

### DocFlow 提示“邮箱域名不允许”

检查 Google 返回邮箱的 `@` 后半部分是否与后台设置完全一致。后台只填写域名，例如 `oneprocloud.com`，不要填写 `@oneprocloud.com` 或邮箱地址。

### DocFlow 提示“Google 邮箱与当前账号不一致”

绑定时选择的 Google 邮箱必须与当前 DocFlow 登录邮箱完全相同。如果 DocFlow 邮箱需要修改，应先由平台管理员修改账号邮箱，再重新绑定。

### DocFlow 提示“Google 账号已绑定到其他账号”

同一个 Google 用户只能绑定一个 DocFlow 账号。先登录原 DocFlow 账号解除绑定，或由管理员排查账号归属，不要直接修改数据库映射。

### 检查连接成功，但真实登录失败

“检查连接”不验证 Client Secret。继续检查：

- Client ID 和 Client Secret 是否来自同一个 OAuth Client
- OAuth Client 类型是否为 Web application
- 回调地址是否正确
- Google 测试用户是否配置
- Google 邮箱是否已验证
- DocFlow API 日志中是否有 `Google OAuth callback failed`

查看生产 API 日志：

```bash
docker compose -p docflow -f docker-compose.yml -f docker-compose.deploy.yml logs --tail=200 api
```

## 12. Client Secret 轮换

如果 Secret 泄露或需要定期轮换：

1. 在 Google Auth Platform → Clients 中打开 DocFlow 客户端。
2. 按 Google 控制台提供的方式重置或创建新 Secret。
3. 立即进入 DocFlow“系统设置 → 登录与注册”。
4. 输入新 Secret 并保存。
5. 完成一次真实 Google 登录测试。
6. 确认新 Secret 生效后，撤销旧 Secret（如果 Google 控制台允许并存）。

更新 DocFlow 配置时，Secret 留空会保留旧值；只有输入新值才会覆盖。

## 13. 安全检查清单

- 生产回调只使用 HTTPS
- 生产和开发使用不同 OAuth Client
- Client Secret 不进入 Git、日志和前端代码
- `DOCFLOW_SECRET_KEY` 使用稳定的强随机值并安全备份
- 只申请 `openid email profile`
- 内部平台配置企业邮箱域名限制
- 上线初期关闭自动注册，先验证现有账号绑定
- Google External Testing 阶段只添加必要测试用户
- 定期检查 DocFlow 审计日志中的 Google 登录、绑定、解绑和平台配置变更
- 用户停用或删除后，确认 Google 登录同样被阻止

完成以上配置后，DocFlow 登录页会显示 Google 登录入口，现有用户可在个人安全设置中管理绑定关系。

## 14. Google 官方参考资料

- [OAuth 2.0 for Web Server Applications](https://developers.google.com/identity/protocols/oauth2/web-server)
- [OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)
- [OAuth 2.0 Policies](https://developers.google.com/identity/protocols/oauth2/policies)
- [Google Auth Platform](https://console.cloud.google.com/auth/overview)
