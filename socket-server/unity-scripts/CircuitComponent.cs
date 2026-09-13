using System.Collections.Generic;
using UnityEngine;

/// <summary>
/// Describes a spawnable circuit prefab. Add this to LED, resistor, and PIR
/// prefabs, then assign its terminal PinPoints once on the prefab asset.
/// </summary>
public class CircuitComponent : MonoBehaviour
{
    public enum ComponentType { Led, Resistor, Pir, Motor, Ultrasonic }

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

    [Header("DC Motor terminals")]
    [SerializeField] private PinPoint motorPositive;
    [SerializeField] private PinPoint motorNegative;

    [Header("Ultrasonic (HC-SR04) terminals")]
    [SerializeField] private PinPoint ultrasonicVcc;
    [SerializeField] private PinPoint ultrasonicTrig;
    [SerializeField] private PinPoint ultrasonicEcho;
    [SerializeField] private PinPoint ultrasonicGnd;

    public ComponentType Type => componentType;
    public string Id => componentId;
    public PinPoint Anode => anode;
    public PinPoint Cathode => cathode;
    public PinPoint TerminalA => terminalA;
    public PinPoint TerminalB => terminalB;
    public PinPoint Vcc => vcc;
    public PinPoint Signal => signal;
    public PinPoint Gnd => gnd;
    public PinPoint MotorPositive => motorPositive;
    public PinPoint MotorNegative => motorNegative;
    public PinPoint UltrasonicVcc => ultrasonicVcc;
    public PinPoint UltrasonicTrig => ultrasonicTrig;
    public PinPoint UltrasonicEcho => ultrasonicEcho;
    public PinPoint UltrasonicGnd => ultrasonicGnd;

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
            case ComponentType.Motor:
                SetPinId(motorPositive, $"{id}-positive");
                SetPinId(motorNegative, $"{id}-negative");
                break;
            case ComponentType.Ultrasonic:
                SetPinId(ultrasonicVcc, $"{id}-vcc");
                SetPinId(ultrasonicTrig, $"{id}-trig");
                SetPinId(ultrasonicEcho, $"{id}-echo");
                SetPinId(ultrasonicGnd, $"{id}-gnd");
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
            case ComponentType.Motor:
                yield return motorPositive;
                yield return motorNegative;
                break;
            case ComponentType.Ultrasonic:
                yield return ultrasonicVcc;
                yield return ultrasonicTrig;
                yield return ultrasonicEcho;
                yield return ultrasonicGnd;
                break;
        }
    }

    private static void SetPinId(PinPoint pin, string id)
    {
        if (pin != null) pin.pinId = id;
    }
}
