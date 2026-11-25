package app.echodeck.mobile;

import android.content.Intent;
import android.os.Bundle;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(EchoDeckNativePlugin.class);
        registerPlugin(EchoDeckLocalLlmPlugin.class);
        super.onCreate(savedInstanceState);
        EchoDeckNativePlugin.captureIntent(getIntent());

        // 旗舰级统一返回手势/返回键调度栈：
        // 1) 全屏观影中 -> 退出全屏恢复竖屏
        // 2) 非全屏状态 -> 派发 echodeck:hardware-back 交由前端按层级优雅关闭（AI助教 -> 导览 -> 影厅播放页 -> 回首页 -> 双击退后台），绝不误杀 App
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (getBridge() != null && getBridge().getWebView() != null) {
                    if (EchoDeckNativePlugin.isFullscreenActive) {
                        getBridge().getWebView().evaluateJavascript(
                            "window.dispatchEvent(new CustomEvent('echodeck:exit-fullscreen'));",
                            null
                        );
                        return;
                    }
                    getBridge().getWebView().evaluateJavascript(
                        "window.dispatchEvent(new CustomEvent('echodeck:hardware-back'));",
                        null
                    );
                    return;
                }
                moveTaskToBack(true);
            }
        });
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        EchoDeckNativePlugin.captureIntent(intent);
    }
}
