using System.Collections.Generic;
using UnityEngine;

/// <summary>
/// Hook SpawnLed, SpawnResistor, and SpawnPir to your Canvas button events.
/// Each button press creates an independent component with unique IDs.
/// </summary>
public class CircuitComponentSpawner : MonoBehaviour
{
    [Header("Prefab assets (each needs a CircuitComponent script)")]
    [SerializeField] private CircuitComponent ledPrefab;
    [SerializeField] private CircuitComponent resistorPrefab;
    [SerializeField] private CircuitComponent pirPrefab;

    [Header("Spawn placement")]
    [SerializeField] private Transform componentParent;
    [Tooltip("Optional anchor. Assign SpawnPanelCube to spawn beside the UI panel.")]
    [SerializeField] private Transform spawnPanel;
    [Tooltip("Position beside SpawnPanelCube in the panel's local space.")]
    [SerializeField] private Vector3 spawnPanelOffset = new Vector3(0.30f, 0f, 0f);
    [SerializeField] private Vector3 spawnCenter = new Vector3(0.18f, 0.88f, 0.50f);
    [SerializeField] private float spawnSpacing = 0.12f;

    private readonly Dictionary<CircuitComponent.ComponentType, int> nextIndex =
        new Dictionary<CircuitComponent.ComponentType, int>();

    public void SpawnLed() => Spawn(ledPrefab);
    public void SpawnResistor() => Spawn(resistorPrefab);
    public void SpawnPir() => Spawn(pirPrefab);

    public CircuitComponent Spawn(CircuitComponent prefab)
    {
        if (prefab == null)
        {
            Debug.LogWarning("[CircuitComponentSpawner] Assign the component prefab in the Inspector.");
            return null;
        }

        int index = GetNextIndex(prefab.Type);
        string id = $"{TypePrefix(prefab.Type)}-{index}";
        Vector3 position = GetSpawnPosition(index);
        CircuitComponent instance = Instantiate(prefab, position, Quaternion.identity, componentParent);
        instance.ConfigureIdentity(id);

        if (!instance.IsConfigured())
        {
            Debug.LogError($"[CircuitComponentSpawner] {id} is missing one or more terminal PinPoint assignments on its prefab.");
        }
        return instance;
    }

    private int GetNextIndex(CircuitComponent.ComponentType type)
    {
        int highestKnownIndex;
        nextIndex.TryGetValue(type, out highestKnownIndex);

        string prefix = TypePrefix(type) + "-";
        foreach (CircuitComponent component in Object.FindObjectsByType<CircuitComponent>(FindObjectsSortMode.None))
        {
            if (component == null || component.Type != type || !component.Id.StartsWith(prefix)) continue;
            int existingIndex;
            if (int.TryParse(component.Id.Substring(prefix.Length), out existingIndex))
                highestKnownIndex = Mathf.Max(highestKnownIndex, existingIndex);
        }

        int next = highestKnownIndex + 1;
        nextIndex[type] = next;
        return next;
    }

    private Vector3 GetSpawnPosition(int index)
    {
        Vector3 spacing = Vector3.right * ((index - 1) * spawnSpacing);
        return spawnPanel != null
            ? spawnPanel.TransformPoint(spawnPanelOffset + spacing)
            : spawnCenter + spacing;
    }

    private static string TypePrefix(CircuitComponent.ComponentType type)
    {
        switch (type)
        {
            case CircuitComponent.ComponentType.Led: return "led";
            case CircuitComponent.ComponentType.Resistor: return "resistor";
            case CircuitComponent.ComponentType.Pir: return "pir";
            default: return "component";
        }
    }
}
