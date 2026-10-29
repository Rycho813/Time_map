# GitHub 固定提交测试部署：前端说明

> 本文保留最初源码部署步骤。手机恢复问题的静态补丁与独立版本更新见 [手机同步恢复说明](phone-sync-recovery.md)，不在原后端构建目录中切换前端 HEAD。

本仓库通过 feature/v1.2 提供固定前端源码；完整服务器审核步骤在 [Time-Management-Agent 的部署说明](https://github.com/Rycho813/Time-Management-Agent/blob/feature/v1.2/docs/github-source-deployment.md)。具体批准的两个 40 位提交以当次验收记录为准，不依赖分支持续指向同一版本。

本次新增 `deploy/check-static.py`，只读检查：Git HEAD 是否等于指定提交、工作区是否干净、13 个必要静态文件及入口依赖是否存在、图标可用，以及 PWA id/scope/start_url 仍为相对路径。它输出静态文件哈希，不复制文件、不修改任何本地记录，不连接后端或第三方 API。

```bash
python3 deploy/check-static.py --expected-commit "$FRONTEND_SHA"
```

执行前将 FRONTEND_SHA 明确设为已审核的完整 SHA；短提交、错误提交、未提交文件、缺少静态依赖时都会拒绝。

当前阶段只让服务器检出和检查前端，不发布到 GitHub Pages，不拷贝到 Caddy 根目录，不修改 DNS/Caddy。原站 `https://rycho813.github.io/Time_map/` 及手机主屏幕继续使用。

后续获批后，测试前端才放到独立 `https://timemap.rychoz.com/preview/`；只复制 index.html、styles.css、manifest.webmanifest、sw.js、assets/、js/，不把整个 Git 仓库、.git、配置或文档公开。使用独立存储，先合成数据，再明确导入手机 JSON 副本，不覆盖原站本地数据。

本轮测试包括原 20 项前端用例及新增 3 项部署检查：正确版本只读清单、干净检出中的缺失资源、错误版本/未提交文件拒绝。iPhone Safari 和新域名上的 PWA 更新仍待后续实机验收。
