using System;
using System.Collections;
using System.IO;
using Newtonsoft.Json.Linq;
using SocketIOClient;
using UnityEngine;
using UnityEngine.Networking;

/// <summary>
/// Speaks CircuitDoctor's replies out of the headset. Talking to CircuitDoctor
/// happens from the web dashboard (hold Space to record on the laptop mic,
/// socket-server/server.js `chat:voice`) — this component only listens for
/// the resulting `chat:voice-response` and plays the reply through this
/// GameObject's AudioSource, so it comes out of the Quest's own speakers.
///
/// Reuses QuestCircuitBridge's socket/session rather than opening a second
/// connection.
/// </summary>
public class VoiceChatController : MonoBehaviour
{
    [Header("Wiring")]
    [Tooltip("Provides the connected socket and session id. Usually the same GameObject (WireManager).")]
    [SerializeField] private QuestCircuitBridge bridge;
    [Tooltip("Where the spoken reply plays. Put this on something that stays near the user's ear, e.g. the camera rig.")]
    [SerializeField] private AudioSource replySource;

    // Socket.IO callbacks fire on a background thread (same as QuestCircuitBridge's
    // pending-result pattern), so a reply is queued here and only played from Update().
    private readonly object pendingReplyLock = new object();
    private string pendingReplyAudioUrl;
    private bool hasPendingReply;

    // Socket.IO client has no HasListener check, so subscribe exactly once (guarded in Update).
    private bool subscribed;

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
}
