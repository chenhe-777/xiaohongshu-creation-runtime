# 小红书图文创作运行版

用于小红书图文创作的 Skill 工作流，将选题想法、竞品研究和真实素材转成创作方案、视觉设计与平台文案。

**总控 → 选题研究 → 统一创作方案 → 用户确认 → 视觉与平台文案**

## 包含的部分

- [创作总控](.agents/skills/zhouyi-xhs-content-creation/SKILL.md)：识别当前任务，管理流程与阶段交接。
- [选题研究](.agents/skills/zhouyi-xhs-topic-research/SKILL.md)：核验竞品与用户需求，形成研究结论和选题交接卡。
- [创作策划与内容生产](.agents/skills/zhouyi-xhs-content-production/SKILL.md)：筛选用户价值，组织逐页论证，生成视觉设计、做图提示词和平台文案。
- 配套参考规则、交接协议、项目配置示例与公开分享链接采集工具。

## 下载与使用

[下载运行版ZIP](https://github.com/chenhe-777/xiaohongshu-creation-runtime/archive/refs/heads/main.zip)

1. 解压，将 `.agents/skills/`、`tools/` 和 `config/` 放到自己的项目根目录。
2. 查看[项目配置示例](config/project-settings.example.md)，按任务配置自己的账号、竞品来源和视觉素材。
3. 在支持本地Skill的AI环境中调用 `zhouyi-xhs-content-creation`，提供选题或竞品；已有有效研究结论可调用 `zhouyi-xhs-content-production`。
4. 先审核创作方案，批准后才进入视觉与平台文案；制图、外部写入及发布根据用户授权和可用工具另行执行。

示例请求：

> 请使用小红书创作总控Skill，根据我提供的选题和竞品材料开始研究。

> 请使用内容生产Skill，把这张已确认选题卡和真实素材整理成统一创作方案，先交我审核。

## 运行环境

在支持本地 Skill、读取文件和保存文件的 AI 环境中使用。云端资料、图像制作和外部写入使用项目已授权的工具；采集器需要 Node.js，Windows 下也可使用 PowerShell 入口。

默认保留原图文风格，账号、母版、Logo和截图可由项目配置覆盖。材料缺失时说明缺口，不编造样本、界面或结果。
