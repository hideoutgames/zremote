#if SKIP
import SwiftUI
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.SoundPool
import android.content.Context
import android.view.HapticFeedbackConstants
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView

/* SKIP @nobridge */
struct AndroidHapticsModifier: ContentModifier {
    let enabled: Bool
    let soundsEnabled: Bool
    let serial: Int
    let event: String
    let soundPaths: [String]

    func modify(view: any View) -> any View {
        ComposeView { context in
            let nativeView = LocalView.current
            let nativeContext = LocalContext.current
            let observed = remember { mutableStateOf(serial) }
            let pool = remember {
                SoundPool.Builder().setMaxStreams(3).setAudioAttributes(
                    AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()).build()
            }
            // SKIP INSERT: val soundIds = remember(soundPaths) { soundPaths.map { path -> if (path.isEmpty()) 0 else pool.load(path, 1) } }
            // SKIP INSERT: DisposableEffect(pool) { onDispose { pool.release() } }
            LaunchedEffect(serial) {
                if observed.value != serial {
                    observed.value = serial
                    if enabled { nativeView.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK) }
                    // Follow silent/vibrate mode as well as the account preference.
                    // SKIP INSERT: val audioManager = nativeContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
                    if soundsEnabled && audioManager.ringerMode == AudioManager.RINGER_MODE_NORMAL {
                        let index = ["send", "voiceStart", "voiceFinish", "refresh", "finished"].firstIndex(of: event)
                        if let index {
                            // SKIP INSERT: pool.play(soundIds[index], 0.6f, 0.6f, 1, 0, 1.0f)
                        }
                    }
                }
            }
            view.Compose(context: context)
        }
    }
}
#endif
