using UnityEngine;

[RequireComponent(typeof(LineRenderer))]
public class ActiveWire : MonoBehaviour
{
    public PinPoint startPin;
    public PinPoint endPin; // null while dragging
    public LineRenderer lineRenderer;

    [Header("Sag / Curve")]
    public int curveSegments = 20;
    public float sagAmount = 0.02f;

    private void Awake()
    {
        if (lineRenderer == null)
            lineRenderer = GetComponent<LineRenderer>();
    }

    private void Update()
    {
        if (startPin != null && endPin != null)
        {
            DrawCurve(startPin.transform.position, endPin.transform.position);
        }
    }

    public void UpdateLive(Vector3 endPointWorld)
    {
        if (startPin != null)
        {
            DrawCurve(startPin.transform.position, endPointWorld);
        }
    }

    public void FinalizeConnection(PinPoint target)
    {
        endPin = target;
        if (startPin != null && endPin != null)
        {
            DrawCurve(startPin.transform.position, target.transform.position);
        }
    }

    void DrawCurve(Vector3 start, Vector3 end)
    {
        if (lineRenderer == null) return;
        lineRenderer.positionCount = curveSegments;
        Vector3 mid = Vector3.Lerp(start, end, 0.5f);
        mid.y -= sagAmount;

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

