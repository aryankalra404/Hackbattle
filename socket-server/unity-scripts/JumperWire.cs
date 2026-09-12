using UnityEngine;

[RequireComponent(typeof(LineRenderer))]
public class JumperWire : MonoBehaviour
{
    [Header("Plug Ends")]
    public WirePlug plugA;
    public WirePlug plugB;

    [Header("Line / Curve Settings")]
    public LineRenderer lineRenderer;
    public int curveSegments = 20;
    public float sagAmount = 0.03f; // Slack/sag on the wire

    private CircuitGraph circuitGraph;
    private bool isConnectedInGraph = false;
    private PinPoint connectedPinA = null;
    private PinPoint connectedPinB = null;

    private void Awake()
    {
        if (lineRenderer == null)
            lineRenderer = GetComponent<LineRenderer>();

        circuitGraph = Object.FindFirstObjectByType<CircuitGraph>();
        if (circuitGraph == null)
        {
            GameObject graphObj = GameObject.Find("WireManager") ?? gameObject;
            circuitGraph = graphObj.GetComponent<CircuitGraph>();
            if (circuitGraph == null) circuitGraph = graphObj.AddComponent<CircuitGraph>();
        }
    }

    private void Start()
    {
        if (plugA != null) plugA.parentWire = this;
        if (plugB != null) plugB.parentWire = this;
    }

    private void Update()
    {
        if (plugA != null && plugB != null && lineRenderer != null)
        {
            Vector3 posA = plugA.plugTip != null ? plugA.plugTip.position : plugA.transform.position;
            Vector3 posB = plugB.plugTip != null ? plugB.plugTip.position : plugB.transform.position;

            DrawWireCurve(posA, posB);
        }
    }

    public void OnPlugStateChanged(PinPoint unpluggedPin = null)
    {
        if (circuitGraph == null)
            circuitGraph = Object.FindFirstObjectByType<CircuitGraph>();

        if (plugA != null && plugA.currentPin != null && plugB != null && plugB.currentPin != null)
        {
            // Both ends are plugged in!
            PinPoint pA = plugA.currentPin;
            PinPoint pB = plugB.currentPin;

            if (!isConnectedInGraph || connectedPinA != pA || connectedPinB != pB)
            {
                if (isConnectedInGraph && connectedPinA != null && connectedPinB != null)
                {
                    circuitGraph.RemoveConnection(connectedPinA, connectedPinB);
                }

                circuitGraph.AddConnection(pA, pB);
                isConnectedInGraph = true;
                connectedPinA = pA;
                connectedPinB = pB;
                Debug.Log($"[JumperWire] Circuit connection established between {pA.pinId} and {pB.pinId}");
            }
        }
        else
        {
            // At least one plug is unplugged
            if (isConnectedInGraph && connectedPinA != null && connectedPinB != null)
            {
                circuitGraph.RemoveConnection(connectedPinA, connectedPinB);
                Debug.Log($"[JumperWire] Circuit connection removed between {connectedPinA.pinId} and {connectedPinB.pinId}");
            }

            isConnectedInGraph = false;
            connectedPinA = null;
            connectedPinB = null;
        }
    }

    private void DrawWireCurve(Vector3 start, Vector3 end)
    {
        lineRenderer.positionCount = curveSegments;

        float dist = Vector3.Distance(start, end);
        float currentSag = Mathf.Min(sagAmount, dist * 0.3f);

        Vector3 mid = Vector3.Lerp(start, end, 0.5f);
        mid.y -= currentSag;

        for (int i = 0; i < curveSegments; i++)
        {
            float t = i / (float)(curveSegments - 1);
            Vector3 point = Mathf.Pow(1 - t, 2) * start
                          + 2 * (1 - t) * t * mid
                          + Mathf.Pow(t, 2) * end;
            lineRenderer.SetPosition(i, point);
        }
    }
}
