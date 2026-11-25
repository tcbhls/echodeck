package app.echodeck.mobile;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.PlaybackParams;
import android.os.Build;
import android.speech.tts.TextToSpeech;
import android.view.Window;
import android.view.WindowManager;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * EchoDeck Android 原生引擎插件：
 * 1. 无 CORS 限制直下 B站音视频+CC字幕、小宇宙播客音频、媒体直链及自定义 Cobalt 节点
 * 2. Android 系统原生离线 TTS（支持 en-US / zh-HK 港粤 / zh-CN）
 * 3. 接收 B站 / 抖音 / 小宇宙系统分享 Intent
 */
@CapacitorPlugin(name = "EchoDeckNative")
public class EchoDeckNativePlugin extends Plugin {

    private static final String MOBILE_UA =
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
    private static final String DESKTOP_UA =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

    private static final Pattern URL_PATTERN = Pattern.compile("https?://[^\\s\"'<>]+");
    private static final Pattern BV_PATTERN = Pattern.compile("\\b(BV[0-9A-Za-z]{10})\\b");

    private final ExecutorService executor = Executors.newCachedThreadPool();
    private TextToSpeech tts;
    private volatile boolean ttsReady = false;
    private CountDownLatch ttsLatch = new CountDownLatch(1);
    private MediaPlayer fallbackPlayer;
    private final Object playerLock = new Object();

    public static volatile String pendingSharedText = "";
    public static volatile boolean isFullscreenActive = false;

    @Override
    public void load() {
        super.load();
        initTts();
    }

    private synchronized void initTts() {
        if (tts != null && ttsReady) return;
        ttsLatch = new CountDownLatch(1);
        try {
            tts = new TextToSpeech(getContext(), status -> {
                if (status == TextToSpeech.SUCCESS && tts != null) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                        tts.setAudioAttributes(new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_MEDIA)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                            .build());
                    }
                    ttsReady = true;
                } else {
                    ttsReady = false;
                }
                ttsLatch.countDown();
            });
        } catch (Exception e) {
            ttsReady = false;
            ttsLatch.countDown();
        }
    }

    @Override
    protected void handleOnDestroy() {
        stopFallbackPlayer();
        if (tts != null) {
            tts.stop();
            tts.shutdown();
        }
        executor.shutdownNow();
        super.handleOnDestroy();
    }

    private void stopFallbackPlayer() {
        synchronized (playerLock) {
            if (fallbackPlayer != null) {
                try {
                    if (fallbackPlayer.isPlaying()) fallbackPlayer.stop();
                } catch (Exception ignored) {
                }
                try {
                    fallbackPlayer.release();
                } catch (Exception ignored) {
                }
                fallbackPlayer = null;
            }
        }
    }

    public static void captureIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        String type = intent.getType();
        if (Intent.ACTION_SEND.equals(action) && type != null && type.startsWith("text/")) {
            String shared = intent.getStringExtra(Intent.EXTRA_TEXT);
            if (shared != null && !shared.trim().isEmpty()) {
                pendingSharedText = shared.trim();
            }
        }
    }

    @PluginMethod
    public void getSharedIntent(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("text", pendingSharedText);
        ret.put("url", extractUrl(pendingSharedText));
        call.resolve(ret);
    }

    @PluginMethod
    public void clearSharedIntent(PluginCall call) {
        pendingSharedText = "";
        call.resolve();
    }

    /** 原生沉浸式全屏横屏切换（隐藏状态栏/导航栏 + 保持常亮 + 横屏观影，且保留全部前端学习浮层） */
    @PluginMethod
    public void setFullscreenMode(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        boolean landscape = Boolean.TRUE.equals(call.getBoolean("landscape", true));
        isFullscreenActive = enabled;
        Activity activity = getActivity();
        if (activity == null) {
            call.resolve();
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                Window window = activity.getWindow();
                WindowInsetsControllerCompat controller =
                    WindowCompat.getInsetsController(window, window.getDecorView());
                if (enabled) {
                    if (landscape) {
                        activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
                    }
                    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    if (controller != null) {
                        controller.setSystemBarsBehavior(
                            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                        );
                        controller.hide(WindowInsetsCompat.Type.systemBars());
                    }
                } else {
                    activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
                    window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    if (controller != null) {
                        controller.show(WindowInsetsCompat.Type.systemBars());
                    }
                }
            } catch (Exception ignored) {
            }
            call.resolve();
        });
    }

    /** 同步 Android 系统状态栏与底部手势栏颜色及图标明暗（让浅色/深色主题拥有原生旗舰 App 一体化观感） */
    @PluginMethod
    public void setSystemTheme(PluginCall call) {
        boolean dark = Boolean.TRUE.equals(call.getBoolean("dark", false));
        Activity activity = getActivity();
        if (activity == null) {
            call.resolve();
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                Window window = activity.getWindow();
                int bgColor = android.graphics.Color.parseColor(dark ? "#0B0C10" : "#F7F7F9");
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    window.setStatusBarColor(bgColor);
                    window.setNavigationBarColor(bgColor);
                }
                WindowInsetsControllerCompat controller =
                    WindowCompat.getInsetsController(window, window.getDecorView());
                if (controller != null) {
                    controller.setAppearanceLightStatusBars(!dark);
                    controller.setAppearanceLightNavigationBars(!dark);
                }
            } catch (Exception ignored) {
            }
            call.resolve();
        });
    }

    /** 首页双击返回时将 App 优雅退至后台（保留播放与记忆状态，不冷杀进程） */
    @PluginMethod
    public void minimizeApp(PluginCall call) {
        Activity activity = getActivity();
        if (activity != null) {
            activity.runOnUiThread(() -> {
                try {
                    activity.moveTaskToBack(true);
                } catch (Exception ignored) {
                }
                call.resolve();
            });
        } else {
            call.resolve();
        }
    }

    /** 原生无 CORS 限制 HTTP GET（用于直连在线片库 JSON VOD 接口与外部字幕文件） */
    @PluginMethod
    public void httpGet(PluginCall call) {
        String url = call.getString("url", "").trim();
        String referer = call.getString("referer", "").trim();
        if (url.isEmpty()) {
            call.reject("url 不能为空");
            return;
        }
        executor.execute(() -> {
            try {
                String text = httpGetString(url, referer.isEmpty() ? null : referer, MOBILE_UA);
                JSObject ret = new JSObject();
                ret.put("text", text);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "网络请求失败");
            }
        });
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "").trim();
        String lang = call.getString("language", "en").trim();
        double rate = call.getDouble("rate", 1.0);
        String voiceGender = call.getString("voiceGender", "female").trim();
        String voiceId = call.getString("voiceId", "").trim();
        String customTtsUrl = call.getString("customTtsUrl", "").trim();
        String customTtsKey = call.getString("customTtsKey", "").trim();
        String customTtsModel = call.getString("customTtsModel", "").trim();
        String customTtsVoice = call.getString("customTtsVoice", "").trim();
        if (text.isEmpty()) {
            JSObject r = new JSObject();
            r.put("ok", false);
            r.put("reason", "empty");
            call.resolve(r);
            return;
        }

        executor.execute(() -> {
            stopFallbackPlayer();
            if (tts != null) {
                try {
                    tts.stop();
                } catch (Exception ignored) {
                }
            }

            // 0. 若用户配置了自定义云端真人 TTS（如 OpenAI gpt-4o-mini-tts / 硅基流动 CosyVoice2 / FishAudio），原生无 CORS 直出高清 MP3
            if (!customTtsUrl.isEmpty() && !customTtsVoice.isEmpty()) {
                if (playCustomCloudTts(text, rate, customTtsUrl, customTtsKey, customTtsModel, customTtsVoice)) {
                    JSObject r = new JSObject();
                    r.put("ok", true);
                    r.put("engine", "custom_cloud_tts");
                    r.put("voice", customTtsVoice);
                    call.resolve(r);
                    return;
                }
            }

            // 1. 优先使用 Microsoft Edge 神经网络真人语音（完整保留原 晓佳/Ava/云龙/Andrew，新增 Emma/Brian/Aria/Sonia/Ryan/Natasha/William/晓曼 等音色，自动本地缓存）
            String resolvedEdgeVoice = EdgeNeuralTts.resolveVoiceById(lang, voiceId, voiceGender);
            if (playEdgeNeuralTts(text, resolvedEdgeVoice, rate)) {
                JSObject r = new JSObject();
                r.put("ok", true);
                r.put("engine", "edge_neural");
                r.put("voice", resolvedEdgeVoice);
                call.resolve(r);
                return;
            }

            // 2. 离线或弱网时自动回退至 Android 系统本地离线 TTS（确保断网有声）
            if (tts == null) initTts();
            try {
                ttsLatch.await(1500, TimeUnit.MILLISECONDS);
            } catch (InterruptedException ignored) {
            }
            if (tts != null && ttsReady) {
                List<Locale> candidates = buildLocaleCandidates(lang);
                Locale matched = null;
                for (Locale loc : candidates) {
                    int avail = tts.isLanguageAvailable(loc);
                    if (avail == TextToSpeech.LANG_AVAILABLE
                        || avail == TextToSpeech.LANG_COUNTRY_AVAILABLE
                        || avail == TextToSpeech.LANG_COUNTRY_VAR_AVAILABLE) {
                        int setRes = tts.setLanguage(loc);
                        if (setRes >= TextToSpeech.LANG_AVAILABLE) {
                            matched = loc;
                            break;
                        }
                    }
                }
                if (matched != null) {
                    tts.setSpeechRate((float) Math.max(0.5, Math.min(1.6, rate)));
                    int speakRes = tts.speak(
                        text,
                        TextToSpeech.QUEUE_FLUSH,
                        null,
                        "echodeck_tts_" + System.currentTimeMillis()
                    );
                    if (speakRes == TextToSpeech.SUCCESS) {
                        JSObject r = new JSObject();
                        r.put("ok", true);
                        r.put("engine", "native_tts");
                        call.resolve(r);
                        return;
                    }
                }
            }

            // 3. 兜底在线发音（有道美音 / 百度语音）
            if (playOnlineTtsFallback(text, lang, rate)) {
                JSObject r = new JSObject();
                r.put("ok", true);
                r.put("engine", "online_mp3");
                call.resolve(r);
                return;
            }

            JSObject r = new JSObject();
            r.put("ok", false);
            r.put("reason", "no_tts_engine_and_offline");
            call.resolve(r);
        });
    }

    /** 自定义 OpenAI 兼容真人云端 TTS（OpenAI gpt-4o-mini-tts / 硅基流动 CosyVoice2 / 自建 Kokoro 等），带本地 MP3 缓存 */
    private boolean playCustomCloudTts(
        String text,
        double rate,
        String endpoint,
        String apiKey,
        String model,
        String voice
    ) {
        try {
            String clipped = text.length() > 360 ? text.substring(0, 360) : text;
            File cacheDir = new File(getContext().getCacheDir(), "echodeck_custom_tts_cache");
            if (!cacheDir.exists()) cacheDir.mkdirs();
            String key = sha1Hex(endpoint + "|" + model + "|" + voice + "|" + clipped);
            File mp3 = new File(cacheDir, key + ".mp3");

            if (!mp3.exists() || mp3.length() < 800) {
                HttpURLConnection conn = (HttpURLConnection) new URL(endpoint).openConnection();
                conn.setRequestMethod("POST");
                conn.setConnectTimeout(10000);
                conn.setReadTimeout(25000);
                conn.setDoOutput(true);
                conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                conn.setRequestProperty("User-Agent", DESKTOP_UA);
                if (apiKey != null && !apiKey.isEmpty()) {
                    conn.setRequestProperty("Authorization", "Bearer " + apiKey);
                }
                JSONObject payload = new JSONObject();
                payload.put("model", model.isEmpty() ? "gpt-4o-mini-tts" : model);
                payload.put("input", clipped);
                payload.put("voice", voice);
                payload.put("response_format", "mp3");
                payload.put("speed", 1.0);
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(payload.toString().getBytes(StandardCharsets.UTF_8));
                }
                int code = conn.getResponseCode();
                if (code >= 400) {
                    conn.disconnect();
                    return false;
                }
                try (InputStream is = new BufferedInputStream(conn.getInputStream());
                     FileOutputStream fos = new FileOutputStream(mp3)) {
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = is.read(buf)) > 0) {
                        fos.write(buf, 0, n);
                    }
                    fos.flush();
                } finally {
                    conn.disconnect();
                }
            }
            if (mp3.length() < 800) return false;
            return playMp3File(mp3, rate);
        } catch (Exception e) {
            return false;
        }
    }

    /** 微软 Edge 神经网络真人语音合成 + 手机本地持久化缓存（重听 0 流量秒播） */
    private boolean playEdgeNeuralTts(String text, String voice, double rate) {
        try {
            String clipped = text.length() > 260 ? text.substring(0, 260) : text;
            File cacheDir = new File(getContext().getCacheDir(), "echodeck_neural_v2_cache");
            if (!cacheDir.exists()) cacheDir.mkdirs();
            // 缓存常速音频，再由 Android MediaPlayer 原生无损变速，确保 0.7x/0.8x 切换也秒响且不重复拉网
            String key = sha1Hex(voice + "|" + clipped);
            File mp3 = new File(cacheDir, key + ".mp3");

            if (!mp3.exists() || mp3.length() < 800) {
                byte[] bytes = EdgeNeuralTts.synthesize(clipped, voice, 0.98);
                try (FileOutputStream fos = new FileOutputStream(mp3)) {
                    fos.write(bytes);
                    fos.flush();
                }
            }

            return playMp3File(mp3, rate);
        } catch (Exception e) {
            return false;
        }
    }

    private boolean playMp3File(File mp3, double rate) throws Exception {
        synchronized (playerLock) {
            stopFallbackPlayer();
            MediaPlayer mp = new MediaPlayer();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                mp.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build());
            }
            mp.setDataSource(mp3.getAbsolutePath());
            mp.prepare();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && Math.abs(rate - 1.0) > 0.02) {
                PlaybackParams pp = mp.getPlaybackParams();
                pp.setSpeed((float) Math.max(0.55, Math.min(1.6, rate)));
                mp.setPlaybackParams(pp);
            }
            mp.setOnCompletionListener(player -> {
                synchronized (playerLock) {
                    if (fallbackPlayer == player) fallbackPlayer = null;
                }
                try {
                    player.release();
                } catch (Exception ignored) {
                }
            });
            mp.setOnErrorListener((player, what, extra) -> {
                synchronized (playerLock) {
                    if (fallbackPlayer == player) fallbackPlayer = null;
                }
                try {
                    player.release();
                } catch (Exception ignored) {
                }
                return true;
            });
            fallbackPlayer = mp;
            mp.start();
        }
        return true;
    }

    /** 原生无 CORS 限制 AI 对话代理：默认开箱即用内置免费语言 AI（双通道自动容灾），填了自有 Key 则直连用户指定的付费/免费接口 */
    @PluginMethod
    public void aiChat(PluginCall call) {
        boolean freeMode = Boolean.TRUE.equals(call.getBoolean("freeMode", true));
        String url = call.getString("url", "").trim();
        String apiKey = call.getString("apiKey", "").trim();
        String model = call.getString("model", "").trim();
        double temperature = call.getDouble("temperature", 0.55);
        boolean jsonMode = Boolean.TRUE.equals(call.getBoolean("jsonMode", false));
        com.getcapacitor.JSArray messagesArr = call.getArray("messages");

        if (messagesArr == null || messagesArr.length() == 0) {
            call.reject("messages 不能为空");
            return;
        }

        executor.execute(() -> {
            try {
                if (freeMode || apiKey.isEmpty()) {
                    // 开箱即用内置免费语言 AI 双通道路由（零注册、免 API Key、无 CORS）
                    String[][] routes = new String[][]{
                        {"https://ch.at/v1/chat/completions", "default", ""},
                        {"https://text.pollinations.ai/openai/chat/completions", "openai", "no-key"}
                    };
                    Exception lastErr = null;
                    for (String[] route : routes) {
                        try {
                            String content = postChatCompletion(route[0], route[2], route[1], messagesArr, temperature, false);
                            if (content != null && !content.trim().isEmpty()) {
                                JSObject ret = new JSObject();
                                ret.put("content", content.trim());
                                ret.put("provider", route[0].contains("ch.at") ? "free-chat" : "free-pollinations");
                                call.resolve(ret);
                                return;
                            }
                        } catch (Exception e) {
                            lastErr = e;
                        }
                    }
                    throw lastErr != null ? lastErr : new Exception("内置免费 AI 通道暂时繁忙，请稍后重试或切换自有 API Key");
                } else {
                    String content = postChatCompletion(url, apiKey, model, messagesArr, temperature, jsonMode);
                    JSObject ret = new JSObject();
                    ret.put("content", content != null ? content.trim() : "");
                    ret.put("provider", "custom");
                    call.resolve(ret);
                }
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "AI 请求失败");
            }
        });
    }

    private String postChatCompletion(
        String endpoint,
        String apiKey,
        String model,
        org.json.JSONArray messages,
        double temperature,
        boolean jsonMode
    ) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(endpoint).openConnection();
        conn.setRequestMethod("POST");
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(45000);
        conn.setDoOutput(true);
        conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        conn.setRequestProperty("Accept", "application/json");
        conn.setRequestProperty("User-Agent", DESKTOP_UA);
        if (apiKey != null && !apiKey.isEmpty()) {
            conn.setRequestProperty("Authorization", "Bearer " + apiKey);
        }

        JSONObject payload = new JSONObject();
        payload.put("model", model);
        payload.put("messages", messages);
        payload.put("temperature", temperature);
        payload.put("max_tokens", 1800);
        if (jsonMode) {
            JSONObject rf = new JSONObject();
            rf.put("type", "json_object");
            payload.put("response_format", rf);
        }
        // 智谱 GLM-4.5-Flash / GLM-4.7-Flash 混合推理模型默认关闭思考过程，确保 1 秒极速返回且不吞空 content
        if (endpoint != null && endpoint.contains("bigmodel.cn")
            && model != null && (model.contains("4.5") || model.contains("4.7") || model.contains("4.6"))) {
            JSONObject thinking = new JSONObject();
            thinking.put("type", "disabled");
            payload.put("thinking", thinking);
        }

        try (OutputStream os = conn.getOutputStream()) {
            os.write(payload.toString().getBytes(StandardCharsets.UTF_8));
        }

        int code = conn.getResponseCode();
        String raw = readStream(code < 400 ? conn.getInputStream() : conn.getErrorStream());
        conn.disconnect();
        if (code >= 400) {
            throw new Exception("HTTP " + code + ": " + raw.substring(0, Math.min(120, raw.length())));
        }
        JSONObject resp = new JSONObject(raw);
        JSONArray choices = resp.optJSONArray("choices");
        if (choices == null || choices.length() == 0) {
            throw new Exception("AI 未返回有效内容");
        }
        JSONObject msg = choices.getJSONObject(0).optJSONObject("message");
        return msg != null ? msg.optString("content", "") : "";
    }

    private List<Locale> buildLocaleCandidates(String lang) {
        List<Locale> list = new ArrayList<>();
        String low = lang == null ? "en" : lang.toLowerCase(Locale.ROOT);
        if (low.equals("yue") || low.equals("zh-hk") || low.startsWith("yue")) {
            list.add(new Locale("zh", "HK"));
            list.add(Locale.forLanguageTag("yue-HK"));
            list.add(Locale.forLanguageTag("zh-Hant-HK"));
        } else if (low.equals("en") || low.startsWith("en-")) {
            list.add(Locale.US);
            list.add(Locale.UK);
            list.add(Locale.ENGLISH);
        } else if (low.equals("zh") || low.equals("zh-cn")) {
            list.add(Locale.SIMPLIFIED_CHINESE);
        } else {
            list.add(Locale.forLanguageTag(lang));
        }
        return list;
    }

    private boolean playOnlineTtsFallback(String text, String lang, double rate) {
        try {
            String clipped = text.length() > 180 ? text.substring(0, 180) : text;
            File cacheDir = new File(getContext().getCacheDir(), "echodeck_tts_cache");
            if (!cacheDir.exists()) cacheDir.mkdirs();
            String key = sha1Hex(lang + "|" + clipped);
            File mp3 = new File(cacheDir, key + ".mp3");

            if (!mp3.exists() || mp3.length() < 800) {
                List<String> urls = buildOnlineTtsUrls(clipped, lang);
                boolean ok = false;
                for (String u : urls) {
                    if (downloadAudioFile(u, mp3)) {
                        ok = true;
                        break;
                    }
                }
                if (!ok) return false;
            }

            synchronized (playerLock) {
                stopFallbackPlayer();
                MediaPlayer mp = new MediaPlayer();
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    mp.setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build());
                }
                mp.setDataSource(mp3.getAbsolutePath());
                mp.prepare();
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    PlaybackParams pp = mp.getPlaybackParams();
                    pp.setSpeed((float) Math.max(0.5, Math.min(1.6, rate)));
                    mp.setPlaybackParams(pp);
                }
                mp.setOnCompletionListener(player -> {
                    synchronized (playerLock) {
                        if (fallbackPlayer == player) fallbackPlayer = null;
                    }
                    try {
                        player.release();
                    } catch (Exception ignored) {
                    }
                });
                mp.setOnErrorListener((player, what, extra) -> {
                    synchronized (playerLock) {
                        if (fallbackPlayer == player) fallbackPlayer = null;
                    }
                    try {
                        player.release();
                    } catch (Exception ignored) {
                    }
                    return true;
                });
                fallbackPlayer = mp;
                mp.start();
            }
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private List<String> buildOnlineTtsUrls(String text, String lang) throws Exception {
        List<String> urls = new ArrayList<>();
        String low = lang == null ? "en" : lang.toLowerCase(Locale.ROOT);
        String enc = URLEncoder.encode(text, "UTF-8").replace("+", "%20");
        String encPlus = URLEncoder.encode(text, "UTF-8");

        if (low.equals("en") || low.startsWith("en-")) {
            if (text.length() <= 36) {
                urls.add("https://dict.youdao.com/dictvoice?audio=" + encPlus + "&type=2");
            }
            urls.add("https://fanyi.baidu.com/gettts?lan=en&text=" + enc + "&spd=3&source=web");
            urls.add("https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=en-US&q=" + enc);
        } else if (low.equals("yue") || low.equals("zh-hk") || low.startsWith("yue")) {
            urls.add("https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=zh-HK&q=" + enc);
            urls.add("https://fanyi.baidu.com/gettts?lan=zh&text=" + enc + "&spd=3&source=web");
        } else if (low.startsWith("ja")) {
            urls.add("https://fanyi.baidu.com/gettts?lan=jp&text=" + enc + "&spd=3&source=web");
            urls.add("https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=ja&q=" + enc);
        } else if (low.startsWith("ko")) {
            urls.add("https://fanyi.baidu.com/gettts?lan=kor&text=" + enc + "&spd=3&source=web");
            urls.add("https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=ko&q=" + enc);
        } else if (low.startsWith("fr")) {
            urls.add("https://fanyi.baidu.com/gettts?lan=fra&text=" + enc + "&spd=3&source=web");
        } else if (low.startsWith("es")) {
            urls.add("https://fanyi.baidu.com/gettts?lan=spa&text=" + enc + "&spd=3&source=web");
        } else if (low.startsWith("de")) {
            urls.add("https://fanyi.baidu.com/gettts?lan=de&text=" + enc + "&spd=3&source=web");
        } else {
            urls.add("https://fanyi.baidu.com/gettts?lan=zh&text=" + enc + "&spd=3&source=web");
        }
        return urls;
    }

    private boolean downloadAudioFile(String urlStr, File dest) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(urlStr).openConnection();
            conn.setInstanceFollowRedirects(true);
            conn.setConnectTimeout(6000);
            conn.setReadTimeout(8000);
            conn.setRequestProperty("User-Agent", DESKTOP_UA);
            if (urlStr.contains("baidu.com")) {
                conn.setRequestProperty("Referer", "https://fanyi.baidu.com/");
            }
            if (conn.getResponseCode() != 200) return false;
            String ct = conn.getContentType();
            if (ct != null && ct.toLowerCase(Locale.ROOT).contains("text/html")) return false;
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            try (InputStream in = new BufferedInputStream(conn.getInputStream())) {
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) != -1) {
                    baos.write(buf, 0, n);
                }
            }
            byte[] bytes = baos.toByteArray();
            if (bytes.length < 800) return false;
            try (FileOutputStream fos = new FileOutputStream(dest)) {
                fos.write(bytes);
                fos.flush();
            }
            return true;
        } catch (Exception e) {
            return false;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private String sha1Hex(String s) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-1");
        byte[] d = md.digest(s.getBytes(StandardCharsets.UTF_8));
        StringBuilder sb = new StringBuilder();
        for (byte b : d) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    @PluginMethod
    public void stopSpeak(PluginCall call) {
        stopFallbackPlayer();
        if (tts != null) tts.stop();
        call.resolve();
    }

    @PluginMethod
    public void downloadMedia(PluginCall call) {
        String rawInput = call.getString("url", "").trim();
        boolean audioOnly = Boolean.TRUE.equals(call.getBoolean("audioOnly", false));
        String cobaltEndpoint = call.getString("cobaltEndpoint", "").trim();

        if (rawInput.isEmpty()) {
            call.reject("链接不能为空");
            return;
        }

        executor.execute(() -> {
            try {
                String cleanUrl = extractUrl(rawInput);
                String lower = cleanUrl.toLowerCase(Locale.ROOT);
                JSObject result;

                if (lower.contains("bilibili.com") || lower.contains("b23.tv") || BV_PATTERN.matcher(rawInput).find()) {
                    result = downloadBilibili(rawInput, cleanUrl);
                } else if (lower.contains("xiaoyuzhoufm.com")) {
                    result = downloadXiaoyuzhou(cleanUrl);
                } else if (lower.matches(".*\\.(mp4|m4a|mp3|wav|webm|ogg)(\\?.*)?$")) {
                    result = downloadDirect(cleanUrl, "direct", null, null);
                } else if (!cobaltEndpoint.isEmpty()) {
                    result = downloadViaCobalt(cobaltEndpoint, cleanUrl, audioOnly);
                } else {
                    throw new Exception("暂不支持该站点自动解析（B站与小宇宙已内置直下；抖音/YouTube可在设置填入 Cobalt 节点或手机录屏导入）");
                }
                call.resolve(result);
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "手机下载失败");
            }
        });
    }

    private String extractUrl(String raw) {
        if (raw == null) return "";
        Matcher m = URL_PATTERN.matcher(raw);
        if (m.find()) {
            return m.group(0).replaceAll("[.,;!?，。！？]+$", "");
        }
        Matcher bv = BV_PATTERN.matcher(raw);
        if (bv.find()) {
            return "https://www.bilibili.com/video/" + bv.group(1);
        }
        return raw.trim();
    }

    private JSObject downloadBilibili(String rawInput, String cleanUrl) throws Exception {
        String bvid = "";
        Matcher bvMatcher = BV_PATTERN.matcher(rawInput + " " + cleanUrl);
        if (bvMatcher.find()) {
            bvid = bvMatcher.group(1);
        }

        // 解析 b23.tv 短链重定向
        if (bvid.isEmpty() && cleanUrl.contains("b23.tv")) {
            String resolved = resolveRedirectUrl(cleanUrl);
            Matcher m2 = BV_PATTERN.matcher(resolved);
            if (m2.find()) bvid = m2.group(1);
        }

        if (bvid.isEmpty()) {
            throw new Exception("未能从链接中识别 B站 BV 号，请复制完整 B站视频链接或 BV 号");
        }

        // 1. 获取标题和 cid
        JSONObject viewResp = new JSONObject(httpGetString(
            "https://api.bilibili.com/x/web-interface/view?bvid=" + bvid,
            "https://www.bilibili.com/",
            DESKTOP_UA
        ));
        if (viewResp.optInt("code", -1) != 0) {
            throw new Exception("B站视频信息获取失败：" + viewResp.optString("message", "请检查链接"));
        }
        JSONObject vData = viewResp.getJSONObject("data");
        String title = vData.optString("title", bvid);
        long cid = vData.optLong("cid", 0);

        // 2. 获取单文件 MP4 播放直链（html5=1 优先返回合并音视频流，手机零转码秒播）
        String playUrl = "";
        String[] endpoints = new String[] {
            "https://api.bilibili.com/x/player/playurl?bvid=" + bvid + "&cid=" + cid + "&qn=64&fnval=1&platform=html5&high_quality=1",
            "https://api.bilibili.com/x/player/playurl?bvid=" + bvid + "&cid=" + cid + "&qn=32&fnval=1"
        };
        for (String ep : endpoints) {
            try {
                JSONObject pResp = new JSONObject(httpGetString(ep, "https://www.bilibili.com/video/" + bvid, DESKTOP_UA));
                JSONArray durl = pResp.optJSONObject("data") != null ? pResp.getJSONObject("data").optJSONArray("durl") : null;
                if (durl != null && durl.length() > 0) {
                    playUrl = durl.getJSONObject(0).optString("url", "");
                    if (!playUrl.isEmpty()) break;
                }
            } catch (Exception ignored) {
            }
        }
        if (playUrl.isEmpty()) {
            throw new Exception("未能解析到 B站免登录播放流（部分大会员/版权番剧受限）");
        }

        // 3. 顺带抓取 B站公开 CC 字幕 JSON（如有）
        String subtitleJson = "";
        try {
            JSONObject subResp = new JSONObject(httpGetString(
                "https://api.bilibili.com/x/player/v2?bvid=" + bvid + "&cid=" + cid,
                "https://www.bilibili.com/video/" + bvid,
                DESKTOP_UA
            ));
            JSONObject sData = subResp.optJSONObject("data");
            JSONObject subObj = sData != null ? sData.optJSONObject("subtitle") : null;
            JSONArray subList = subObj != null ? subObj.optJSONArray("subtitles") : null;
            if (subList != null && subList.length() > 0) {
                String subUrl = subList.getJSONObject(0).optString("subtitle_url", "");
                if (subUrl.startsWith("//")) subUrl = "https:" + subUrl;
                if (!subUrl.isEmpty()) {
                    subtitleJson = httpGetString(subUrl, "https://www.bilibili.com/", DESKTOP_UA);
                }
            }
        } catch (Exception ignored) {
        }

        File saved = downloadToCache(playUrl, ".mp4", "https://www.bilibili.com/video/" + bvid, DESKTOP_UA);
        JSObject ret = new JSObject();
        ret.put("title", title);
        ret.put("sourceType", "B站");
        ret.put("mimeType", "video/mp4");
        ret.put("filePath", saved.getAbsolutePath());
        if (!subtitleJson.isEmpty()) {
            ret.put("subtitleText", subtitleJson);
            ret.put("subtitleFormat", "json");
        }
        return ret;
    }

    private JSObject downloadXiaoyuzhou(String pageUrl) throws Exception {
        String html = httpGetString(pageUrl, "https://www.xiaoyuzhoufm.com/", MOBILE_UA);

        String title = matchGroup(html, "<meta\\s+property=[\"']og:title[\"']\\s+content=[\"']([^\"']+)[\"']");
        if (title.isEmpty()) {
            title = matchGroup(html, "<title>([^<]+)</title>");
        }
        if (title.isEmpty()) title = "小宇宙播客单集";

        String audioUrl = matchGroup(html, "<meta\\s+property=[\"']og:audio[\"']\\s+content=[\"']([^\"']+)[\"']");
        if (audioUrl.isEmpty()) {
            audioUrl = matchGroup(html, "(https?://[^\"'\\s<>]+\\.(?:m4a|mp3)(?:\\?[^\"'\\s<>]*)?)");
        }
        if (audioUrl.isEmpty()) {
            throw new Exception("未能在该小宇宙页面解析到播客音频地址");
        }
        audioUrl = audioUrl.replace("&amp;", "&");
        String ext = audioUrl.toLowerCase(Locale.ROOT).contains(".mp3") ? ".mp3" : ".m4a";
        File saved = downloadToCache(audioUrl, ext, "https://www.xiaoyuzhoufm.com/", MOBILE_UA);

        JSObject ret = new JSObject();
        ret.put("title", title);
        ret.put("sourceType", "小宇宙播客");
        ret.put("mimeType", ext.equals(".mp3") ? "audio/mpeg" : "audio/mp4");
        ret.put("filePath", saved.getAbsolutePath());
        return ret;
    }

    private JSObject downloadViaCobalt(String cobaltEndpoint, String targetUrl, boolean audioOnly) throws Exception {
        String ep = cobaltEndpoint.endsWith("/") ? cobaltEndpoint.substring(0, cobaltEndpoint.length() - 1) : cobaltEndpoint;
        HttpURLConnection conn = (HttpURLConnection) new URL(ep).openConnection();
        conn.setRequestMethod("POST");
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(30000);
        conn.setDoOutput(true);
        conn.setRequestProperty("Content-Type", "application/json");
        conn.setRequestProperty("Accept", "application/json");
        conn.setRequestProperty("User-Agent", DESKTOP_UA);

        JSONObject body = new JSONObject();
        body.put("url", targetUrl);
        body.put("downloadMode", audioOnly ? "audio" : "auto");
        body.put("audioFormat", "mp3");

        try (OutputStream os = conn.getOutputStream()) {
            os.write(body.toString().getBytes(StandardCharsets.UTF_8));
        }

        String respStr = readStream(conn.getResponseCode() < 400 ? conn.getInputStream() : conn.getErrorStream());
        JSONObject resp = new JSONObject(respStr);
        String mediaUrl = resp.optString("url", "");
        if (mediaUrl.isEmpty()) {
            throw new Exception("解析节点返回失败：" + resp.toString());
        }
        String fname = resp.optString("filename", "在线视频素材");
        return downloadDirect(mediaUrl, "在线解析", fname, null);
    }

    private JSObject downloadDirect(String mediaUrl, String sourceType, String titleOverride, String referer) throws Exception {
        String lower = mediaUrl.toLowerCase(Locale.ROOT);
        String ext = ".mp4";
        String mime = "video/mp4";
        if (lower.contains(".mp3")) { ext = ".mp3"; mime = "audio/mpeg"; }
        else if (lower.contains(".m4a")) { ext = ".m4a"; mime = "audio/mp4"; }
        else if (lower.contains(".wav")) { ext = ".wav"; mime = "audio/wav"; }
        else if (lower.contains(".webm")) { ext = ".webm"; mime = "video/webm"; }

        File saved = downloadToCache(mediaUrl, ext, referer, DESKTOP_UA);
        String title = (titleOverride != null && !titleOverride.isEmpty()) ? titleOverride : saved.getName();
        JSObject ret = new JSObject();
        ret.put("title", title);
        ret.put("sourceType", sourceType);
        ret.put("mimeType", mime);
        ret.put("filePath", saved.getAbsolutePath());
        return ret;
    }

    private String resolveRedirectUrl(String shortUrl) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(shortUrl).openConnection();
        conn.setInstanceFollowRedirects(false);
        conn.setRequestProperty("User-Agent", MOBILE_UA);
        conn.setConnectTimeout(12000);
        conn.connect();
        String loc = conn.getHeaderField("Location");
        conn.disconnect();
        return loc != null ? loc : shortUrl;
    }

    private String httpGetString(String urlStr, String referer, String ua) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(urlStr).openConnection();
        conn.setInstanceFollowRedirects(true);
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(20000);
        conn.setRequestProperty("User-Agent", ua);
        if (referer != null && !referer.isEmpty()) {
            conn.setRequestProperty("Referer", referer);
        }
        try (InputStream in = conn.getInputStream()) {
            return readStream(in);
        } finally {
            conn.disconnect();
        }
    }

    private File downloadToCache(String urlStr, String ext, String referer, String ua) throws Exception {
        File dir = new File(getContext().getCacheDir(), "echodeck_dl");
        if (!dir.exists()) dir.mkdirs();
        File out = new File(dir, "dl_" + System.currentTimeMillis() + ext);

        HttpURLConnection conn = (HttpURLConnection) new URL(urlStr).openConnection();
        conn.setInstanceFollowRedirects(true);
        conn.setConnectTimeout(20000);
        conn.setReadTimeout(120000);
        conn.setRequestProperty("User-Agent", ua);
        if (referer != null && !referer.isEmpty()) {
            conn.setRequestProperty("Referer", referer);
        }

        int code = conn.getResponseCode();
        if (code >= 400) {
            conn.disconnect();
            throw new Exception("媒体流下载被拒绝 (HTTP " + code + ")");
        }

        try (InputStream in = new BufferedInputStream(conn.getInputStream());
             FileOutputStream fos = new FileOutputStream(out)) {
            byte[] buf = new byte[16384];
            int len;
            while ((len = in.read(buf)) != -1) {
                fos.write(buf, 0, len);
            }
            fos.flush();
        } finally {
            conn.disconnect();
        }
        return out;
    }

    private String readStream(InputStream in) throws Exception {
        if (in == null) return "";
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int len;
        while ((len = in.read(buf)) != -1) {
            baos.write(buf, 0, len);
        }
        return baos.toString(StandardCharsets.UTF_8.name());
    }

    private String matchGroup(String text, String regex) {
        Matcher m = Pattern.compile(regex, Pattern.CASE_INSENSITIVE).matcher(text);
        return m.find() ? m.group(1).trim() : "";
    }
}
