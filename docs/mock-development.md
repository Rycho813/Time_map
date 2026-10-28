# V1.2 模拟阶段说明

feature/v1.2，完整规格见time_map_spec.md；不要将开发版替换手机正式站点。

## 测试

```sh
npm test
node tests/time.test.js
node tests/v12.test.js
TZ=America/New_York node tests/v12.test.js
```

直接执行确认7项旧测试、11项新增测试。某些Node环境的npm test汇总显示2个文件而非18个案例。

可选浏览器测试：在开发机安装playwright-core（非网页运行依赖），使用Chromium。启动Agent模拟API与本仓库8001静态服务后，运行 `node tests/browser-smoke.cjs`；工具独立安装时设置NODE_PATH，浏览器路径可用CHROMIUM_PATH指定。每次测试API使用新的临时数据库，避免与上一轮已上传数据冲突。

## 已实现

区间查询、离线复制、北京时间、V1保留的V2迁移、原子本地状态、增量批次重试、旧标签页保护、分页冲突恢复、凭据轮换、异步任务轮询、历史报告查看和新报告生成。

冲突恢复先触发本地JSON备份下载，再由用户明确选择采用云端或恢复本地；浏览器下载是否真正保存应由用户确认。V1原数据不会被升级写入覆盖。V2备份不含令牌；页面凭据仅当前会话保留。

报告历史默认展示最新20份，服务端支持offset/limit分页；完整历史翻页体验可在真实联调前细化。请求超过2MiB会安全拒绝，大规模首次导入分批仍需规模验收，不能称已覆盖原200000条极限。

浏览器验证390px手机视口、纽约时区、迁移、离线复制、增量同步、后台任务、报告历史、原到达离开；另外独立上下文启用Service Worker并断网重载通过。该测试使用Chromium，不代表Safari/iPhone实机验收。

真实Notion、Gemini、飞书均未调用。模拟API不可直接暴露公网；正式域名timemap.rychoz.com。前端保持原站点来源，避免主屏幕存储迁移。
