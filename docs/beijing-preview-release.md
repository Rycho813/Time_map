# 北京时间显示补丁：静态更新与回退审核

同步状态把 ISO UTC 时刻按 Asia/Shanghai 显示为带日期的北京时间，例 02:17Z → 10:17。仅改显示；ISO 存储、版本号、上传队列、原 V1 键和进行中记录不变。报告区间/历史原已使用 UTC+8，新增测试覆盖 UTC 16:00 对应次日零点、跨年和左闭右开。Service Worker 更新缓存名，不清 localStorage、不卸载 PWA。

只供用户审核后在服务器执行，本轮没有连接服务器。固定 SHA 取本次提交记录的完整前端提交，不能用浮动 feature/v1.2 代替。

```bash
# FRONTEND_SHA 必须为本次交付的完整 40 位前端提交。
FRONTEND_SHA='填写本次交付的完整前端提交'
[[ "$FRONTEND_SHA" =~ ^[0-9a-f]{40}$ ]] || exit 1
# 单独下载该提交中的操作脚本，先审阅，再执行；不切换原构建目录。
curl --fail --show-error --location "https://raw.githubusercontent.com/Rycho813/Time_map/$FRONTEND_SHA/deploy/update-preview.sh" -o /tmp/update-timemap-preview.sh
less /tmp/update-timemap-preview.sh
sudo bash /tmp/update-timemap-preview.sh "$FRONTEND_SHA"
```

脚本要求现有 `/srv/timemap-preview/current` 是指向 releases/ 内目录的链接；实际布局不同则停止核对。独立 clone 至 `/opt/timemap-preview-sources/<SHA>`，固定检出，验证静态清单后只复制 HTML/CSS/manifest/SW/assets/js，原子切换 current。已有目录拒绝覆盖；失败保留供检查，不自动删除。不会触碰 `/opt/timemap-test/current/{agent,frontend}`、image.json、Docker、Caddy 或数据库；不发布 GitHub Pages。

成功后保留 `<SHA>.previous`，立即核对静态文件及手机预览页。不要为了验收补丁清缓存/网站数据、停止原站计时或执行恢复按钮。手机实机 PWA 更新仍需用户确认；浏览器自动化不能代替它。静态回退同样需要联网刷新获取旧 SW，不能撤销已经发生的数据同步。

回退命令（同一个完整 SHA）：

```bash
sudo bash -s -- "$FRONTEND_SHA" <<'ROLLBACK'
set -euo pipefail
SHA=${1:?}
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]]
BASE=/srv/timemap-preview
PREVIOUS=$(cat "/opt/timemap-preview-sources/$SHA.previous")
[[ "$PREVIOUS" == "$BASE/releases/"* ]]
test -d "$PREVIOUS"
test "$(readlink -f "$BASE/current")" = "$BASE/releases/$SHA"
TEMP="$BASE/.rollback-$$"
trap 'rm -f "$TEMP"' EXIT
ln -s "$PREVIOUS" "$TEMP"
mv -Tf "$TEMP" "$BASE/current"
ROLLBACK
```

回退只切静态链接，不删除新版本、手机数据或服务端数据。若 current 已被其他发布改变则拒绝覆盖。
