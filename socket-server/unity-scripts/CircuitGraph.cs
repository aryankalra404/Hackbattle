using System.Collections.Generic;
using UnityEngine;

public class Connection
{
    public PinPoint pinA;
    public PinPoint pinB;
}

public class CircuitGraph : MonoBehaviour
{
    public List<Connection> connections = new List<Connection>();

    public void AddConnection(PinPoint a, PinPoint b)
    {
        connections.Add(new Connection { pinA = a, pinB = b });
        Debug.Log($"[CircuitGraph] Connected {a.pinId} <-> {b.pinId}");
    }

    public void RemoveConnection(PinPoint a, PinPoint b)
    {
        connections.RemoveAll(c =>
            (c.pinA == a && c.pinB == b) || (c.pinA == b && c.pinB == a));

        a.SetConnected(IsPinStillConnected(a));
        b.SetConnected(IsPinStillConnected(b));
    }

    bool IsPinStillConnected(PinPoint pin)
    {
        return connections.Exists(c => c.pinA == pin || c.pinB == pin);
    }

    // This is what your Arduino code interpreter will call later, e.g.:
    // "is D13 connected (directly or via components) to an LED, and is that
    // LED's other leg connected to GND?"
    public bool ArePinsConnected(PinPoint a, PinPoint b)
    {
        return connections.Exists(c =>
            (c.pinA == a && c.pinB == b) || (c.pinA == b && c.pinB == a));
    }

    public List<PinPoint> GetConnectedPins(PinPoint pin)
    {
        List<PinPoint> result = new List<PinPoint>();
        foreach (var c in connections)
        {
            if (c.pinA == pin) result.Add(c.pinB);
            else if (c.pinB == pin) result.Add(c.pinA);
        }
        return result;
    }
}
