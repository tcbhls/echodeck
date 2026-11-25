package app.echodeck.mobile;

import org.junit.Test;
import static org.junit.Assert.assertEquals;

/**
 * 校验 EdgeNeuralTts.generateSecMsGecV2 与官方 edge-tts Python 实现的签名逐字节一致。
 */
public class EdgeNeuralTtsTest {
    @Test
    public void secMsGecV2MatchesGoldenVector() {
        String actual = EdgeNeuralTts.generateSecMsGecV2(1700000000L);
        assertEquals(
            "2CD23A2CA0B2595A-F3C846C370E05F9CC83ACC5F995C5F5D87A4D0F14CE8936A0F902E64099E38A2",
            actual
        );
    }
}
