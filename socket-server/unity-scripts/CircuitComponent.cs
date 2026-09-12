using System.Collections.Generic;
using UnityEngine;

/// <summary>
/// Describes a spawnable circuit prefab. Add this to LED, resistor, and PIR
/// prefabs, then assign its terminal PinPoints once on the prefab asset.
/// </summary>
public class CircuitComponent : MonoBehaviour
{
    public enum ComponentType { Led, Resistor, Pir }

    [SerializeField] private ComponentType componentType;
    [SerializeField] private string componentId;

    [Header("LED terminals")]
    [SerializeField] private PinPoint anode;
    [SerializeField] private PinPoint cathode;

    [Header("Resistor terminals")]
    [SerializeField] private PinPoint terminalA;
    [SerializeField] private PinPoint terminalB;

    [Header("PIR terminals")]
    [SerializeField] private PinPoint vcc;
    [SerializeField] private PinPoint signal;
    [SerializeField] private PinPoint gnd;

    public ComponentType Type => componentType;
    public string Id => componentId;
    public PinPoint Anode => anode;
    public PinPoint Cathode => cathode;
    public PinPoint TerminalA => terminalA;
    public PinPoint TerminalB => terminalB;
    public PinPoint Vcc => vcc;
    public PinPoint Signal => signal;
    public PinPoint Gnd => gnd;

    public void ConfigureIdentity(string id)
    {
        componentId = id;
        gameObject.name = id;

        // A prefab's terminal labels must not be reused by its clones. The
        // bridge sends these IDs as wire endpoints, so they identify this
        // particular component instance rather than the prefab template.
        switch (componentType)
        {
            case ComponentType.Led:
                SetPinId(anode, $"{id}-anode");
                SetPinId(cathode, $"{id}-cathode");
                break;
            case ComponentType.Resistor:
                SetPinId(terminalA, $"{id}-a");
                SetPinId(terminalB, $"{id}-b");
                break;
            case ComponentType.Pir:
                SetPinId(vcc, $"{id}-vcc");
                SetPinId(signal, $"{id}-signal");
                SetPinId(gnd, $"{id}-gnd");
                break;
        }
    }

    public bool IsConfigured()
    {
        if (string.IsNullOrWhiteSpace(componentId)) return false;
        foreach (PinPoint pin in GetPins())
        {
            if (pin == null || string.IsNullOrWhiteSpace(pin.pinId)) return false;
        }
        return true;
    }

    public IEnumerable<PinPoint> GetPins()
    {
        switch (componentType)
        {
            case ComponentType.Led:
                yield return anode;
                yield return cathode;
                break;
            case ComponentType.Resistor:
                yield return terminalA;
                yield return terminalB;
                break;
            case ComponentType.Pir:
                yield return vcc;
                yield return signal;
                yield return gnd;
                break;
        }
    }

    private static void SetPinId(PinPoint pin, string id)
    {
        if (pin != null) pin.pinId = id;
    }
}
