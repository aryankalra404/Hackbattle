using System.Collections;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using SocketIOClient;
using UnityEngine;

/// <summary>
/// Drives each wired LED's VirtualLed according to the last
/// `code:simulate-result` from socket-server (compile with the real Arduino
/// toolchain, then deterministically work out which LEDs light up or blink —
/// see socket-server/compile and socket-server/simulate). Purely visual: it
/// never touches PinPoint fault highlighting or circuit diagnosis state,
/// same separation QuestCircuitBridge already keeps for VirtualLed.
///
/// Works on any LED with a CircuitComponent (dynamically spawned or placed
/// in the scene) — if it has no VirtualLed yet, one is added automatically,
/// which finds a Renderer on itself or a child to drive.
/// </summary>
public class SimulationLedController : MonoBehaviour
{
    [SerializeField] private QuestCircuitBridge bridge;

    private readonly object pendingLock = new object();
    private JArray pendingLeds;
    private bool hasPendingResult;
    private bool subscribed;

    private readonly Dictionary<string, Coroutine> activeBlinks = new Dictionary<string, Coroutine>();

    private void Start()
    {
        if (bridge == null) bridge = GetComponent<QuestCircuitBridge>();
    }

    private void Update()
    {
        if (bridge == null || bridge.Socket == null) return;
        if (!subscribed)
        {
            bridge.Socket.On("code:simulate-result", OnSimulateResult);
            subscribed = true;
        }
        ApplyPendingResult();
    }

    // Runs on a background thread (same as every other socket callback in
    // this project) — only queue here, apply from Update().
    private void OnSimulateResult(SocketIOResponse response)
    {
        JObject payload = response.GetValue<JObject>();
        if (payload == null) return;
        if (payload.Value<bool?>("ok") != true) return; // compile failed; nothing to simulate
        if (payload.Value<string>("stage") != "simulate") return;

        lock (pendingLock)
        {
            pendingLeds = payload["leds"] as JArray;
            hasPendingResult = true;
        }
    }

    private void ApplyPendingResult()
    {
        JArray leds;
        lock (pendingLock)
        {
            if (!hasPendingResult) return;
            leds = pendingLeds;
            hasPendingResult = false;
        }
        ApplyLeds(leds);
    }

    private void ApplyLeds(JArray leds)
    {
        // Clear every previous blink loop and turn every LED off before
        // applying the fresh result, so an LED that no longer appears (the
        // code changed, or it doesn't compile) doesn't stay stuck lit.
        foreach (Coroutine routine in activeBlinks.Values) StopCoroutine(routine);
        activeBlinks.Clear();
        foreach (CircuitComponent component in FindObjectsByType<CircuitComponent>(FindObjectsSortMode.None))
        {
            if (component.Type == CircuitComponent.ComponentType.Led) GetOrAddVirtualLed(component).SetLit(false);
        }

        if (leds == null) return;
        foreach (JToken entry in leds)
        {
            string ledId = entry.Value<string>("ledId");
            string pattern = entry.Value<string>("pattern");
            CircuitComponent component = FindLed(ledId);
            if (component == null) continue;
            VirtualLed virtualLed = GetOrAddVirtualLed(component);

            if (pattern == "on")
            {
                virtualLed.SetLit(true);
            }
            else if (pattern == "blink")
            {
                int onMs = entry.Value<int?>("onMs") ?? 500;
                int offMs = entry.Value<int?>("offMs") ?? 500;
                activeBlinks[ledId] = StartCoroutine(BlinkLoop(virtualLed, onMs, offMs));
            }
            // 'off' and unclassified 'pattern' results leave the LED off.
        }
    }

    private IEnumerator BlinkLoop(VirtualLed virtualLed, int onMs, int offMs)
    {
        while (true)
        {
            virtualLed.SetLit(true);
            yield return new WaitForSeconds(onMs / 1000f);
            virtualLed.SetLit(false);
            yield return new WaitForSeconds(offMs / 1000f);
        }
    }

    private static CircuitComponent FindLed(string id)
    {
        foreach (CircuitComponent component in FindObjectsByType<CircuitComponent>(FindObjectsSortMode.None))
        {
            if (component.Type == CircuitComponent.ComponentType.Led && component.Id == id) return component;
        }
        return null;
    }

    private static VirtualLed GetOrAddVirtualLed(CircuitComponent component)
    {
        VirtualLed existing = component.GetComponentInChildren<VirtualLed>();
        return existing != null ? existing : component.gameObject.AddComponent<VirtualLed>();
    }
}
