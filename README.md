# 课程助手

一个独立实现的轻量用户脚本，将课程队列、视频控制、题目辅助、DeepSeek 对话和定时刷新放进同一个面板。**MIT 许可，安装一个文件，无运行时外部脚本依赖。**

[安装脚本](https://raw.githubusercontent.com/CrystalXHorizon/course-assistant/main/course-assistant.user.js) · [下载发布版](https://github.com/CrystalXHorizon/course-assistant/releases/latest) · [反馈问题](https://github.com/CrystalXHorizon/course-assistant/issues)

![课程助手概览](docs/overview.png)

## 安装

1. 在浏览器中安装 [Tampermonkey](https://www.tampermonkey.net/) 或支持相同 GM 接口的脚本管理器。
2. 点击上方安装链接，按扩展提示安装。也可以新建脚本，粘贴 `course-assistant.user.js` 的完整内容并保存。
3. 打开学习通或智慧树网页，右下角出现“课程助手”。若没有出现，检查扩展的站点访问权限及用户脚本运行权限。
4. 需要 AI 功能时，在“设置”填写自己的 DeepSeek API Key，保存后测试连接。

**从旧版迁移：** 先停用原 ABC 或其他重复课程辅助、刷新脚本。这个版本使用独立存储，不读取或迁移旧脚本的密钥与设置。

## 功能

| 功能 | 当前行为 |
| --- | --- |
| 定时刷新 | 10 秒～24 小时，快捷间隔、倒计时、次数上限；正常刷新后继续，改变网址后暂停 |
| 视频控制 | 检测当前页面及可访问同源框架中的 HTML5 视频；播放、暂停、从头开始、0.5～2 倍速和当前视频循环 |
| 课程队列 | 读取平台课程列表，搜索后按点选顺序编号，一键开始学习。支持进度、暂停继续、移出待学课程、跳过和重新选课 |
| 章节与课程衔接 | 跳过显示已完成的章节，打开待学章节。只有平台目录确认所有章节完成才切到下一门。遇到未解锁或无法识别的任务会暂停 |
| 题目扫描 | 从当前页和同源框架读取单选、多选、判断和文本框，识别学习通自定义选项，按题目字体还原题干及选项 |
| 题目分析 | 单题或批量调用 DeepSeek。开启自动提交后，学习通章节测验支持整卷填入、核对及提交 |
| 题目搜索 | 按关键词过滤本次扫描到的题目 |
| AI 对话 | 官方 DeepSeek API、上下文、停止请求、清空对话；回答完成后一次显示 |
| 复制粘贴 | 可选的文本选中、复制、剪切、粘贴与右键限制解除；保留浏览器默认操作 |
| 运行记录 | 本地日志、答题记录、分别清空；错误消息不显示 API 响应正文或密钥 |
| 界面 | 八个功能页、拖动、收起、窄窗口适配、键盘焦点与停止全部 |

## 适用范围与限制

- 自动匹配 `chaoxing.com`、`xuexi365.com`、`zhihuishu.com` 及其子域名。**匹配域名不代表该平台所有页面都已适配。**
- 学习通自动提交适配章节测验页面 `/work/doHomeWorkNew`，使用页面原有按钮及提交确认窗口。遇到缺题、无法还原的字形、平台要求验证或未接受答案时，队列会暂停并显示原因。
- 题目识别基于可见的原生输入控件及 `fieldset`、`data-question`、常见 question 容器。图片题、封闭 Shadow DOM、特殊自定义选项和跨域框架可能无法识别；请使用 AI 页手工输入或自行操作。
- 跨域 iframe 和非 HTML5 播放器不受控制。速度能否生效取决于播放器。不能保证平台接受倍速或记录课程进度。
- 在队列页点击“读取课程列表”。学习通优先读取已打开的课程卡片，必要时从已登录的课程列表读取。智慧树请在在线学堂打开对应课程列表，再读取卡片上的课程入口。
- 学习通和智慧树各自保存队列。正常的课程入口跨子域可以接续，刷新也可续接。平台更换入口、登录失效、页面未加载或章节状态无法确认时，可手动打开对应课程后继续。
- 在「设置」保存自己的 DeepSeek API Key，在「题目」勾选「自动填入并提交章节测验」，然后选课并开始队列。队列会播放可识别的音视频、处理学习通章节测验，根据平台的任务点状态切换章节及课程。单独做测验时，也可以扫描后点击「分析全部」触发同一提交流程。
- 自动提交默认关闭，开关状态跨页面保存。定时刷新结束后会留在「刷新」面板显示次数。
- 刷新会丢失未保存输入，中断播放与请求。后台冻结、休眠、断网或关闭浏览器都会影响计时；不会补发积压的刷新。它不保证延长登录状态。
- AI 答案可能出错，填入后需自行核对。未明确匹配的答案会报错，不猜测选项。

## 数据与网络

- 安装文件不包含 API Key、账号、Cookie、遥测或第三方题库。
- API Key 和设置保存在脚本管理器的本地存储里；它不是系统密钥保险库。保存后立即清空密钥输入框，之后不会将已存密钥回填到网页；留空保存会保留原密钥，也可显式清除。密钥输入界面仍运行在网页中，请仅在可信页面配置。
- 用户主动使用 AI 时，输入的聊天内容或扫描题干与选项会发送到 `https://api.deepseek.com`；可能产生账户费用。其他页面内容不会自动发送。
- 连接测试只请求 `/models`；对话与题目分析请求 `/chat/completions`。密钥通过请求头发送，不进入日志或请求 URL。
- 聊天记录只保留在页面内存中。答题记录和日志在扩展本地保存，分别最多 100 和 150 条。
- 定时刷新保存在当前标签页的 `sessionStorage`。队列保存在脚本管理器的本地存储中。用户点击读取学习通课程时，脚本可能通过浏览器已有登录状态读取平台自己的课程列表，课程链接仅留在本地。
- 脚本管理器可能按自身设置请求 GitHub 上的更新文件；用户脚本运行时不加载外部 JavaScript、字体或图片。

接口参考：[DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)、[模型列表](https://api-docs.deepseek.com/api/list-models/)、[Tampermonkey 文档](https://www.tampermonkey.net/documentation.php)。默认模型可在设置中修改，也可通过“测试连接 / 获取模型”核对账户可用模型。

## 开发与验证

需要 Node.js 20 或更新版本。

```sh
npm ci
npx playwright install chromium
npm run check
```

Linux CI 安装浏览器时使用 `npx playwright install --with-deps chromium`。Windows 测试优先使用已安装的 Edge；也可通过 `PLAYWRIGHT_BROWSER_PATH` 指定浏览器。

```text
src/core.cjs         纯逻辑：定时器、答案映射和 API 请求
src/dom.cjs          页面扫描、表单填入与复制粘贴
src/course-queue.cjs 课程入口、章节识别和队列状态
src/queue-panel.js   选课、进度视图与运行控制
src/app.js           面板、视频、AI 和交互状态
src/style.css        独立样式
scripts/build.cjs   打包为单文件用户脚本
tests/              核心和真实浏览器模拟页面测试
```

`npm run build` 会更新根目录的 `course-assistant.user.js`，产物一并提交，方便直接安装。测试不连接真实学习通账号，不调用收费 API，使用合成题目、模拟播放器与模拟 GM 请求。

测试覆盖倒计时恢复、刷新限次、API 取消、答案填入、混合题型和字体还原，以及队列排序、暂停续接和切换课程。v1.1.3 另在真实章节测验的本地副本上复核了 25 道题干和 80 个选项。截图来自模拟页面。

## 功能对照

以本地 ABC DeepSeek 版的操作流程为参考，课程助手独立编写代码和界面。当前已对照实现课程列表选择、队列运行状态和章节切换，以及原生视频控制、DeepSeek 对话、题目扫描与填入、日志和刷新。旧版的在线题库和混合答题、独立助手模式、文档与电子书任务，以及各平台的专用题型和章节处理仍有差异。逐项以实际平台表现为准。

## 许可

[MIT](LICENSE) © 2026 CrystalXHorizon。安装包内含 opentype.js 及其依赖的许可证。字形指纹和测试字体样本来自 Adobe 的思源黑体 CN Normal 1.000，适用 [Apache 2.0 许可](docs/Apache-2.0.txt)。构建结果包含字形索引，可在本地还原文字。索引可用 `node scripts/index-font.cjs <ttf文件路径>` 从[指定版本的参考字体](https://github.com/PengXing/fontsub/blob/427ba55be9137687344729a09f6224baaebd003c/fonts/SourceHanSansCN-Normal.ttf)重建。
