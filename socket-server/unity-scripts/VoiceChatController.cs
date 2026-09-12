using System;
using System.Collections;
using System.IO;
using System.Text;
using Newtonsoft.Json.Linq;
using SocketIOClient;
using UnityEngine;
using UnityEngine.Networking;
#if UNITY_ANDROID && !UNITY_EDITOR
using UnityEngine.Android;
#endif

/// <summary>
/// Push-to-talk voice chat with CircuitDoctor, entirely on-device: hold the
/// configured button (or pinch, for hand-tracking with no controllers) to
/// record, release to send. The reply is spoken back
/// through this GameObject's AudioSource — since that playback happens
/// inside the Quest app itself, it comes out of the headset's own speakers
/// automatically, the same as any other Unity audio. No laptop involved.
///
/// Reuses QuestCircuitBridge's socket/session rather than opening a second
/// connection. Saying "commit this" (with an optional message) is handled
/// server-side (socket-server/server.js `chat:voice`) — it commits the
/// current build and speaks back a confirmation instead of an answer.
/// </summary>
public class VoiceChatController : MonoBehaviour
{
    [Header("Wiring")]
    [Tooltip("Provides the connected socket and session id. Usually the same GameObject (WireManager).")]
    [SerializeField] private QuestCircuitBridge bridge;
    [Tooltip("Where the spoken reply plays. Put this on something that stays near the user's ear, e.g. the camera rig.")]
    [SerializeField] private AudioSource replySource;

    [Header("Push to talk")]
    [SerializeField] private OVRInput.Button talkButton = OVRInput.Button.One;
    [Tooltip("Also start/stop recording on an index-finger pinch, for hand-tracking setups with no controllers.")]
    [SerializeField] private bool allowPinchToTalk = true;
    [SerializeField] private int maxRecordingSeconds = 20;
    [SerializeField] private int sampleRate = 16000;

    private AudioClip recordingClip;
    private bool isRecording;
    private string microphoneDevice;
    private OVRHand[] hands;
    private bool wasPinching;

    // Socket.IO callbacks fire on a background thread (same as QuestCircuitBridge's
    // pending-result pattern), so a reply is queued here and only played from Update().
    private readonly object pendingReplyLock = new object();
    private string pendingReplyAudioUrl;
    private bool hasPendingReply;

    private void Awake()
    {
        RequestMicrophonePermission();
    }

    private void RequestMicrophonePermission()
    {
#if UNITY_ANDROID && !UNITY_EDITOR
        if (!Permission.HasUserAuthorizedPermission(Permission.Microphone))
        {
            Permission.RequestUserPermission(Permission.Microphone);
        }
#endif
    }

    private void Start()
    {
        if (bridge == null) bridge = GetComponent<QuestCircuitBridge>();
        if (bridge == null)
        {
            Debug.LogError("[VoiceChatController] Assign QuestCircuitBridge (usually the same GameObject as WireManager).");
            enabled = false;
            return;
        }
        if (replySource == null) replySource = gameObject.AddComponent<AudioSource>();

        if (Microphone.devices.Length == 0)
        {
            Debug.LogError("[VoiceChatController] No microphone device found.");
            enabled = false;
            return;
        }
        microphoneDevice = Microphone.devices[0];

        if (allowPinchToTalk) hands = FindObjectsByType<OVRHand>(FindObjectsSortMode.None);
    }

    private void Update()
    {
        ApplyPendingReply();

        if (bridge.Socket == null) return; // QuestCircuitBridge creates it asynchronously in its own Start().
        if (!subscribed)
        {
            bridge.Socket.On("chat:voice-response", OnVoiceResponse);
            subscribed = true;
        }
        if (!bridge.Socket.Connected) return;

        bool pinching = allowPinchToTalk && IsAnyHandPinching();
        bool talkPressed = OVRInput.GetDown(talkButton) || (pinching && !wasPinching);
        bool talkReleased = OVRInput.GetUp(talkButton) || (!pinching && wasPinching);
        wasPinching = pinching;

        if (talkPressed && !isRecording)
        {
            StartRecording();
        }
        else if (talkReleased && isRecording)
        {
            StopRecordingAndSend();
        }
    }

    // Pinch (thumb + index) stands in for a controller button when the user
    // has no controllers, mirroring OVRInput's own GetDown/GetUp edge check.
    private bool IsAnyHandPinching()
    {
        if (hands == null || hands.Length == 0) return false;
        foreach (OVRHand hand in hands)
        {
            if (hand != null && hand.IsTracked && hand.GetFingerIsPinching(OVRHand.HandFinger.Index)) return true;
        }
        return false;
    }

    private void ApplyPendingReply()
    {
        string audioUrl = null;
        lock (pendingReplyLock)
        {
            if (hasPendingReply)
            {
                audioUrl = pendingReplyAudioUrl;
                hasPendingReply = false;
                pendingReplyAudioUrl = null;
            }
        }
        if (audioUrl != null) StartCoroutine(PlayReply(audioUrl));
    }

    // Socket.IO client has no HasListener check, so subscribe exactly once (guarded in Update) rather than per-press.
    private bool subscribed;

    private void StartRecording()
    {
        isRecording = true;
        recordingClip = Microphone.Start(microphoneDevice, false, maxRecordingSeconds, sampleRate);
        Debug.Log("[VoiceChatController] Recording... release to send.");
    }

    private void StopRecordingAndSend()
    {
        isRecording = false;
        int position = Microphone.GetPosition(microphoneDevice);
        Microphone.End(microphoneDevice);

        if (recordingClip == null || position <= 0)
        {
            Debug.LogWarning("[VoiceChatController] No audio captured.");
            return;
        }

        float[] samples = new float[position * recordingClip.channels];
        recordingClip.GetData(samples, 0);

        byte[] wav = EncodeWav(samples, recordingClip.channels, recordingClip.frequency);
        string base64 = Convert.ToBase64String(wav);
        Debug.Log($"[VoiceChatController] Sending {wav.Length} bytes of audio ({base64.Length} base64 chars).");

        if (base64.Length > 2 * 1024 * 1024)
        {
            Debug.LogWarning("[VoiceChatController] Recording too long for the 2MB limit; trim maxRecordingSeconds.");
            return;
        }

        bridge.Socket.Emit("chat:voice", new JObject
        {
            ["sessionId"] = bridge.SessionId,
            ["audioUrl"] = $"data:audio/wav;base64,{base64}",
            ["voiceReply"] = true
        });
    }

    private void OnVoiceResponse(SocketIOResponse response)
    {
        JObject payload = response.GetValue<JObject>();
        if (payload == null) return;

        string transcript = payload.Value<string>("transcript");
        string message = payload.Value<string>("message");
        string audioUrl = payload.Value<string>("audioUrl");
        Debug.Log($"[VoiceChatController] Heard: \"{transcript}\" -> \"{message}\"");

        if (!string.IsNullOrEmpty(audioUrl))
        {
            lock (pendingReplyLock)
            {
                pendingReplyAudioUrl = audioUrl;
                hasPendingReply = true;
            }
        }
    }

    private IEnumerator PlayReply(string audioDataUrl)
    {
        int comma = audioDataUrl.IndexOf(',');
        if (comma < 0) yield break;
        byte[] mp3 = Convert.FromBase64String(audioDataUrl.Substring(comma + 1));

        string path = Path.Combine(Application.temporaryCachePath, "circuitdoctor-reply.mp3");
        File.WriteAllBytes(path, mp3);

        using (UnityWebRequest request = UnityWebRequestMultimedia.GetAudioClip("file://" + path, AudioType.MPEG))
        {
            yield return request.SendWebRequest();
            if (request.result != UnityWebRequest.Result.Success)
            {
                Debug.LogError($"[VoiceChatController] Could not decode reply audio: {request.error}");
                yield break;
            }

            AudioClip clip = DownloadHandlerAudioClip.GetContent(request);
            replySource.clip = clip;
            replySource.Play();
        }
    }

    private static byte[] EncodeWav(float[] samples, int channels, int frequency)
    {
        short[] pcm = new short[samples.Length];
        for (int i = 0; i < samples.Length; i++)
        {
            float clamped = Mathf.Clamp(samples[i], -1f, 1f);
            pcm[i] = (short)(clamped * short.MaxValue);
        }

        int dataSize = pcm.Length * sizeof(short);
        using (MemoryStream stream = new MemoryStream())
        using (BinaryWriter writer = new BinaryWriter(stream, Encoding.ASCII))
        {
            writer.Write(Encoding.ASCII.GetBytes("RIFF"));
            writer.Write(36 + dataSize);
            writer.Write(Encoding.ASCII.GetBytes("WAVE"));
            writer.Write(Encoding.ASCII.GetBytes("fmt "));
            writer.Write(16); // PCM header size
            writer.Write((short)1); // PCM format
            writer.Write((short)channels);
            writer.Write(frequency);
            writer.Write(frequency * channels * sizeof(short)); // byte rate
            writer.Write((short)(channels * sizeof(short))); // block align
            writer.Write((short)16); // bits per sample
            writer.Write(Encoding.ASCII.GetBytes("data"));
            writer.Write(dataSize);
            foreach (short sample in pcm) writer.Write(sample);
            return stream.ToArray();
        }
    }
}
