using System.Collections.Generic;
using Oculus.Interaction;
using UnityEngine;

/// <summary>
/// Grab a spawned component and drop it here to delete it — the same
/// interaction model as placing a part, so there is no new gesture, no
/// per-part delete button, and no selection state to track.
///
/// Distance-based, not a physics trigger, for the same reason WirePlug finds
/// its candidate pin by distance each frame: a hand-tracked kinematic object
/// is not a reliable source of OnTriggerEnter/Exit callbacks.
/// </summary>
public class DeleteZone : MonoBehaviour
{
    [Tooltip("How close a component's centre must be to count as \"in\" the trash.")]
    [SerializeField] private float radius = 0.12f;

    [Tooltip("Optional visual — tints while a held part is hovering inside the zone.")]
    [SerializeField] private Renderer zoneRenderer;
    [SerializeField] private Color idleColor = new Color(0.55f, 0.12f, 0.12f, 1f);
    [SerializeField] private Color armedColor = new Color(1f, 0.15f, 0.15f, 1f);

    // True for a component that was seen held-and-inside the zone, so a
    // release is only ever treated as "drop to delete" if it started that way
    // in this zone rather than merely ending up here by chance.
    private readonly Dictionary<CircuitComponent, bool> armed = new Dictionary<CircuitComponent, bool>();
    private readonly List<CircuitComponent> toForget = new List<CircuitComponent>();

    private void Awake()
    {
        SetZoneColor(idleColor);
    }

    private void Update()
    {
        bool anyArmed = false;
        toForget.Clear();

        foreach (CircuitComponent component in Object.FindObjectsByType<CircuitComponent>(FindObjectsSortMode.None))
        {
            if (component == null)
            {
                continue;
            }

            Grabbable grabbable = component.GetComponent<Grabbable>();
            if (grabbable == null) continue;

            bool held = grabbable.SelectingPointsCount > 0;
            bool inside = Vector3.Distance(component.transform.position, transform.position) <= radius;

            if (held && inside)
            {
                armed[component] = true;
                anyArmed = true;
                continue;
            }

            if (held) continue; // held but outside the zone: leave any armed flag as-is

            bool wasArmed;
            if (armed.TryGetValue(component, out wasArmed))
            {
                toForget.Add(component);
                if (wasArmed && inside) Delete(component);
            }
        }

        foreach (CircuitComponent component in toForget) armed.Remove(component);

        SetZoneColor(anyArmed ? armedColor : idleColor);
    }

    private void Delete(CircuitComponent component)
    {
        foreach (PinPoint pin in component.GetPins())
        {
            if (pin == null) continue;
            foreach (WirePlug plug in pin.GetOccupyingPlugs())
            {
                if (plug != null) plug.Unplug();
            }
        }

        Debug.Log($"[DeleteZone] Deleted {component.Id}");
        Destroy(component.gameObject);
    }

    private void SetZoneColor(Color color)
    {
        if (zoneRenderer == null) return;
        MaterialPropertyBlock mpb = new MaterialPropertyBlock();
        zoneRenderer.GetPropertyBlock(mpb);
        mpb.SetColor("_BaseColor", color);
        mpb.SetColor("_Color", color);
        zoneRenderer.SetPropertyBlock(mpb);
    }

    private void OnDrawGizmosSelected()
    {
        Gizmos.color = new Color(1f, 0.2f, 0.2f, 0.4f);
        Gizmos.DrawWireSphere(transform.position, radius);
    }
}
