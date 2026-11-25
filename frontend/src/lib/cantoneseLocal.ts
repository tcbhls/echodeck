/**
 * 100% 离线纯本地粤语注音（21,574 字简繁全覆盖）与高频 NBA 球评/正字纠懒音词典。
 * 无需任何后端或网络，手机断网毫秒级逐字出声调粤拼。
 */

import rawDict from "../data/jyutpingDict.json";
import type { CantoneseToken, GlossaryItem } from "../types";

const JYUTPING_DICT = rawDict as Record<string, string>;

export const CANTONESE_GLOSSARY: GlossaryItem[] = [
  { word: "睇戲", jyutping: "tai2 hei3", meaning: "看电影", tip: "正字为目字旁「睇」，读 tai2；港剧日常超高频。" },
  { word: "追劇", jyutping: "zeoi1 kek6", meaning: "追电视剧", tip: "「劇」为入声字 kek6，短促收舌根 -k 尾。" },
  { word: "冇得彈", jyutping: "mou5 dak1 taan4", meaning: "无可挑剔、没毛病", tip: "夸电影好看、演技好、菜好吃都百搭，「彈」读 taan4。" },
  { word: "傾偈", jyutping: "king1 gai2", meaning: "聊天、谈心", tip: "港片常见词，「傾」读 king1，不要念成普通话 qing。" },
  { word: "得閒", jyutping: "dak1 haan4", meaning: "有空、空闲", tip: "如「今晚得唔得閒」= 今晚有没有空。" },
  { word: "搞掂", jyutping: "gaau2 dim6", meaning: "搞定、完成", tip: "「掂」读闭口音 -m 尾（dim6），勿读成 -n。" },
  { word: "唔該", jyutping: "m4 goi1", meaning: "谢谢（劳烦）/ 麻烦借过", tip: "「唔」为独立双唇鼻音 m4，点单问路高频。" },
  { word: "多謝", jyutping: "do1 ze6", meaning: "谢谢（收到礼物/夸奖）", tip: "注意与「唔該」区分使用场景。" },
  { word: "唔好意思", jyutping: "m4 hou2 ji3 si1", meaning: "不好意思、打扰一下", tip: "社交最常用礼貌开场白。" },
  { word: "點解", jyutping: "dim2 gaai2", meaning: "为什么", tip: "日常最高频疑问词，「點」为闭口 -m 尾。" },
  { word: "點算", jyutping: "dim2 syun3", meaning: "怎么办", tip: "港剧经典台词「而家點算好」= 现在怎么办才好。" },
  { word: "其實", jyutping: "kei4 sat6", meaning: "其实", tip: "「實」为 -t 尾入声字，发音短促舌尖抵上齿龈。" },
  { word: "穩陣", jyutping: "wan2 zan6", meaning: "稳妥、靠谱、保险", tip: "形容方案稳健或做事让人放心。" },
  { word: "執生", jyutping: "zap1 saang1", meaning: "随机应变、见机行事", tip: "港剧职场/警匪片超高频词，如「到時自己執生」。" },
  { word: "頂硬上", jyutping: "ding2 ngaang6 soeng5", meaning: "咬牙硬顶、迎难而上", tip: "「硬」注意发清 ng- 声母，避免懒音漏成 aang6。" },
  { word: "擺明", jyutping: "baai2 ming4", meaning: "明摆着、显然", tip: "如「佢擺明唔想去」= 他明摆着不想去。" },
  { word: "行街", jyutping: "haang4 gaai1", meaning: "逛街", tip: "「行」在口语走路意中读 haang4。" },
  { word: "邊度", jyutping: "bin1 dou6", meaning: "哪里、哪儿", tip: "如「你喺邊度？」= 你在哪里？" },
  { word: "幾好", jyutping: "gei2 hou2", meaning: "挺好的、不错", tip: "「幾」表程度“挺/蛮”，如「套戲幾好睇」。" },
  { word: "冇問題", jyutping: "mou5 man6 tai4", meaning: "没问题", tip: "「冇」读 mou5，不要读错成 mou4。" },
];

// 常见双字/多字词特殊读音优先修正
const PHRASE_OVERRIDES: Record<string, string[]> = {
  "呢球": ["ni1", "kau4"],
  "唔该": ["m4", "goi1"],
  "唔該": ["m4", "goi1"],
  "冇得弹": ["mou5", "dak1", "taan4"],
  "冇得彈": ["mou5", "dak1", "taan4"],
  "稳阵": ["wan2", "zan6"],
  "穩陣": ["wan2", "zan6"],
  "点解": ["dim2", "gaai2"],
  "點解": ["dim2", "gaai2"],
  "其实": ["kei4", "sat6"],
  "其實": ["kei4", "sat6"],
  "转身": ["zyun2", "san1"],
  "轉身": ["zyun2", "san1"],
  "上篮": ["soeng5", "laam4"],
  "上籃": ["soeng5", "laam4"],
  "三分": ["saam1", "fan1"],
  "大心脏": ["daai6", "sam1", "zong6"],
  "大心臟": ["daai6", "sam1", "zong6"],
};

export function annotateJyutpingOffline(text: string): {
  hk_text: string;
  jyutping: string;
  tokens: CantoneseToken[];
} {
  const trimmed = text.trim();
  if (!trimmed || !/[\u4e00-\u9fff]/.test(trimmed)) {
    return { hk_text: trimmed, jyutping: "", tokens: [] };
  }

  const chars = Array.from(trimmed);
  const tokens: CantoneseToken[] = [];
  const jpParts: string[] = [];

  let i = 0;
  while (i < chars.length) {
    let matchedPhrase = false;
    for (const len of [3, 2]) {
      if (i + len <= chars.length) {
        const sub = chars.slice(i, i + len).join("");
        const ov = PHRASE_OVERRIDES[sub];
        if (ov) {
          for (let k = 0; k < len; k++) {
            tokens.push({ char: chars[i + k], jp: ov[k] });
            jpParts.push(ov[k]);
          }
          i += len;
          matchedPhrase = true;
          break;
        }
      }
    }
    if (matchedPhrase) continue;

    const ch = chars[i];
    const jp = JYUTPING_DICT[ch] || "";
    tokens.push({ char: ch, jp });
    if (jp) {
      jpParts.push(jp);
    } else if (ch.trim()) {
      jpParts.push(ch);
    }
    i += 1;
  }

  const jyutping = jpParts
    .join(" ")
    .replace(/\s+([,.!?;:，。！？；：])/g, "$1")
    .trim();

  return { hk_text: trimmed, jyutping, tokens };
}

export function searchGlossaryOffline(query = ""): GlossaryItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return CANTONESE_GLOSSARY;
  return CANTONESE_GLOSSARY.filter((item) =>
    `${item.word} ${item.jyutping} ${item.meaning} ${item.tip}`.toLowerCase().includes(q)
  );
}
