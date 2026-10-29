# 小红书公开分享链接采集器

用户提供公开分享链接，需要取得正文和全部图文页时使用。默认无登录、无Cookie、只读、顺序低频；失败记录实际缺失，不绕过登录、验证码或平台限制。

在项目根目录运行：

```powershell
& ./tools/xhs-public-note-collector/collect-windows.ps1 -Url "用户提供的公开分享链接" -Out "./evidence/public-share"
```

Node.js备用入口：

```sh
node ./tools/xhs-public-note-collector/collect.js "用户提供的公开分享链接" --out ./evidence/public-share
node ./tools/xhs-public-note-collector/collect.js --help
```

两个脚本放在同一目录。Node仅使用内置模块；Windows入口还需PowerShell。核对笔记身份、正文、预计与实际图页数，逐页阅读后再标记已读；下载成功不等于已经理解内容。

输出包括原网页、note.json、fields.json、capture.json、图片、哈希与运行汇总。下载和阅读确认分别记录；只处理用户授权的链接，不做批量爬取或自动入库。媒体与互动是采集时观察，不代表使用效果。
