# V1.2 本地模拟版本

分支 feature/v1.2；完整规格见 time_map_spec.md。当前不应发布替换手机正式站点。

## 测试

```sh
npm test
node tests/time.test.js
node tests/v12.test.js
TZ=America/New_York node tests/time.test.js
TZ=America/New_York node tests/v12.test.js
```

Node测试运行器在某些环境只显示文件数，因此直接运行两个文件确认分别执行7与8项测试。

可选浏览器集成：安装开发机工具 playwright-core（不属于网页运行依赖），使用已有Chromium。先启动Agent仓库的模拟API（见其docs/mock-development.md），再在本仓库启动 `python3 -m http.server 8001 --bind 127.0.0.1`，执行 `node tests/browser-smoke.cjs`。若工具位于独立目录，可设置NODE_PATH；CHROMIUM_PATH可指定浏览器路径。测试使用临时浏览器数据，不触碰手机原数据。

## 功能与限制

区间查询/复制、北京时间计算、保留V1的V2封装、快照同步重试、独立模拟效率报告已接入。凭据仅本次页面内保留。模拟API明确标注模拟报告，不调用Notion、AI或飞书。

浏览器冒烟测试覆盖390px视口、旧数据迁移、离线复制、模拟API同步/效率、到达离开；测试禁用Service Worker以隔离热更新，不能据此宣称PWA完整离线升级或iPhone验收通过。

下一步仍有生产增量协议、旧标签页保护、备份恢复冲突交互、报告历史列表、异步轮询和真实集成适配。当前API设置仅用于本地模拟。正式API域名为timemap.rychoz.com，前端仍保持原站点来源。

V1键不被改写；V2使用独立键。导出备份包含业务数据，不含凭据。不要直接通过切回V1代码回退，新记录需要先兼容导出。所有生产数据先备份，未授权不部署。
