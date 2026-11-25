/**
 * EchoDeck v9.1 多引擎 AI 真人音色目录与配置持久化：
 * 1. 完整保留原有默认音色（edge_ava 女声 Ava/晓佳、edge_andrew 男声 Andrew/云龙）
 * 2. 新增 8 款微软新一代自然口语/多口音 Neural 音色（Emma / Brian / Aria / Sonia / Ryan / Natasha / William / 晓曼），零下载国内秒播
 * 3. 新增 6 款 GitHub 开源 44.1kHz 真人棚录端侧离线音色（Supertone Supertonic-2，F1~F3 / M1~M3），断网可用、彻底去机械感
 * 4. 支持可选自定义专业云端真人 TTS 接口（OpenAI gpt-4o-mini-tts / 硅基流动 CosyVoice2 / FishAudio 等 OpenAI 兼容端点）
 */

export type VoiceEngineKind = "edge" | "supertonic";

export interface VoicePreset {
  id: string;
  engine: VoiceEngineKind;
  gender: "female" | "male";
  flag: string;
  name: string;
  shortName: string;
  badge: string;
  desc: string;
  /** 仅用于展示当前声音来自哪套开源/云端项目 */
  sourceTag: string;
  /** 试听示例语种与句子 */
  sampleLang: string;
  sampleText: string;
  /** Supertonic-2 对应的 50KB 声纹向量文件名（如 F1 / M1） */
  supertonicVoiceCode?: "F1" | "F2" | "F3" | "F4" | "F5" | "M1" | "M2" | "M3" | "M4" | "M5";
  isOriginalDefault?: boolean;
}

export interface CustomTtsConfig {
  enabled: boolean;
  url: string;
  apiKey: string;
  model: string;
  voice: string;
}

export const EDGE_VOICE_PRESETS: VoicePreset[] = [
  {
    id: "edge_ava",
    engine: "edge",
    gender: "female",
    flag: "👩",
    name: "Ava / 晓佳（原默认女声）",
    shortName: "原女声 Ava",
    badge: "保留原音色",
    desc: "保留原有默认音色：英语 Ava 多语女声 · 粤语香港晓佳 · 日法德韩自动匹配",
    sourceTag: "Microsoft Edge Neural",
    sampleLang: "en",
    sampleText: "Let's play it by ear this weekend and see what we're in the mood for.",
    isOriginalDefault: true,
  },
  {
    id: "edge_andrew",
    engine: "edge",
    gender: "male",
    flag: "👨",
    name: "Andrew / 云龙（原默认男声）",
    shortName: "原男声 Andrew",
    badge: "保留原音色",
    desc: "保留原有默认男声：英语 Andrew 温暖男声 · 粤语香港云龙 · 日法德韩自动匹配",
    sourceTag: "Microsoft Edge Neural",
    sampleLang: "en",
    sampleText: "Honestly, catching every nuance in a movie scene takes a little practice, and you're doing great.",
    isOriginalDefault: true,
  },
  {
    id: "edge_emma",
    engine: "edge",
    gender: "female",
    flag: "🌸",
    name: "Emma · 美式自然聊天女声",
    shortName: "自然女声 Emma",
    badge: "推荐 · 更少机械感",
    desc: "新一代美式对话女声，语气轻快自然像日常聊天；粤语自动配柔和晓曼女声",
    sourceTag: "en-US-EmmaMultilingualNeural",
    sampleLang: "en",
    sampleText: "Hey! That expression actually sounds way more natural if you soften the ending a bit.",
  },
  {
    id: "edge_brian",
    engine: "edge",
    gender: "male",
    flag: "🎙️",
    name: "Brian · 美式松弛播客男声",
    shortName: "播客男声 Brian",
    badge: "推荐 · 呼吸感强",
    desc: "松弛真诚的美式播客男声，停顿与重音很像真人主播，听久不累耳",
    sourceTag: "en-US-BrianMultilingualNeural",
    sampleLang: "en",
    sampleText: "You know what's funny? Most native speakers drop half those syllables when they talk fast.",
  },
  {
    id: "edge_aria",
    engine: "edge",
    gender: "female",
    flag: "✨",
    name: "Aria · 美剧表现力女声",
    shortName: "表现力 Aria",
    badge: "情绪起伏大",
    desc: "音调起伏更丰富的美式表现力女声，适合追美剧跟读与角色对话扮演",
    sourceTag: "en-US-AriaNeural",
    sampleLang: "en",
    sampleText: "Wait a second—did she really just say that right in front of everybody?",
  },
  {
    id: "edge_sonia",
    engine: "edge",
    gender: "female",
    flag: "🇬🇧",
    name: "Sonia · 伦敦英式女声",
    shortName: "英音女声 Sonia",
    badge: "纯正英音",
    desc: "温润自然的现代英式英语女声，精听英剧与雅思听力绝配",
    sourceTag: "en-GB-SoniaNeural",
    sampleLang: "en",
    sampleText: "Brilliant! Fancy grabbing a quick cup of tea while we go over a couple of phrases?",
  },
  {
    id: "edge_ryan",
    engine: "edge",
    gender: "male",
    flag: "🇬🇧",
    name: "Ryan · 绅士英式男声",
    shortName: "英音男声 Ryan",
    badge: "英剧质感",
    desc: "沉稳有磁性的标准伦敦男声，咬字干净利落、富有英伦语调质感",
    sourceTag: "en-GB-RyanNeural",
    sampleLang: "en",
    sampleText: "To be quite honest, that's an extraordinarily useful phrase to keep up your sleeve.",
  },
  {
    id: "edge_natasha",
    engine: "edge",
    gender: "female",
    flag: "🇦🇺",
    name: "Natasha · 温暖澳式女声",
    shortName: "澳音 Natasha",
    badge: "松弛生活腔",
    desc: "亲切自然的澳大利亚英语女声，适合拓展多元英语口音适应力",
    sourceTag: "en-AU-NatashaNeural",
    sampleLang: "en",
    sampleText: "No worries at all—take your time and try saying that line out loud once more.",
  },
  {
    id: "edge_william",
    engine: "edge",
    gender: "male",
    flag: "🇦🇺",
    name: "William · 阳光澳式男声",
    shortName: "澳音 William",
    badge: "多语自然",
    desc: "明朗自然的澳式多语男声，口语连读真实流畅",
    sourceTag: "en-AU-WilliamMultilingualNeural",
    sampleLang: "en",
    sampleText: "Sounds like a solid plan! Let's jump straight into the next scene when you're ready.",
  },
  {
    id: "edge_hiumaan",
    engine: "edge",
    gender: "female",
    flag: "🇭🇰",
    name: "晓曼 HiuMaan · 柔声港粤女声",
    shortName: "港粤晓曼",
    badge: "港剧生活腔",
    desc: "相比原晓佳更温柔生活化的香港粤语女声；说英语时自动配自然女声 Emma",
    sourceTag: "zh-HK-HiuMaanNeural",
    sampleLang: "yue",
    sampleText: "今晚得唔得閒一齊去睇戲食飯？聽講呢套港劇真係好睇到停唔到！",
  },
];

export const SUPERTONIC_VOICE_PRESETS: VoicePreset[] = [
  {
    id: "supertonic_F1",
    engine: "supertonic",
    gender: "female",
    flag: "🎧",
    name: "Supertonic 暖声棚录女声 F1",
    shortName: "棚录女声 F1",
    badge: "44.1kHz 真人级",
    desc: "GitHub 爆火流匹配神经语音，44.1kHz 高保真无机械味，适合英语/韩/法/西精听",
    sourceTag: "GitHub: supertone-inc/supertonic",
    sampleLang: "en",
    sampleText: "This voice runs completely offline inside your phone at studio quality—no robotic tone at all.",
    supertonicVoiceCode: "F1",
  },
  {
    id: "supertonic_F2",
    engine: "supertonic",
    gender: "female",
    flag: "🎧",
    name: "Supertonic 知性温柔女声 F2",
    shortName: "知性女声 F2",
    badge: "有声书播客腔",
    desc: "柔和温润的知性女声，节奏舒缓清晰，适合睡前磨耳朵与长句拆解",
    sourceTag: "GitHub: supertone-inc/supertonic",
    sampleLang: "en",
    sampleText: "Slow down, listen closely to the rhythm, and let each word flow naturally.",
    supertonicVoiceCode: "F2",
  },
  {
    id: "supertonic_F3",
    engine: "supertonic",
    gender: "female",
    flag: "🎧",
    name: "Supertonic 轻快活力女声 F3",
    shortName: "活力女声 F3",
    badge: "年轻自然口语",
    desc: "清亮活泼的美式年轻女声，像外教朋友面对面聊天",
    sourceTag: "GitHub: supertone-inc/supertonic",
    sampleLang: "en",
    sampleText: "Awesome job! You nailed that phrasing on the very first try.",
    supertonicVoiceCode: "F3",
  },
  {
    id: "supertonic_M1",
    engine: "supertonic",
    gender: "male",
    flag: "🎧",
    name: "Supertonic 磁性叙事男声 M1",
    shortName: "棚录男声 M1",
    badge: "44.1kHz 真人级",
    desc: "极低机械感的 44.1kHz 磁性美式男声，气声与连读细节高度拟人",
    sourceTag: "GitHub: supertone-inc/supertonic",
    sampleLang: "en",
    sampleText: "Listen to how natural the cadence feels when every pause lands in the right spot.",
    supertonicVoiceCode: "M1",
  },
  {
    id: "supertonic_M2",
    engine: "supertonic",
    gender: "male",
    flag: "🎧",
    name: "Supertonic 随性日常男声 M2",
    shortName: "日常男声 M2",
    badge: "美剧聊天腔",
    desc: "松弛随意的美剧对话男声，毫无播音腔，听起来像真实美籍朋友",
    sourceTag: "GitHub: supertone-inc/supertonic",
    sampleLang: "en",
    sampleText: "Wait, seriously? Let's rewind five seconds and catch what he actually meant.",
    supertonicVoiceCode: "M2",
  },
  {
    id: "supertonic_M3",
    engine: "supertonic",
    gender: "male",
    flag: "🎧",
    name: "Supertonic 低沉电台男声 M3",
    shortName: "电台男声 M3",
    badge: "电影旁白质感",
    desc: "浑厚低沉的电台/纪录片质感男声，极适合沉浸盲听训练",
    sourceTag: "GitHub: supertone-inc/supertonic",
    sampleLang: "en",
    sampleText: "In the heart of the city, every single conversation is a chance to level up your ear.",
    supertonicVoiceCode: "M3",
  },
];

export const ALL_VOICE_PRESETS: VoicePreset[] = [...EDGE_VOICE_PRESETS, ...SUPERTONIC_VOICE_PRESETS];

const VOICE_ID_KEY = "echodeck_voice_preset_id_v91";
const LEGACY_GENDER_KEY = "echodeck_voice_gender_v52";
const CUSTOM_TTS_KEY = "echodeck_custom_tts_cfg_v91";

type VoiceListener = (voiceId: string) => void;
const listeners = new Set<VoiceListener>();

export function getVoicePresetById(id?: string): VoicePreset {
  return ALL_VOICE_PRESETS.find((v) => v.id === id) || EDGE_VOICE_PRESETS[0];
}

export function getSelectedVoiceId(): string {
  try {
    const saved = localStorage.getItem(VOICE_ID_KEY);
    if (saved && ALL_VOICE_PRESETS.some((v) => v.id === saved)) {
      return saved;
    }
    // 兼容旧版「女声 / 男声」选择
    const legacy = localStorage.getItem(LEGACY_GENDER_KEY);
    if (legacy === "male") return "edge_andrew";
  } catch {
    // ignore
  }
  return "edge_ava";
}

export function setSelectedVoiceId(voiceId: string): void {
  const preset = getVoicePresetById(voiceId);
  try {
    localStorage.setItem(VOICE_ID_KEY, preset.id);
    localStorage.setItem(LEGACY_GENDER_KEY, preset.gender);
  } catch {
    // ignore
  }
  for (const fn of listeners) {
    try {
      fn(preset.id);
    } catch {
      // ignore
    }
  }
}

export function subscribeSelectedVoice(fn: VoiceListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getCustomTtsConfig(): CustomTtsConfig {
  try {
    const raw = localStorage.getItem(CUSTOM_TTS_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return {
        enabled: Boolean(p.enabled),
        url: String(p.url || "").trim(),
        apiKey: String(p.apiKey || "").trim(),
        model: String(p.model || "").trim(),
        voice: String(p.voice || "").trim(),
      };
    }
  } catch {
    // ignore
  }
  return {
    enabled: false,
    url: "https://api.siliconflow.cn/v1/audio/speech",
    apiKey: "",
    model: "FunAudioLLM/CosyVoice2-0.5B",
    voice: "FunAudioLLM/CosyVoice2-0.5B:anna",
  };
}

export function saveCustomTtsConfig(cfg: CustomTtsConfig): void {
  try {
    localStorage.setItem(CUSTOM_TTS_KEY, JSON.stringify(cfg));
  } catch {
    // ignore
  }
}
