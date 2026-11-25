# EchoDeck（回声舱）

> **开源、本地优先（Local-First）的独立多语种精听 × 影听 × FSRS 词卡 × 端侧/云端 AI 语言学习工作台**  
> 无需搭建后端服务器，无需注册账号，安装 Android APK 或运行 Web/PWA 即可开箱畅学英语、香港粤语及多门外语。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Android%20%7C%20Web%20PWA-10b981.svg)]()
[![Version](https://img.shields.io/badge/Release-v10.5-f97316.svg)]()

---

## 核心特性

### 1. 复习舱（FSRS-4.5 智能间隔记忆）
- **原声语境卡片**：每张卡片支持原片剧照、原声切片、0.8x 慢听、单句循环、盲听模式、点词离线秒查与跟读录音对比。
- **FSRS-4.5 科学排程 + 8 秒误评撤回**：支持 4 档记忆反馈、全语种动态筛选（英/粤/日/韩/法/西/德等）与误点评分一键撤回。
- **卡片一键问 AI**：每张复习卡内置「✨ 问 AI 助教」入口，携带当前语境秒出地道例句与互动造句练习。
- **双向备份与 Anki 互通**：纯本机一键导出/恢复完整 `.echodeck.zip`（含音视频与复习进度）及标准 Anki `.tsv`。

### 2. 多语种离线词库（内置 50,327 词）
- **内置 26,287 英语词 + 24,040 粤语词（含粤拼与地道例句）**，零流量离线秒开，`useDeferredValue` 保障 5 万词检索 60fps 顺滑输入。
- 支持 **闪卡过词 / 词典检索 / 听音辨义测验 / 随身磨耳朵连播 / 造句工坊**，并可扩展自定义语种或导入外部词表。

### 3. 沉浸式影听精听工作台
- **在线影听 + 本地音视频双轨支持**：支持 HLS 流 M3U8 切片去广告过滤、顶部水印遮罩、横屏自定义沉浸全屏与锁屏防误触。
- **多模式字幕精听**：支持「纯英外挂字幕自动搜挂」「只遮中文保留原英」「盲听遮字幕帘」「拖动进度条自动校准」与 5 秒复读。
- **双向打通复习舱**：一键截帧/挖句直存复习卡并记录原片定位锚点，复习时可一键跳回原剧原秒重听。

### 4. 多对话页 ReAct AI 助教（开箱免费 + 端侧离线 + BYOK）
- **多对话工作台**：内置「🎬 追剧搜片」「🗣️ 口语实战」「📚 词卡私教」3 个常驻对话页，支持自由新建至多 10 个独立会话 + 🧠 长期学习记忆档案。
- **沉浸式母语纠错流**：按所选学习语种全外语回复；中文提问先自动转成地道目标语复述，点击任意 AI 气泡即可展开简体中文翻译，支持一键复制与随时停止响应。
- **四种 AI 引擎随心切换（零门槛开箱可用）**：
  1. **免 Key 公共免费通道（默认开箱可用）**：内置双容灾公共免费接口，安装即用无需配置。
  2. **Android 原生 ARM64 端侧离线大模型（`llama.cpp`）**：支持 `Qwen3-8B / 4B / 1.7B / 0.6B` GGUF 断点续传下载与本地直跑，完全断网可用。
  3. **智谱 GLM-4.7-Flash 永久免费主力（推荐 BYOK）**：前往 [open.bigmodel.cn](https://open.bigmodel.cn) 免费注册领取免费 Key，填入「工具 → 设置」即可畅享国内高速免费文本 + 视觉识图字幕对齐。
  4. **自有 OpenAI 兼容 API**：支持 DeepSeek、硅基流动、OpenAI、Ollama 等任意兼容端点，并提供一键「⚡ 测试 AI 连通性」耗时诊断。

### 5. 16 款多引擎 AI 真人语音试听馆
- 涵盖 Microsoft Edge 神经网络多口音真人语音（美式、英式、澳式、香港粤语等）、44.1kHz 离线棚录 Supertonic-2 音色，以及可选自定义云端 TTS（OpenAI / CosyVoice2 / FishAudio）。

### 6. 原生级移动体验与性能架构
- **Keep-Alive 懒挂载标签页 + 路由级代码拆分**：冷启动主包仅 ~404 kB，首次访问后常驻内存实现 0ms 瞬切并保留影厅进度与词库搜索态。
- **Android 硬件返回手势全栈闭环**：全屏 → 弹窗/AI 助教/查词抽屉 → 退出播放页 → 回主页 → 2 秒双击退至后台；状态栏与底部手势栏实时同步浅/深色主题；`adjustResize` 软键盘防遮挡。
- **无破图海报与崩溃自愈**：全站 `PosterImage` 防盗链与渐变封面兜底、LRU Blob ObjectURL 自动回收与全局 `AppErrorBoundary`。

---

## 快速使用

### 方式一：直接安装 Android APK（推荐）
前往本仓库 [Releases](https://github.com/tcbhls/echodeck/releases) 下载最新版 `EchoDeck-v10.5-android.apk` 直接安装到 Android 手机即可使用。

### 方式二：本地运行 Web / PWA 开发预览
```bash
git clone https://github.com/tcbhls/echodeck.git
cd echodeck/frontend
npm install
npm run dev
```

### 方式三：自行编译 Android APK
需要 Node.js 22+、JDK 21 及 Android SDK 36：
```bash
cd echodeck/frontend
npm ci
npm run build
npx cap sync android
cd android
./gradlew assembleDebug
```
> 若需自定义发布签名，可参考 `.github/workflows/build-android-apk.yml` 配置 `ANDROID_KEYSTORE_*` 环境变量或 GitHub Actions Secrets；Fork 本仓库后即使不配置任何 Secret，GitHub Actions 也会自动为你编译可安装的 Debug APK。

---

## 隐私与开源声明

- 本项目完全遵循 **MIT License** 开源，详见 [LICENSE](LICENSE)。
- 所有个人数据仅存于用户本地设备，详见 [SECURITY.md](SECURITY.md)。
- 开源仓库与官方公开构建产物不包含任何硬编码私有 API Key。
