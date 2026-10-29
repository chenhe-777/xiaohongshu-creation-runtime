# 小红书创作运行版

可分享的日常运行Skill：**总控 → 选题研究 → 统一创作方案 → 用户确认 → 视觉与平台文案**。暂不包含发布后复盘。

## 包含的部分

- [创作总控](.agents/skills/zhouyi-xhs-content-creation/SKILL.md)
- [选题研究](.agents/skills/zhouyi-xhs-topic-research/SKILL.md)
- [创作策划与内容生产](.agents/skills/zhouyi-xhs-content-production/SKILL.md)
- 必需reference、交接合同、项目配置示例和公开分享链接采集器。

不含完整方法论库、历史十三步、候选/回归材料、独立旧简报入口、商品图流程、账号数据和私人素材。复盘分支及其脚本、模板、观察记录依赖均已移除；核心研究、价值筛选、条件式论证、逐页方案、视觉及正文规则保留。

## 下载与使用

[下载运行版ZIP](https://github.com/chenhe-777/xiaohongshu-creation-runtime/archive/refs/heads/main.zip)

1. 解压，将 `.agents/skills/`、`tools/` 和 `config/` 放到自己的项目根目录。
2. 查看[项目配置示例](config/project-settings.example.md)，按任务配置自己的竞品来源和素材。本仓库不含原作者的个人库ID或本机绝对路径。
3. 在支持本地Skill的AI环境中调用 `zhouyi-xhs-content-creation`，提供选题或竞品；已有有效研究结论可调用 `zhouyi-xhs-content-production`。
4. 先审核创作方案，批准后才进入视觉与平台文案；制图、外部写入及发布根据用户授权和可用工具另行执行。

示例请求：

> 请使用小红书创作总控Skill，根据我提供的选题和竞品材料开始研究。

> 请使用内容生产Skill，把这张已确认选题卡和真实素材整理成统一创作方案，先交我审核。

## 运行环境

Skill是给AI执行的规则，不是独立客户端。需要读取本地文件、保存文件的AI环境；云端资料、图像制作和外部写入使用自己的工具与授权。本包不带凭据、运行环境或真实竞品数据。采集器需要Node.js，可选PowerShell。

默认保留原图文风格，账号、母版、Logo和截图可由项目配置覆盖。材料缺失时说明缺口，不编造样本、界面或结果。
