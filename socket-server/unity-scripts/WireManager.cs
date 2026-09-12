using UnityEngine;
using System.Collections.Generic;

public class WireManager : MonoBehaviour
{
    [Header("Physical Wire Prefab")]
    public GameObject jumperWirePrefab;

    [Header("Spawn Settings")]
    public int initialWireCount = 3;
    [Tooltip("Optional anchor. Assign SpawnPanelCube to spawn wires beside the UI panel.")]
    public Transform spawnPanel;
    [Tooltip("Position beside SpawnPanelCube in the panel's local space.")]
    public Vector3 spawnPanelOffset = new Vector3(0.30f, 0f, 0f);
    public Vector3 spawnCenter = new Vector3(0.18f, 0.88f, 0.50f); // On desk next to Arduino
    public float spawnOffsetSpacing = 0.06f;

    [Header("Materials / Colors")]
    public Material redWireMat;
    public Material blackWireMat;
    public Material blueWireMat;

    private List<JumperWire> activeWires = new List<JumperWire>();
    private CircuitGraph circuitGraph;

    void Awake()
    {
        circuitGraph = GetComponent<CircuitGraph>();
        if (circuitGraph == null)
            circuitGraph = gameObject.AddComponent<CircuitGraph>();
    }

    void Start()
    {
        // Auto-spawn initial jumper wires on desk if prefab assigned
#if UNITY_EDITOR
        if (jumperWirePrefab == null)
        {
            jumperWirePrefab = UnityEditor.AssetDatabase.LoadAssetAtPath<GameObject>("Assets/Prefabs/PhysicalJumperWire.prefab");
        }
#endif

        SpawnInitialWires();
    }

    public void SpawnInitialWires()
    {
        if (jumperWirePrefab == null)
        {
            Debug.LogWarning("[WireManager] No jumperWirePrefab assigned!");
            return;
        }

        Color[] wireColors = new Color[] { Color.red, Color.black, Color.blue, Color.yellow, Color.green };

        for (int i = 0; i < initialWireCount; i++)
        {
            Vector3 pos = spawnCenter + new Vector3(0, 0, (i - (initialWireCount - 1) * 0.5f) * spawnOffsetSpacing);
            Color wireColor = wireColors[i % wireColors.Length];

            SpawnWireAt(pos, wireColor);
        }
    }

    /// <summary>Hook this directly to a UI button event.</summary>
    public void SpawnJumperWire()
    {
        Color[] wireColors = { Color.red, Color.black, Color.blue, Color.yellow, Color.green };
        int index = activeWires.Count;
        Vector3 spacing = Vector3.right * (index * spawnOffsetSpacing);
        Vector3 position = spawnPanel != null
            ? spawnPanel.TransformPoint(spawnPanelOffset + spacing)
            : spawnCenter + spacing;
        SpawnWireAt(position, wireColors[index % wireColors.Length]);
    }

    public JumperWire SpawnWireAt(Vector3 position, Color color)
    {
        if (jumperWirePrefab == null) return null;

        GameObject wireObj = Instantiate(jumperWirePrefab, position, Quaternion.identity);
        wireObj.name = $"JumperWire_{activeWires.Count + 1}";

        JumperWire wire = wireObj.GetComponent<JumperWire>();
        if (wire != null)
        {
            activeWires.Add(wire);

            // Apply color to plugs and renderer
            if (wire.plugA != null)
            {
                wire.plugA.normalColor = color;
                wire.plugA.SetPlugColor(color);
            }

            if (wire.plugB != null)
            {
                wire.plugB.normalColor = color;
                wire.plugB.SetPlugColor(color);
            }

            if (wire.lineRenderer != null)
            {
                Material mat = new Material(Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard"));
                mat.color = color;
                wire.lineRenderer.sharedMaterial = mat;
            }
        }

        return wire;
    }

    public void ClearAllWires()
    {
        foreach (var wire in activeWires)
        {
            if (wire == null) continue;

            // Unplug both ends first so PinPoint occupancy and CircuitGraph
            // connections are cleaned up through the normal path, rather than
            // destroying the wire out from under them and leaving stale state.
            if (wire.plugA != null) wire.plugA.Unplug();
            if (wire.plugB != null) wire.plugB.Unplug();

            // Immediate, not deferred: a restore respawns components and
            // wires with the same ids in the same frame, and a stale
            // not-yet-destroyed object would shadow the replacement in a
            // FindObjectsByType lookup taken later in that same frame.
            DestroyImmediate(wire.gameObject);
        }
        activeWires.Clear();
    }

    /// <summary>
    /// Restore path: spawn a jumper wire and plug both ends directly into the
    /// given pins, without needing a hand to drag it into the snap radius.
    /// </summary>
    public JumperWire SpawnWireBetween(PinPoint a, PinPoint b, Color color)
    {
        if (a == null || b == null) return null;
        Vector3 midpoint = Vector3.Lerp(a.transform.position, b.transform.position, 0.5f);
        JumperWire wire = SpawnWireAt(midpoint, color);
        if (wire == null) return null;

        if (wire.plugA != null) wire.plugA.PlugInto(a);
        if (wire.plugB != null) wire.plugB.PlugInto(b);
        return wire;
    }

    // Stub method for backwards compatibility with WirePinInteractable
    public void SelectPin(PinPoint pin)
    {
        // Physical Jumper Wires are now used instead of Ray selection.
        if (pin != null)
        {
            Debug.Log($"[WireManager] Pin {pin.pinId} interacted.");
        }
    }
}

