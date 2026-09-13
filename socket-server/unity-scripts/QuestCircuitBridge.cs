using System;
using System.Collections;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using SocketIOClient;
using SocketIOClient.Newtonsoft.Json;
using UnityEngine;

/// <summary>
/// Sends the physical CircuitGraph to the CircuitDoctor Socket.IO bridge.
/// Attach this to WireManager and configure component lists in the Inspector.
/// </summary>
public class QuestCircuitBridge : MonoBehaviour
{
    [Serializable]
    public class LedDefinition
    {
        [Tooltip("Must match the server component ID, e.g. led-1.")]
        public string id = "led-1";
        [Tooltip("Long leg / anode PinPoint. Assign LED1_L1 for LED 1.")]
        public PinPoint anode;
        [Tooltip("Short leg / cathode PinPoint. Assign LED1_L2 for LED 1.")]
        public PinPoint cathode;
        [Tooltip("Optional visual LED. QuestCircuitBridge keeps it off and does not subscribe to simulation:led events.")]
        public VirtualLed virtualLed;
    }

    [Serializable]
    public class ResistorDefinition
    {
        [Tooltip("Must match the server component ID, e.g. resistor-1.")]
        public string id = "resistor-1";
        [Tooltip("First resistor terminal PinPoint, e.g. RES1_R1.")]
        public PinPoint a;
        [Tooltip("Second resistor terminal PinPoint, e.g. RES1_R2.")]
        public PinPoint b;
    }

    public class PirDefinition
    {
        [Tooltip("Must match the server component ID, e.g. pir-1.")]
        public string id = "pir-1";
        public PinPoint vcc;
        public PinPoint signal;
        public PinPoint gnd;
    }

    [Header("Laptop bridge - use your laptop's Wi-Fi IP, never localhost")]
    [SerializeField] private string bridgeUrl = "http://192.168.1.5:3001";
    [SerializeField] private string sessionId = "demo-room";

    [Header("Existing circuit system")]
    [SerializeField] private CircuitGraph circuitGraph;
    [Tooltip("Same GameObject as CircuitGraph in the current setup. Needed to clear/rebuild wires on commit:restore.")]
    [SerializeField] private WireManager wireManager;
    [Tooltip("Needed to respawn components at their saved position/rotation on commit:restore.")]
    [SerializeField] private CircuitComponentSpawner spawner;
    [Tooltip("The board whose own transform is saved/restored alongside components, e.g. the Arduino. Auto-found by name if left empty.")]
    [SerializeField] private Transform boardRoot;
    [SerializeField] private string boardRootName = "Arduino";

    [Header("Circuit components — configure these lists in the Inspector")]
    [Tooltip("Add led-1, led-2, led-3 and assign LED1_L1/L2, LED2_L1/L2, LED3_L1/L2 plus each virtual LED.")]
    [SerializeField] private List<LedDefinition> leds = new List<LedDefinition>();
    [Tooltip("Add resistor-1, resistor-2, resistor-3 and assign RES1_R1/R2, RES2_R1/R2, RES3_R1/R2.")]
    [SerializeField] private List<ResistorDefinition> resistors = new List<ResistorDefinition>();
    [Tooltip("Add pir-1 and assign PIR_VCC, PIR_SIGNAL, and PIR_GND.")]
    [SerializeField] private List<PirDefinition> pirSensors = new List<PirDefinition>();

    private SocketIOUnity socket;
    /// <summary>Shared with VoiceChatController, so voice chat reuses this connection/session instead of opening a second one.</summary>
    public SocketIOUnity Socket => socket;
    public string SessionId => sessionId;
    private string lastCircuitJson = "";
    private readonly HashSet<PinPoint> faultHighlightedPins = new HashSet<PinPoint>();
    private readonly object pendingCircuitResultLock = new object();
    private bool hasPendingCircuitResult;
    private bool pendingCircuitOk;
    private string pendingCircuitMessage;
    private string pendingSuspectedComponent;
    private List<string> pendingSuspectedComponents = new List<string>();
    private string pendingConfidence;
    private string pendingGroundedOn;

    private readonly object pendingRestoreLock = new object();
    private JObject pendingRestorePayload;
    private bool hasPendingRestore;

    private void Awake()
    {
        // Virtual LEDs are intentionally visual-only and remain off. Circuit
        // diagnosis never controls them, and simulation:led is not subscribed.
        SetAllVirtualLedsOff();
    }

    private async void Start()
    {
        if (circuitGraph == null) circuitGraph = GetComponent<CircuitGraph>();
        if (circuitGraph == null)
        {
            Debug.LogError("[QuestCircuitBridge] Assign the CircuitGraph on WireManager.");
            enabled = false;
            return;
        }
        if (wireManager == null) wireManager = GetComponent<WireManager>();
        if (spawner == null) spawner = FindFirstObjectByType<CircuitComponentSpawner>();
        if (boardRoot == null && !string.IsNullOrWhiteSpace(boardRootName))
        {
            GameObject found = GameObject.Find(boardRootName);
            if (found != null) boardRoot = found.transform;
        }

        socket = new SocketIOUnity(new Uri(bridgeUrl), new SocketIOOptions
        {
            Transport = SocketIOClient.Transport.TransportProtocol.WebSocket
        });
        socket.JsonSerializer = new NewtonsoftJsonSerializer();
        socket.On("circuit:result", OnCircuitResult);
        socket.On("commit:restore", OnCommitRestore);

        try
        {
            await socket.ConnectAsync();
            socket.Emit("session:join", new { sessionId });
            StartCoroutine(SendCircuitWhenChanged());
            Debug.Log($"[QuestCircuitBridge] Connected to {bridgeUrl}, session {sessionId}.");
        }
        catch (Exception error)
        {
            Debug.LogError($"[QuestCircuitBridge] Could not connect: {error.Message}");
        }
    }

    private void SetAllVirtualLedsOff()
    {
        foreach (LedDefinition led in leds)
        {
            if (led != null && led.virtualLed != null) led.virtualLed.SetLit(false);
        }
    }

    private IEnumerator SendCircuitWhenChanged()
    {
        while (enabled)
        {
            SendCircuitIfChanged();
            yield return new WaitForSeconds(0.2f);
        }
    }

    private void Update()
    {
        // circuit:result only changes PinPoint fault-highlight visuals.
        // VirtualLed state is intentionally not controlled by this bridge.
        ApplyPendingCircuitResult();
        ApplyPendingRestore();
    }

    private void ApplyPendingCircuitResult()
    {
        // This branch must never call VirtualLed.SetLit.
        // It is strictly for persistent PinPoint fault highlighting.
        bool hasCircuitResult;
        bool circuitOk;
        string circuitMessage;
        List<string> suspectedComponents;
        string confidence;
        string groundedOn;
        lock (pendingCircuitResultLock)
        {
            hasCircuitResult = hasPendingCircuitResult;
            circuitOk = pendingCircuitOk;
            circuitMessage = pendingCircuitMessage;
            suspectedComponents = new List<string>(pendingSuspectedComponents);
            confidence = pendingConfidence;
            groundedOn = pendingGroundedOn;
            hasPendingCircuitResult = false;
        }
        if (hasCircuitResult) ApplyFaultHighlightResult(circuitOk, circuitMessage, suspectedComponents, confidence, groundedOn);
    }

    private void SendCircuitIfChanged()
    {
        if (socket == null || !socket.Connected) return;
        JObject circuit = BuildCircuit();
        string json = circuit.ToString(Newtonsoft.Json.Formatting.None);
        if (json == lastCircuitJson) return;

        lastCircuitJson = json;
        socket.Emit("circuit:update", new JObject
        {
            ["sessionId"] = sessionId,
            ["circuit"] = circuit
        });
    }

    private JObject BuildCircuit()
    {
        JArray components = new JArray();

        // Components created from the UI are discovered at runtime. This avoids
        // a manually maintained Inspector list and lets every spawned prefab
        // receive its own ID and terminal IDs.
        CircuitComponent[] runtimeComponents = UnityEngine.Object.FindObjectsByType<CircuitComponent>(FindObjectsSortMode.None);
        if (runtimeComponents.Length > 0)
        {
            foreach (CircuitComponent component in runtimeComponents)
            {
                if (component == null || !component.IsConfigured()) continue;
                JObject entry;
                switch (component.Type)
                {
                    case CircuitComponent.ComponentType.Led:
                        entry = new JObject { ["id"] = component.Id, ["type"] = "led", ["anode"] = component.Anode.pinId, ["cathode"] = component.Cathode.pinId };
                        break;
                    case CircuitComponent.ComponentType.Resistor:
                        entry = new JObject { ["id"] = component.Id, ["type"] = "resistor", ["a"] = component.TerminalA.pinId, ["b"] = component.TerminalB.pinId };
                        break;
                    case CircuitComponent.ComponentType.Pir:
                        entry = new JObject { ["id"] = component.Id, ["type"] = "pir", ["vcc"] = component.Vcc.pinId, ["signal"] = component.Signal.pinId, ["gnd"] = component.Gnd.pinId };
                        break;
                    case CircuitComponent.ComponentType.Motor:
                        entry = new JObject { ["id"] = component.Id, ["type"] = "motor", ["positive"] = component.MotorPositive.pinId, ["negative"] = component.MotorNegative.pinId };
                        break;
                    case CircuitComponent.ComponentType.Ultrasonic:
                        entry = new JObject { ["id"] = component.Id, ["type"] = "ultrasonic", ["vcc"] = component.UltrasonicVcc.pinId, ["trig"] = component.UltrasonicTrig.pinId, ["echo"] = component.UltrasonicEcho.pinId, ["gnd"] = component.UltrasonicGnd.pinId };
                        break;
                    default:
                        continue;
                }
                entry["pos"] = ToJson(component.transform.position);
                entry["rot"] = ToJson(component.transform.rotation);
                components.Add(entry);
            }
        }
        else
        {
            AddInspectorConfiguredComponents(components);
        }

        // Existing CircuitGraph wire serialization is deliberately unchanged.
        JArray wires = new JArray();
        foreach (Connection connection in circuitGraph.connections)
        {
            if (connection.pinA == null || connection.pinB == null) continue;
            wires.Add(new JObject { ["from"] = connection.pinA.pinId, ["to"] = connection.pinB.pinId });
        }

        JObject circuit = new JObject { ["components"] = components, ["wires"] = wires };
        if (boardRoot != null)
        {
            circuit["board"] = new JObject { ["pos"] = ToJson(boardRoot.position), ["rot"] = ToJson(boardRoot.rotation) };
        }
        return circuit;
    }

    private static JObject ToJson(Vector3 v) => new JObject { ["x"] = v.x, ["y"] = v.y, ["z"] = v.z };
    private static JObject ToJson(Quaternion q) => new JObject { ["x"] = q.x, ["y"] = q.y, ["z"] = q.z, ["w"] = q.w };
    private static Vector3 ToVector3(JObject json, Vector3 fallback)
    {
        if (json == null) return fallback;
        return new Vector3(json.Value<float>("x"), json.Value<float>("y"), json.Value<float>("z"));
    }
    private static Quaternion ToQuaternion(JObject json, Quaternion fallback)
    {
        if (json == null) return fallback;
        return new Quaternion(json.Value<float>("x"), json.Value<float>("y"), json.Value<float>("z"), json.Value<float>("w"));
    }

    private void AddInspectorConfiguredComponents(JArray components)
    {
        foreach (LedDefinition led in leds)
        {
            if (!HasPins(led != null ? led.id : null, led != null ? led.anode : null, led != null ? led.cathode : null)) continue;
            components.Add(new JObject
            {
                ["id"] = led.id,
                ["type"] = "led",
                ["anode"] = led.anode.pinId,
                ["cathode"] = led.cathode.pinId
            });
        }

        foreach (ResistorDefinition resistor in resistors)
        {
            if (!HasPins(resistor != null ? resistor.id : null, resistor != null ? resistor.a : null, resistor != null ? resistor.b : null)) continue;
            components.Add(new JObject
            {
                ["id"] = resistor.id,
                ["type"] = "resistor",
                ["a"] = resistor.a.pinId,
                ["b"] = resistor.b.pinId
            });
        }

        foreach (PirDefinition pir in pirSensors)
        {
            if (!HasPins(pir != null ? pir.id : null, pir != null ? pir.vcc : null, pir != null ? pir.signal : null, pir != null ? pir.gnd : null)) continue;
            components.Add(new JObject
            {
                ["id"] = pir.id,
                ["type"] = "pir",
                ["vcc"] = pir.vcc.pinId,
                ["signal"] = pir.signal.pinId,
                ["gnd"] = pir.gnd.pinId
            });
        }

    }

    private static bool HasPins(string componentId, params PinPoint[] pins)
    {
        if (string.IsNullOrWhiteSpace(componentId)) return false;
        foreach (PinPoint pin in pins)
        {
            if (pin == null || string.IsNullOrWhiteSpace(pin.pinId)) return false;
        }
        return true;
    }

    private void OnCircuitResult(SocketIOResponse response)
    {
        JObject payload = response.GetValue<JObject>();
        if (payload == null) return;
        lock (pendingCircuitResultLock)
        {
            pendingCircuitOk = payload.Value<bool>("ok");
            pendingCircuitMessage = payload.Value<string>("message");
            pendingSuspectedComponent = payload.Value<string>("suspectedComponent");
            pendingSuspectedComponents.Clear();
            JArray componentIds = payload["suspectedComponents"] as JArray;
            if (componentIds != null)
            {
                foreach (JToken componentId in componentIds)
                {
                    string id = componentId.Value<string>();
                    if (!string.IsNullOrWhiteSpace(id) && !pendingSuspectedComponents.Contains(id)) pendingSuspectedComponents.Add(id);
                }
            }
            // Accept legacy servers that emit only the singular field.
            if (pendingSuspectedComponents.Count == 0 && !string.IsNullOrWhiteSpace(pendingSuspectedComponent))
            {
                pendingSuspectedComponents.Add(pendingSuspectedComponent);
            }
            pendingConfidence = payload.Value<string>("confidence");
            pendingGroundedOn = payload.Value<string>("groundedOn");
            hasPendingCircuitResult = true;
        }
    }

    private void ApplyFaultHighlightResult(bool ok, string message, List<string> suspectedComponents, string confidence, string groundedOn)
    {
        // Every new diagnosis replaces the old marker. This only colors each
        // component PinPoint's assigned snap-sphere renderer; it never changes
        // the component's VirtualLed or any simulation state.
        ClearFaultHighlights();
        if (!ok)
        {
            foreach (string suspectedComponent in suspectedComponents)
            {
                foreach (PinPoint pin in GetPinsForComponent(suspectedComponent))
                {
                    HighlightFaultEndpoint(pin);
                    // A Connection contains both wire endpoints. Mark the pin on
                    // the other side red too, so the whole faulty connection is
                    // visible instead of only the component-side snap sphere.
                    if (circuitGraph == null) continue;
                    foreach (PinPoint connectedPin in circuitGraph.GetConnectedPins(pin))
                    {
                        HighlightFaultEndpoint(connectedPin);
                    }
                }
            }
        }

        string sourceSuffix = string.IsNullOrWhiteSpace(groundedOn) ? "" : $" Source: {groundedOn}";
        string confidenceSuffix = string.IsNullOrWhiteSpace(confidence) ? "" : $" ({confidence})";
        Debug.Log($"[QuestCircuitBridge] {(ok ? "Circuit valid" : "Circuit error")}{confidenceSuffix}: {message}{sourceSuffix}");
    }

    private IEnumerable<PinPoint> GetPinsForComponent(string componentId)
    {
        foreach (CircuitComponent component in UnityEngine.Object.FindObjectsByType<CircuitComponent>(FindObjectsSortMode.None))
        {
            if (component != null && component.Id == componentId)
            {
                foreach (PinPoint pin in component.GetPins())
                {
                    if (pin != null) yield return pin;
                }
                yield break;
            }
        }
        foreach (LedDefinition led in leds)
        {
            if (led != null && led.id == componentId)
            {
                if (led.anode != null) yield return led.anode;
                if (led.cathode != null) yield return led.cathode;
                yield break;
            }
        }
        foreach (ResistorDefinition resistor in resistors)
        {
            if (resistor != null && resistor.id == componentId)
            {
                if (resistor.a != null) yield return resistor.a;
                if (resistor.b != null) yield return resistor.b;
                yield break;
            }
        }
        foreach (PirDefinition pir in pirSensors)
        {
            if (pir != null && pir.id == componentId)
            {
                if (pir.vcc != null) yield return pir.vcc;
                if (pir.signal != null) yield return pir.signal;
                if (pir.gnd != null) yield return pir.gnd;
                yield break;
            }
        }
    }

    private void ClearFaultHighlights()
    {
        foreach (PinPoint pin in faultHighlightedPins)
        {
            if (pin != null) pin.SetFaultHighlighted(false);
        }
        faultHighlightedPins.Clear();
    }

    private void HighlightFaultEndpoint(PinPoint pin)
    {
        if (pin == null || faultHighlightedPins.Contains(pin)) return;
        pin.SetFaultHighlighted(true);
        faultHighlightedPins.Add(pin);
    }

    private void OnCommitRestore(SocketIOResponse response)
    {
        JObject payload = response.GetValue<JObject>();
        if (payload == null) return;
        JObject circuit = payload["circuit"] as JObject;
        if (circuit == null) return;

        lock (pendingRestoreLock)
        {
            pendingRestorePayload = circuit;
            hasPendingRestore = true;
        }
    }

    private void ApplyPendingRestore()
    {
        JObject circuit;
        lock (pendingRestoreLock)
        {
            if (!hasPendingRestore) return;
            circuit = pendingRestorePayload;
            hasPendingRestore = false;
            pendingRestorePayload = null;
        }
        RestoreCircuit(circuit);
    }

    /// <summary>
    /// Clears every spawned component and jumper wire, then rebuilds the
    /// physical layout from a saved commit: same ids, same position/rotation,
    /// same wire endpoints. Runs on the main thread (called from Update()).
    /// </summary>
    private void RestoreCircuit(JObject circuit)
    {
        if (spawner == null || wireManager == null)
        {
            Debug.LogError("[QuestCircuitBridge] Cannot restore a commit: assign WireManager and CircuitComponentSpawner in the Inspector.");
            return;
        }

        wireManager.ClearAllWires();
        spawner.ClearAllComponents();

        JObject board = circuit["board"] as JObject;
        if (board != null && boardRoot != null)
        {
            boardRoot.position = ToVector3(board["pos"] as JObject, boardRoot.position);
            boardRoot.rotation = ToQuaternion(board["rot"] as JObject, boardRoot.rotation);
        }

        JArray components = circuit["components"] as JArray;
        if (components != null)
        {
            foreach (JToken token in components)
            {
                JObject entry = token as JObject;
                if (entry == null) continue;
                string type = entry.Value<string>("type");
                string id = entry.Value<string>("id");
                Vector3 position = ToVector3(entry["pos"] as JObject, Vector3.zero);
                Quaternion rotation = ToQuaternion(entry["rot"] as JObject, Quaternion.identity);
                spawner.SpawnWithIdentity(type, id, position, rotation);
            }
        }

        // Wires reference pins by id, and every pin (component-owned or on a
        // fixed board like the Arduino) is now in the scene, so a fresh lookup
        // resolves both kinds the same way.
        Dictionary<string, PinPoint> pinsById = new Dictionary<string, PinPoint>();
        foreach (PinPoint pin in UnityEngine.Object.FindObjectsByType<PinPoint>(FindObjectsSortMode.None))
        {
            if (pin != null && !string.IsNullOrWhiteSpace(pin.pinId)) pinsById[pin.pinId] = pin;
        }

        JArray wires = circuit["wires"] as JArray;
        if (wires != null)
        {
            foreach (JToken token in wires)
            {
                JObject entry = token as JObject;
                if (entry == null) continue;
                string from = entry.Value<string>("from");
                string to = entry.Value<string>("to");
                PinPoint pinA, pinB;
                if (from == null || to == null || !pinsById.TryGetValue(from, out pinA) || !pinsById.TryGetValue(to, out pinB))
                {
                    Debug.LogWarning($"[QuestCircuitBridge] Restore skipped a wire: unknown pin(s) {from} <-> {to}.");
                    continue;
                }
                wireManager.SpawnWireBetween(pinA, pinB, Color.blue);
            }
        }

        // The restored circuit becomes the new baseline so the next 0.2s poll
        // does not immediately re-send it as a "change".
        lastCircuitJson = BuildCircuit().ToString(Newtonsoft.Json.Formatting.None);
        Debug.Log($"[QuestCircuitBridge] Restored commit: {(components?.Count ?? 0)} components, {(wires?.Count ?? 0)} wires.");
    }

    private async void OnDestroy()
    {
        if (socket != null) await socket.DisconnectAsync();
    }
}
