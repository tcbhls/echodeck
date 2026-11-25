package app.echodeck.mobile;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import okio.ByteString;

/**
 * Microsoft Azure / Edge 神经网络真人语音引擎（零 Key、国内直连、支持纯正香港粤语与自然美式英语）：
 * - 完整移植 edge-tts v2 Sec-MS-GEC-v2 (CS64 + SHA-256) 签名协议
 * - 粤语默认 zh-HK-HiuGaaiNeural（晓佳，极自然港女真人声）/ zh-HK-WanLungNeural（云龙，自然港男声）
 * - 英语默认 en-US-AvaMultilingualNeural / en-US-AndrewMultilingualNeural（播客级自然美音）
 */
public final class EdgeNeuralTts {

    private static final String TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
    private static final String WSS_URL =
        "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken="
            + TRUSTED_CLIENT_TOKEN;
    private static final String SEC_MS_GEC_VERSION = "2-143.0.3650.75";
    private static final String EDGE_UA =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0";

    private static final long WIN_EPOCH = 11644473600L;
    private static final long U32_MASK = 0xFFFFFFFFL;

    private static final long[] SHA256_INITIAL = {
        0x6A09E667L, 0xBB67AE85L, 0x3C6EF372L, 0xA54FF53AL,
        0x510E527FL, 0x9B05688CL, 0x1F83D9ABL, 0x5BE0CD19L
    };

    private static final long[] SHA256_STATE = {
        0xFD9FBEA2L, 0x91243CE7L, 0xBE499094L, 0xCD2E1E0AL,
        0x6C006F49L, 0x04BD35ABL, 0xFEB0A7E4L, 0x03EFFBD2L
    };

    private static final long[] SHA256_SCHEDULE = {
        0xEB24BF9EL, 0x1558691FL, 0xA0C09EE2L, 0x0CFA32BAL,
        0xA622EE8CL, 0xD1DD9491L, 0xC0DD25A0L, 0xF9E70AB6L,
        0xF0C31573L, 0x7058CE4EL, 0x7188E606L, 0x00E5AB33L,
        0xD258B060L, 0x72766564L
    };

    private static final long[] SHA256_ROUND_CONSTANTS = {
        0x428A2F98L, 0x71374491L, 0xB5C0FBCFL, 0xE9B5DBA5L,
        0x3956C25BL, 0x59F111F1L, 0x923F82A4L, 0xAB1C5ED5L,
        0xD807AA98L, 0x12835B01L, 0x243185BEL, 0x550C7DC3L,
        0x72BE5D74L, 0x80DEB1FEL, 0x9BDC06A7L, 0xC19BF174L,
        0xE49B69C1L, 0xEFBE4786L, 0x0FC19DC6L, 0x240CA1CCL,
        0x2DE92C6FL, 0x4A7484AAL, 0x5CB0A9DCL, 0x76F988DAL,
        0x983E5152L, 0xA831C66DL, 0xB00327C8L, 0xBF597FC7L,
        0xC6E00BF3L, 0xD5A79147L, 0x06CA6351L, 0x14292967L,
        0x27B70A85L, 0x2E1B2138L, 0x4D2C6DFCL, 0x53380D13L,
        0x650A7354L, 0x766A0ABBL, 0x81C2C92EL, 0x92722C85L,
        0xA2BFE8A1L, 0xA81A664BL, 0xC24B8B70L, 0xC76C51A3L,
        0xD192E819L, 0xD6990624L, 0xF40E3585L, 0x106AA070L,
        0x19A4C116L, 0x1E376C08L, 0x2748774CL, 0x34B0BCB5L,
        0x391C0CB3L, 0x4ED8AA4AL, 0x5B9CCA4FL, 0x682E6FF3L,
        0x748F82EEL, 0x78A5636FL, 0x84C87814L, 0x8CC70208L,
        0x90BEFFFAL, 0xA4506CEBL, 0xBEF9A3F7L, 0xC67178F2L
    };

    private static final long SHA256_ADJUSTMENT = 0xC9DC06A7L;
    private static final long SHA256_SIGMA0_ADJUSTMENT = 0x059C0B80L;
    private static final long SHA256_SIGMA1_ADJUSTMENT = 0x000B92C0L;

    private static final long[][] CS64_COEFFICIENTS = {
        {0xE82E91B1L, 0xB32700D0L},
        {0x44DE24C6L, 0x88DFF51DL},
        {0x3BEB65BCL, 0x29514038L},
        {0xC89C5933L, 0xB328CBDFL},
        {0x8D1EC211L, 0xD405B4D5L},
        {0x314EF5D5L, 0x26E55F3CL},
        {0xE92491B1L, 0x607801C6L},
        {0xF0A5B9D5L, 0x82B2C1FBL},
        {0x06064CF3L, 0xFA51A3DAL},
        {0xDA79FA60L, 0x207CC464L},
        {0xBED20560L, 0x3C3C74F3L},
        {0x89F9C9F8L, 0xD2D14B61L},
        {0x35FA38C6L, 0xBB04A2C1L},
        {0xCB49E3C6L, 0xC5626167L}
    };
    private static final long CS64_FACTOR = 0x82893933L;
    private static final long CS64_ADJUSTMENT0 = 0xF2F90B1AL;
    private static final long CS64_ADJUSTMENT1 = 0x0B1A0000L;

    private static final SecureRandom RNG = new SecureRandom();
    private static final OkHttpClient HTTP_CLIENT = new OkHttpClient.Builder()
        .connectTimeout(7, TimeUnit.SECONDS)
        .readTimeout(12, TimeUnit.SECONDS)
        .writeTimeout(7, TimeUnit.SECONDS)
        .build();

    private EdgeNeuralTts() {}

    /** 按语言与性别偏好挑选最自然、最像真人的微软神经网络音色（保留原有默认音色） */
    public static String resolveVoice(String lang, String gender) {
        return resolveVoiceById(lang, "male".equalsIgnoreCase(gender) ? "edge_andrew" : "edge_ava", gender);
    }

    /** 按用户选定的音色预设 ID（保留原 Ava/晓佳 与 Andrew/云龙，新增 Emma/Brian/Aria/Sonia/Ryan/Natasha/William/晓曼 等高自然度音色）解析实际微软音色 */
    public static String resolveVoiceById(String lang, String voiceId, String fallbackGender) {
        String low = lang == null ? "en" : lang.toLowerCase(Locale.ROOT).trim();
        String vid = voiceId == null ? "" : voiceId.trim();
        String vidLow = vid.toLowerCase(Locale.ROOT);

        // 若直接传入合法微软完整 ShortName 且语种匹配，直接采用
        if (vid.endsWith("Neural") && vid.contains("-")) {
            if ((low.equals("en") || low.startsWith("en-")) && vidLow.startsWith("en-")) return vid;
            if ((low.equals("yue") || low.equals("zh-hk") || low.startsWith("yue")) && vidLow.startsWith("zh-hk-")) return vid;
            if (low.startsWith("ja") && vidLow.startsWith("ja-")) return vid;
            if (low.startsWith("ko") && vidLow.startsWith("ko-")) return vid;
            if (low.startsWith("fr") && vidLow.startsWith("fr-")) return vid;
            if (low.startsWith("es") && vidLow.startsWith("es-")) return vid;
            if (low.startsWith("de") && vidLow.startsWith("de-")) return vid;
            if (low.startsWith("it") && vidLow.startsWith("it-")) return vid;
            if ((low.equals("zh") || low.startsWith("zh-cn")) && vidLow.startsWith("zh-cn-")) return vid;
        }

        boolean isMalePreset =
            vidLow.equals("edge_andrew")
                || vidLow.equals("edge_brian")
                || vidLow.equals("edge_ryan")
                || vidLow.equals("edge_william")
                || vidLow.startsWith("supertonic_m")
                || ("male".equalsIgnoreCase(fallbackGender) && !vidLow.startsWith("edge_") && !vidLow.startsWith("supertonic_f"));

        // 粤语（香港）：保留原 晓佳/云龙，同时支持更柔和生活化的 晓曼 (HiuMaan)
        if (low.equals("yue") || low.equals("zh-hk") || low.startsWith("yue")) {
            if (isMalePreset) return "zh-HK-WanLungNeural";
            if (vidLow.equals("edge_hiumaan") || vidLow.equals("edge_emma") || vidLow.equals("edge_aria") || vidLow.equals("edge_sonia") || vidLow.equals("edge_natasha")) {
                return "zh-HK-HiuMaanNeural";
            }
            return "zh-HK-HiuGaaiNeural";
        }

        // 英语：保留原默认 Ava / Andrew，同时完整开放美式/英式/澳式新一代自然口语音色
        if (low.equals("en") || low.startsWith("en-")) {
            switch (vidLow) {
                case "edge_ava":
                    return "en-US-AvaMultilingualNeural";
                case "edge_andrew":
                    return "en-US-AndrewMultilingualNeural";
                case "edge_emma":
                case "edge_hiumaan":
                    return "en-US-EmmaMultilingualNeural";
                case "edge_brian":
                    return "en-US-BrianMultilingualNeural";
                case "edge_aria":
                    return "en-US-AriaNeural";
                case "edge_sonia":
                    return "en-GB-SoniaNeural";
                case "edge_ryan":
                    return "en-GB-RyanNeural";
                case "edge_natasha":
                    return "en-AU-NatashaNeural";
                case "edge_william":
                    return "en-AU-WilliamMultilingualNeural";
                default:
                    return isMalePreset ? "en-US-AndrewMultilingualNeural" : "en-US-AvaMultilingualNeural";
            }
        }

        if (low.startsWith("ja")) {
            return isMalePreset ? "ja-JP-KeitaNeural" : "ja-JP-NanamiNeural";
        }
        if (low.startsWith("ko")) {
            return isMalePreset ? "ko-KR-HyunsuMultilingualNeural" : "ko-KR-SunHiNeural";
        }
        if (low.startsWith("fr")) {
            return isMalePreset ? "fr-FR-RemyMultilingualNeural" : "fr-FR-VivienneMultilingualNeural";
        }
        if (low.startsWith("es")) {
            return isMalePreset ? "es-ES-AlvaroNeural" : "es-ES-ElviraNeural";
        }
        if (low.startsWith("de")) {
            return isMalePreset ? "de-DE-FlorianMultilingualNeural" : "de-DE-SeraphinaMultilingualNeural";
        }
        if (low.startsWith("it")) {
            return isMalePreset ? "it-IT-GiuseppeMultilingualNeural" : "it-IT-ElsaNeural";
        }
        if (low.equals("zh") || low.startsWith("zh-cn")) {
            return isMalePreset ? "zh-CN-YunxiNeural" : "zh-CN-XiaoxiaoNeural";
        }
        return isMalePreset ? "en-US-AndrewMultilingualNeural" : "en-US-AvaMultilingualNeural";
    }

    private static String extractLocaleFromVoice(String voice) {
        if (voice == null) return "en-US";
        String[] parts = voice.split("-");
        if (parts.length >= 2) {
            return parts[0] + "-" + parts[1];
        }
        return "en-US";
    }

    /** 实时拉取微软神经网络真人 MP3 字节流 */
    public static byte[] synthesize(String text, String voice, double rate) throws Exception {
        String connId = randomHex(16);
        String gec = generateSecMsGecV2(System.currentTimeMillis() / 1000L);
        String wsUrl = WSS_URL
            + "&ConnectionId=" + connId
            + "&Sec-MS-GEC=" + gec
            + "&Sec-MS-GEC-Version=" + SEC_MS_GEC_VERSION;

        Request req = new Request.Builder()
            .url(wsUrl)
            .header("Pragma", "no-cache")
            .header("Cache-Control", "no-cache")
            .header("Origin", "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold")
            .header("User-Agent", EDGE_UA)
            .header("Accept-Language", "en-US,en;q=0.9")
            .header("Cookie", "muid=" + randomHex(16) + ";")
            .build();

        int pct = (int) Math.round((Math.max(0.55, Math.min(1.5, rate)) - 1.0) * 100.0);
        String rateStr = (pct >= 0 ? "+" : "") + pct + "%";
        String escaped = escapeXml(text);
        String ts = jsUtcDate();
        String xmlLang = extractLocaleFromVoice(voice);
        String ssml =
            "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='" + xmlLang + "'>"
                + "<voice name='" + voice + "'>"
                + "<prosody pitch='+0Hz' rate='" + rateStr + "' volume='+0%'>"
                + escaped
                + "</prosody>"
                + "</voice>"
                + "</speak>";

        final ByteArrayOutputStream audioOut = new ByteArrayOutputStream();
        final CountDownLatch done = new CountDownLatch(1);
        final AtomicReference<Throwable> errRef = new AtomicReference<>();

        WebSocket ws = HTTP_CLIENT.newWebSocket(req, new WebSocketListener() {
            @Override
            public void onOpen(WebSocket webSocket, Response response) {
                String cfg =
                    "X-Timestamp:" + ts + "\r\n"
                        + "Content-Type:application/json; charset=utf-8\r\n"
                        + "Path:speech.config\r\n\r\n"
                        + "{\"context\":{\"synthesis\":{\"audio\":{\"metadataoptions\":{"
                        + "\"sentenceBoundaryEnabled\":\"false\",\"wordBoundaryEnabled\":\"false\""
                        + "},\"outputFormat\":\"audio-24khz-48kbitrate-mono-mp3\"}}}}\r\n";
                webSocket.send(cfg);

                String reqId = UUID.randomUUID().toString().replace("-", "");
                String ssmlMsg =
                    "X-RequestId:" + reqId + "\r\n"
                        + "Content-Type:application/ssml+xml\r\n"
                        + "X-Timestamp:" + ts + "Z\r\n"
                        + "Path:ssml\r\n\r\n"
                        + ssml;
                webSocket.send(ssmlMsg);
            }

            @Override
            public void onMessage(WebSocket webSocket, String message) {
                if (message.contains("Path:turn.end")) {
                    webSocket.close(1000, "done");
                    done.countDown();
                }
            }

            @Override
            public void onMessage(WebSocket webSocket, ByteString bytes) {
                byte[] raw = bytes.toByteArray();
                if (raw.length < 2) return;
                int headerLen = ((raw[0] & 0xFF) << 8) | (raw[1] & 0xFF);
                int audioOffset = headerLen + 2;
                if (audioOffset < raw.length) {
                    String headerStr = new String(raw, 2, Math.min(headerLen, raw.length - 2), StandardCharsets.UTF_8);
                    if (headerStr.contains("Path:audio")) {
                        audioOut.write(raw, audioOffset, raw.length - audioOffset);
                    }
                }
            }

            @Override
            public void onFailure(WebSocket webSocket, Throwable t, Response response) {
                errRef.compareAndSet(null, t);
                done.countDown();
            }

            @Override
            public void onClosed(WebSocket webSocket, int code, String reason) {
                done.countDown();
            }
        });

        boolean finished = done.await(12, TimeUnit.SECONDS);
        ws.cancel();
        if (!finished) {
            throw new Exception("Edge Neural TTS timeout");
        }
        byte[] result = audioOut.toByteArray();
        if (result.length < 400) {
            Throwable t = errRef.get();
            throw new Exception(t != null ? t.getMessage() : "Empty Edge Neural TTS audio");
        }
        return result;
    }

    // ==================== Sec-MS-GEC v2 (CS64 + SHA-256) ====================

    public static String generateSecMsGecV2(long unixTimestampSeconds) {
        long ticks = unixTimestampSeconds + WIN_EPOCH;
        ticks -= (ticks % 300L);
        ticks *= 10_000_000L;
        byte[] data = (ticks + TRUSTED_CLIENT_TOKEN).getBytes(StandardCharsets.US_ASCII);
        byte[] digest = sha256Digest(data);
        long[] cs = cs64Digest(data, digest);
        byte[] csBytes = new byte[8];
        writeLe32(csBytes, 0, cs[0]);
        writeLe32(csBytes, 4, cs[1]);
        return bytesToHexUpper(csBytes) + "-" + bytesToHexUpper(digest);
    }

    private static long rol16(long v) {
        v &= U32_MASK;
        return ((v << 16) | (v >>> 16)) & U32_MASK;
    }

    private static long rotr32(long v, int n) {
        v &= U32_MASK;
        return ((v >>> n) | (v << (32 - n))) & U32_MASK;
    }

    private static long sigma0(long v) {
        v &= U32_MASK;
        return (rotr32(v, 7) ^ rotr32(v, 18) ^ (v >>> 3)) & U32_MASK;
    }

    private static long sigma1(long v) {
        v &= U32_MASK;
        return (rotr32(v, 17) ^ rotr32(v, 19) ^ (v >>> 10)) & U32_MASK;
    }

    private static void expandSha256Schedule(long[] words, int firstWord) {
        for (int i = firstWord; i < 64; i++) {
            long x = words[i - 2];
            long y = words[i - 15];
            words[i] = (sigma1(x) + words[i - 7] + sigma0(y) + words[i - 16]) & U32_MASK;
        }
    }

    private static long[] sha256Rounds(long[] state, long[] words, int firstRound) {
        long a = state[0], b = state[1], c = state[2], d = state[3];
        long e = state[4], f = state[5], g = state[6], h = state[7];
        for (int i = firstRound; i < 64; i++) {
            long k = (firstRound == 14 && i == 14) ? SHA256_ADJUSTMENT : SHA256_ROUND_CONSTANTS[i];
            long s1 = (rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25)) & U32_MASK;
            long ch = (g ^ (e & (f ^ g))) & U32_MASK;
            long t1 = (h + s1 + ch + k + words[i]) & U32_MASK;
            long s0 = (rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22)) & U32_MASK;
            long maj = ((a & b) | (c & (a | b))) & U32_MASK;
            long t2 = (s0 + maj) & U32_MASK;

            h = g;
            g = f;
            f = e;
            e = (d + t1) & U32_MASK;
            d = c;
            c = b;
            b = a;
            a = (t1 + t2) & U32_MASK;
        }
        return new long[]{a, b, c, d, e, f, g, h};
    }

    private static long[] sha256Init(byte[] data7) {
        long[] words = new long[64];
        words[14] = ((data7[0] & 0xFFL) << 16) | ((data7[1] & 0xFFL) << 8) | (data7[2] & 0xFFL);
        words[15] = ((data7[3] & 0xFFL) << 24) | ((data7[4] & 0xFFL) << 16) | ((data7[5] & 0xFFL) << 8) | (data7[6] & 0xFFL);
        for (int i = 16; i < 30; i++) {
            long val = SHA256_SCHEDULE[i - 16];
            if (i - 2 >= 14) {
                long s1 = sigma1(words[i - 2]);
                val += (i == 16) ? (s1 ^ SHA256_SIGMA1_ADJUSTMENT) : s1;
            }
            if (i - 7 >= 14) {
                val += words[i - 7];
            }
            if (i - 15 >= 14) {
                long s0 = sigma0(words[i - 15]);
                val += (i == 29) ? (s0 ^ SHA256_SIGMA0_ADJUSTMENT) : s0;
            }
            words[i] = val & U32_MASK;
        }
        words[30] = (sigma1(words[28]) + words[23] + sigma0(words[15]) + words[14]
            + SHA256_ADJUSTMENT - SHA256_ROUND_CONSTANTS[14]) & U32_MASK;
        expandSha256Schedule(words, 31);
        long[] working = sha256Rounds(SHA256_STATE, words, 14);
        long[] out = new long[8];
        for (int i = 0; i < 8; i++) {
            out[i] = (SHA256_INITIAL[i] + working[i]) & U32_MASK;
        }
        return out;
    }

    private static byte[] sha256Digest(byte[] data) {
        long totalLen = 57L + data.length;
        int remLen = data.length - 7;
        int zeroPad = (int) (((55L - totalLen) % 64L + 64L) % 64L);
        byte[] padded = new byte[remLen + 1 + zeroPad + 8];
        System.arraycopy(data, 7, padded, 0, remLen);
        padded[remLen] = (byte) 0x80;
        long bitLen = totalLen * 8L;
        for (int i = 0; i < 8; i++) {
            padded[padded.length - 8 + i] = (byte) ((bitLen >>> (56 - i * 8)) & 0xFFL);
        }

        long[] state = sha256Init(data);
        for (int off = 0; off < padded.length; off += 64) {
            long[] words = new long[64];
            for (int w = 0; w < 16; w++) {
                int p = off + w * 4;
                words[w] = ((padded[p] & 0xFFL) << 24)
                    | ((padded[p + 1] & 0xFFL) << 16)
                    | ((padded[p + 2] & 0xFFL) << 8)
                    | (padded[p + 3] & 0xFFL);
            }
            expandSha256Schedule(words, 16);
            long[] working = sha256Rounds(state, words, 0);
            for (int i = 0; i < 8; i++) {
                state[i] = (state[i] + working[i]) & U32_MASK;
            }
        }

        byte[] out = new byte[32];
        for (int i = 0; i < 8; i++) {
            out[i * 4] = (byte) ((state[i] >>> 24) & 0xFFL);
            out[i * 4 + 1] = (byte) ((state[i] >>> 16) & 0xFFL);
            out[i * 4 + 2] = (byte) ((state[i] >>> 8) & 0xFFL);
            out[i * 4 + 3] = (byte) (state[i] & 0xFFL);
        }
        return out;
    }

    private static long[] cs64Digest(byte[] data, byte[] digest) {
        long keyA = (readLe32(digest, 0) | 1L) & U32_MASK;
        long keyB = (readLe32(digest, 4) | 1L) & U32_MASK;
        long factor0 = (keyA * CS64_FACTOR) & U32_MASK;
        long factor1 = (keyB * CS64_FACTOR) & U32_MASK;

        byte[] prefixed = new byte[data.length + 1];
        prefixed[0] = 0;
        System.arraycopy(data, 0, prefixed, 1, data.length);
        int paddedLen = prefixed.length + ((-prefixed.length) & 3);
        int wordCount = paddedLen / 4;
        if ((wordCount & 1) == 1) wordCount++;

        int total = CS64_COEFFICIENTS.length + wordCount;
        long[] terms = new long[total];
        long[] offsets = new long[total];

        for (int i = 0; i < CS64_COEFFICIENTS.length; i++) {
            terms[i] = (CS64_COEFFICIENTS[i][0] * ((i & 1) == 0 ? factor0 : factor1)) & U32_MASK;
            offsets[i] = CS64_COEFFICIENTS[i][1];
        }

        for (int i = 0; i < wordCount; i++) {
            long word = 0L;
            int base = i * 4;
            for (int b = 0; b < 4; b++) {
                if (base + b < prefixed.length) {
                    word |= (prefixed[base + b] & 0xFFL) << (b * 8);
                }
            }
            long term = (word * ((i & 1) == 0 ? keyA : keyB)) & U32_MASK;
            long offset = (rol16(word) * ((i & 1) == 0 ? 0xEF0569FBL : 0xC31713DBL)) & U32_MASK;
            if (i == 0) {
                term = (term + ((CS64_ADJUSTMENT0 * factor0) & U32_MASK)) & U32_MASK;
                offset = (offset + CS64_ADJUSTMENT1) & U32_MASK;
            }
            terms[CS64_COEFFICIENTS.length + i] = term;
            offsets[CS64_COEFFICIENTS.length + i] = offset;
        }

        long swapAcc = 0L, swapLast = 0L, state = 0L, acc = 0L;
        for (int i = 0; i < total; i += 2) {
            long x = terms[i];
            long y = terms[i + 1];

            long t = rol16((offsets[i] + x) & U32_MASK);
            long q = (t * 0x76F50F34L) & U32_MASK;
            swapAcc = (swapAcc + ((rol16(q) * 0xC3EFEA97L + q) & U32_MASK)) & U32_MASK;

            t = rol16((offsets[i + 1] + y) & U32_MASK);
            q = (t * 0x1881CE3CL) & U32_MASK;
            swapLast = (rol16(q) * 0x35BD1EC9L + q) & U32_MASK;
            swapAcc = (swapAcc + swapLast) & U32_MASK;

            state = (state * keyA + x) & U32_MASK;
            state = (rol16(state) * 0xCF98B111L) & U32_MASK;
            state = (rol16(state) * 0x87085B9FL) & U32_MASK;
            state = (rol16(state) * 0x12CEB96DL) & U32_MASK;
            state = (rol16(state) * 0x257E1D83L) & U32_MASK;
            acc = (acc + state) & U32_MASK;

            t = (state * keyB + y) & U32_MASK;
            t = (rol16(t) * 0xA27416F5L) & U32_MASK;
            t = (rol16(t) * 0xD38396FFL) & U32_MASK;
            state = (rol16((rol16(t) * 0x7C932B89L) & U32_MASK) * 0xBFA49F69L) & U32_MASK;
            acc = (acc + state) & U32_MASK;
        }
        return new long[]{(swapLast ^ state) & U32_MASK, (swapAcc ^ acc) & U32_MASK};
    }

    private static long readLe32(byte[] buf, int off) {
        return (buf[off] & 0xFFL)
            | ((buf[off + 1] & 0xFFL) << 8)
            | ((buf[off + 2] & 0xFFL) << 16)
            | ((buf[off + 3] & 0xFFL) << 24);
    }

    private static void writeLe32(byte[] buf, int off, long val) {
        buf[off] = (byte) (val & 0xFFL);
        buf[off + 1] = (byte) ((val >>> 8) & 0xFFL);
        buf[off + 2] = (byte) ((val >>> 16) & 0xFFL);
        buf[off + 3] = (byte) ((val >>> 24) & 0xFFL);
    }

    private static String bytesToHexUpper(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            sb.append(String.format(Locale.ROOT, "%02X", b & 0xFF));
        }
        return sb.toString();
    }

    private static String randomHex(int numBytes) {
        byte[] b = new byte[numBytes];
        RNG.nextBytes(b);
        return bytesToHexUpper(b);
    }

    private static String jsUtcDate() {
        SimpleDateFormat sdf = new SimpleDateFormat("EEE MMM dd yyyy HH:mm:ss 'GMT+0000 (Coordinated Universal Time)'", Locale.US);
        sdf.setTimeZone(TimeZone.getTimeZone("UTC"));
        return sdf.format(new Date());
    }

    private static String escapeXml(String s) {
        return s.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace("\"", "&quot;")
            .replace("'", "&apos;");
    }
}
