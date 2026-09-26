import AVFoundation

/// The iPhone app plays through the web page's <audio> element (WKWebView);
/// there is no native player like Android's Media3 one. What keeps that
/// music going with the screen locked or another app open is this: the
/// `audio` background mode (Info.plist) plus an audio session in the
/// playback category. The default category (solo ambient) is silenced by the
/// ring/silent switch and stops when the app leaves the screen.
///
/// Only the category is set at launch. The session is not activated here, so
/// opening Ember does not stop a podcast that is already playing; WebKit
/// activates it when a song starts.
enum AudioSession {
    static func configure(_ session: AVAudioSession = .sharedInstance()) {
        do {
            try session.setCategory(.playback, mode: .default, options: [])
        } catch {
            NSLog("[Ember] audio session: could not set the playback category: \(error)")
        }
    }
}
