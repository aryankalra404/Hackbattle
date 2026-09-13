using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using UnityEngine;

/// <summary>
/// Demo shortcut for "wave a hand near the ultrasonic sensor and the LED
/// lights up": a hand/controller within triggerDistance of any spawned
/// Ultrasonic component lights every LED that has both terminals wired into
/// the circuit (CircuitGraph reports at least one connection on each pin).
///
/// This is a proximity trigger, not a real HC-SR04 distance reading or a
/// traced electrical path from sensor to LED — CircuitGraph only resolves
/// direct pin-to-pin wires today, not a multi-hop path through the Arduino,
/// so tracing "is this LED actually on the circuit this sensor controls" is
/// out of scope for a same-day demo. Good enough to show "sensor senses
/// motion, LED reacts" live, both in AR and on the web mirror.
/// </summary>
public class UltrasonicProximityController : MonoBehaviour
{
    [SerializeField] private CircuitGraph circuitGraph;
    [SerializeField] private QuestCircuitBridge bridge;
    [Tooltip("Metres. HC-SR04's own real range is much longer; this is tuned for a hand reaching toward the desk prop.")]
    [SerializeField] private float triggerDistance = 0.15f;
    [SerializeField] private float pollInterval = 0.15f;

    private OVRCameraRig cameraRig;
    private float nextPollTime;
    private bool lastNear;

    private void Start()
    {
        if (circuitGraph == null) circuitGraph = FindFirstObjectByType<CircuitGraph>();
        if (bridge == null) bridge = FindFirstObjectByType<QuestCircuitBridge>();
        cameraRig = FindFirstObjectByType<OVRCameraRig>();
    }

    private void Update()
    {
        if (Time.time < nextPollTime) return;
        nextPollTime = Time.time + pollInterval;
        Evaluate();
    }

    private void Evaluate()
    {
        bool near = IsHandNearAnyUltrasonic();
        if (near == lastNear) return;
        lastNear = near;

        JObject ledStates = new JObject();
        foreach (CircuitComponent component in Object.FindObjectsByType<CircuitComponent>(FindObjectsSortMode.None))
        {
            if (component.Type != CircuitComponent.ComponentType.Led || !IsLedWired(component)) continue;

            VirtualLed led = component.GetComponentInChildren<VirtualLed>();
            if (led == null) led = component.gameObject.AddComponent<VirtualLed>();
            led.SetLit(near);
            ledStates[component.Id] = near;
        }

        if (bridge != null && bridge.Socket != null && bridge.Socket.Connected)
        {
            bridge.Socket.Emit("sensor:proximity", new JObject
            {
                ["sessionId"] = bridge.SessionId,
                ["near"] = near,
                ["ledStates"] = ledStates
            });
        }
    }

    private bool IsLedWired(CircuitComponent led)
    {
        if (circuitGraph == null || led.Anode == null || led.Cathode == null) return false;
        return circuitGraph.GetConnectedPins(led.Anode).Count > 0 && circuitGraph.GetConnectedPins(led.Cathode).Count > 0;
    }

    private bool IsHandNearAnyUltrasonic()
    {
        List<Transform> hands = GetHandAnchors();
        if (hands.Count == 0) return false;

        foreach (CircuitComponent component in Object.FindObjectsByType<CircuitComponent>(FindObjectsSortMode.None))
        {
            if (component.Type != CircuitComponent.ComponentType.Ultrasonic) continue;
            foreach (Transform hand in hands)
            {
                if (Vector3.Distance(hand.position, component.transform.position) <= triggerDistance) return true;
            }
        }
        return false;
    }

    // Checks both controller and bare-hand-tracking anchors so the demo works
    // whether the headset is in controller mode or hand-tracking mode.
    private List<Transform> GetHandAnchors()
    {
        List<Transform> anchors = new List<Transform>();
        if (cameraRig == null) return anchors;
        if (cameraRig.rightControllerAnchor != null) anchors.Add(cameraRig.rightControllerAnchor);
        if (cameraRig.leftControllerAnchor != null) anchors.Add(cameraRig.leftControllerAnchor);
        if (cameraRig.rightHandAnchor != null) anchors.Add(cameraRig.rightHandAnchor);
        if (cameraRig.leftHandAnchor != null) anchors.Add(cameraRig.leftHandAnchor);
        return anchors;
    }
}
