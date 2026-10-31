// DiscordSdkBridge's native half: rich presence through the Social SDK's public
// C++ API (discordpp.h), with no sign-in: SetApplicationId, then
// UpdateRichPresence, which reaches the Discord app on the phone.
//
// All of it runs on NativeDiscordEngine's one thread. Answers are kept here and
// collected after RunCallbacks instead of calling back into Java from inside
// an SDK callback.
#define DISCORDPP_IMPLEMENTATION
#include "discordpp.h"

#include <jni.h>

#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

namespace {

std::unique_ptr<discordpp::Client> client;
std::mutex answers_lock;
std::vector<std::string> answers;

std::optional<std::string> bytes_to_string(JNIEnv* env, jbyteArray bytes) {
    if (bytes == nullptr) return std::nullopt;
    const jsize size = env->GetArrayLength(bytes);
    std::string out(static_cast<size_t>(size), '\0');
    env->GetByteArrayRegion(bytes, 0, size, reinterpret_cast<jbyte*>(out.data()));
    return out;
}

// NewStringUTF wants modified UTF-8; an error text is only ever logged.
std::string ascii(const std::string& text) {
    std::string out = text;
    for (char& c : out) {
        const auto u = static_cast<unsigned char>(c);
        if (u >= 0x80 || u < 0x20) c = '?';
    }
    return out;
}

}  // namespace

extern "C" JNIEXPORT jboolean JNICALL
Java_app_ember_music_DiscordSdkBridge_nativeCreate(JNIEnv*, jobject, jlong app_id) {
    if (client) return JNI_TRUE;
    client = std::make_unique<discordpp::Client>();
    client->SetApplicationId(static_cast<uint64_t>(app_id));
    return JNI_TRUE;
}

extern "C" JNIEXPORT void JNICALL
Java_app_ember_music_DiscordSdkBridge_nativeUpdate(JNIEnv* env, jobject, jlong token, jbyteArray details,
                                                   jbyteArray state, jbyteArray large_text,
                                                   jbyteArray large_image, jlong start_ms, jlong end_ms) {
    if (!client) return;
    discordpp::Activity activity;
    activity.SetType(discordpp::ActivityTypes::Listening);
    activity.SetDetails(bytes_to_string(env, details));
    activity.SetState(bytes_to_string(env, state));

    discordpp::ActivityAssets assets;
    assets.SetLargeText(bytes_to_string(env, large_text));
    assets.SetLargeImage(bytes_to_string(env, large_image));
    activity.SetAssets(assets);

    discordpp::ActivityTimestamps timestamps;
    timestamps.SetStart(static_cast<uint64_t>(start_ms));
    if (end_ms > 0) timestamps.SetEnd(static_cast<uint64_t>(end_ms));
    activity.SetTimestamps(timestamps);

    const long long id = token;
    client->UpdateRichPresence(std::move(activity), [id](discordpp::ClientResult result) {
        std::string line = std::to_string(id);
        if (result.Successful()) {
            line += "\t1\t";
        } else {
            line += "\t0\t" + std::to_string(result.ErrorCode()) + " " + ascii(result.Error());
        }
        std::lock_guard<std::mutex> hold(answers_lock);
        answers.push_back(std::move(line));
    });
}

extern "C" JNIEXPORT void JNICALL
Java_app_ember_music_DiscordSdkBridge_nativeClear(JNIEnv*, jobject) {
    if (client) client->ClearRichPresence();
}

extern "C" JNIEXPORT jobjectArray JNICALL
Java_app_ember_music_DiscordSdkBridge_nativePump(JNIEnv* env, jobject) {
    discordpp::RunCallbacks();
    std::vector<std::string> taken;
    {
        std::lock_guard<std::mutex> hold(answers_lock);
        taken.swap(answers);
    }
    if (taken.empty()) return nullptr;
    jclass string_class = env->FindClass("java/lang/String");
    if (string_class == nullptr) return nullptr;
    jobjectArray out = env->NewObjectArray(static_cast<jsize>(taken.size()), string_class, nullptr);
    if (out == nullptr) return nullptr;
    for (size_t i = 0; i < taken.size(); ++i) {
        jstring s = env->NewStringUTF(taken[i].c_str());
        env->SetObjectArrayElement(out, static_cast<jsize>(i), s);
        env->DeleteLocalRef(s);
    }
    return out;
}
