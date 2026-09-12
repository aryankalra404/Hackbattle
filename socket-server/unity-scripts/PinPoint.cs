using UnityEngine;
using System.Collections.Generic;

public enum PinType { Signal, Power, Ground }

public class PinPoint : MonoBehaviour
{
    [Header("Identity")]
    public string pinId; // e.g. "D13", "GND", "5V"
    public PinType pinType = PinType.Signal;

    [Header("State")]
    public bool isOccupied = false;
    public WirePlug occupyingPlug;

    [Header("Visual Feedback")]
    public Renderer pinRenderer;      // assign the small visual dot/mesh for this pin
    public Color defaultColor = Color.white;
    public Color highlightColor = Color.yellow;
    public Color connectedColor = Color.green;
    [Tooltip("Persistent diagnostic highlight. This takes priority over hover and connection colors.")]
    public Color faultColor = Color.red;

    private bool isHighlighted;
    private bool isFaultHighlighted;
    private bool hasCircuitConnection;
    private readonly HashSet<WirePlug> occupyingPlugs = new HashSet<WirePlug>();

    /// <summary>
    /// Ground and supply rails are shared electrical nodes: an LED and a PIR
    /// must be able to use the same GND/5V point at the same time. Signal pins
    /// remain single-plug to prevent accidental short circuits in the AR build.
    /// </summary>
    public bool AllowsSharedConnections()
    {
        return pinType == PinType.Ground || pinType == PinType.Power;
    }

    public bool CanAcceptPlug(WirePlug plug)
    {
        return AllowsSharedConnections()
            || occupyingPlugs.Contains(plug)
            || (occupyingPlugs.Count == 0 && !isOccupied);
    }

    void Awake()
    {
        if (occupyingPlug != null) occupyingPlugs.Add(occupyingPlug);
        RefreshOccupancy();
        RefreshVisual();
    }

    public void AddPlug(WirePlug plug)
    {
        if (plug == null) return;
        occupyingPlugs.Add(plug);
        occupyingPlug = plug; // Kept for Inspector/backwards compatibility.
        RefreshOccupancy();
    }

    public void RemovePlug(WirePlug plug)
    {
        if (plug == null) return;
        occupyingPlugs.Remove(plug);
        occupyingPlug = occupyingPlugs.Count > 0 ? FirstPlug() : null;
        RefreshOccupancy();
    }

    public void SetHighlighted(bool on)
    {
        isHighlighted = on;
        RefreshVisual();
    }

    public void SetFaultHighlighted(bool on)
    {
        isFaultHighlighted = on;
        RefreshVisual();
    }

    public void SetConnected(bool connected)
    {
        hasCircuitConnection = connected;
        RefreshOccupancy();
    }

    private WirePlug FirstPlug()
    {
        foreach (WirePlug plug in occupyingPlugs) return plug;
        return null;
    }

    private void RefreshOccupancy()
    {
        isOccupied = hasCircuitConnection || occupyingPlugs.Count > 0;
        RefreshVisual();
    }

    private void RefreshVisual()
    {
        if (pinRenderer == null) return;
        if (isFaultHighlighted) pinRenderer.material.color = faultColor;
        else if (isHighlighted) pinRenderer.material.color = highlightColor;
        else pinRenderer.material.color = isOccupied || occupyingPlug != null ? connectedColor : defaultColor;
    }
}
