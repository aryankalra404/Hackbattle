using UnityEngine;
using Oculus.Interaction;

public class WirePlug : MonoBehaviour
{
    [Header("Wire & Snap Settings")]
    public JumperWire parentWire;
    public PinPoint currentPin;
    public float snapRadius = 0.04f; // 4 cm snap radius
    public Transform plugTip;

    [Header("Visuals")]
    public Renderer plugRenderer;
    public Color normalColor = Color.red;
    public Color hoverColor = Color.yellow;
    public Color pluggedColor = Color.green;

    private Grabbable grabbable;
    private bool isGrabbed = false;
    private PinPoint candidatePin = null;

    private void Awake()
    {
        if (plugTip == null) plugTip = transform;
        grabbable = GetComponent<Grabbable>();
        if (grabbable == null) grabbable = GetComponentInParent<Grabbable>();

        if (plugRenderer == null) plugRenderer = GetComponent<Renderer>();
        SetPlugColor(normalColor);
    }

    private void OnEnable()
    {
        if (grabbable != null)
        {
            grabbable.WhenPointerEventRaised += HandlePointerEvent;
        }
    }

    private void OnDisable()
    {
        if (grabbable != null)
        {
            grabbable.WhenPointerEventRaised -= HandlePointerEvent;
        }
    }

    private void HandlePointerEvent(PointerEvent pointerEvent)
    {
        if (pointerEvent.Type == PointerEventType.Select)
        {
            OnGrab();
        }
        else if (pointerEvent.Type == PointerEventType.Unselect || pointerEvent.Type == PointerEventType.Cancel)
        {
            OnRelease();
        }
    }

    public void OnGrab()
    {
        isGrabbed = true;

        if (currentPin != null)
        {
            Unplug();
        }
    }

    public void SetPlugColor(Color col)
    {
        if (plugRenderer == null) return;
        MaterialPropertyBlock mpb = new MaterialPropertyBlock();
        plugRenderer.GetPropertyBlock(mpb);
        mpb.SetColor("_BaseColor", col);
        mpb.SetColor("_Color", col);
        plugRenderer.SetPropertyBlock(mpb);
    }

    public void OnRelease()
    {
        isGrabbed = false;

        if (candidatePin != null && candidatePin.CanAcceptPlug(this))
        {
            PlugInto(candidatePin);
            ClearCandidate();
        }
        else
        {
            ClearCandidate();
            SetPlugColor(normalColor);
        }
    }

    private void Update()
    {
        if (isGrabbed)
        {
            FindCandidatePin();
        }
        else if (currentPin != null)
        {
            // Snap firmly to current pin socket position & orientation
            transform.position = currentPin.transform.position;
            transform.rotation = currentPin.transform.rotation;
        }
    }

    private void FindCandidatePin()
    {
        PinPoint bestPin = null;
        float bestDist = snapRadius;

        Vector3 searchPos = plugTip != null ? plugTip.position : transform.position;
        PinPoint[] allPins = Object.FindObjectsByType<PinPoint>(FindObjectsSortMode.None);

        foreach (var pin in allPins)
        {
            if (!pin.CanAcceptPlug(this)) continue;

            float dist = Vector3.Distance(searchPos, pin.transform.position);
            if (dist < bestDist)
            {
                bestDist = dist;
                bestPin = pin;
            }
        }

        if (candidatePin != bestPin)
        {
            if (candidatePin != null)
            {
                candidatePin.SetHighlighted(false);
            }

            candidatePin = bestPin;

            if (candidatePin != null)
            {
                candidatePin.SetHighlighted(true);
                SetPlugColor(hoverColor);
            }
            else
            {
                SetPlugColor(normalColor);
            }
        }
    }

    private void ClearCandidate()
    {
        if (candidatePin != null)
        {
            candidatePin.SetHighlighted(false);
            candidatePin = null;
        }
    }

    public void PlugInto(PinPoint pin)
    {
        if (pin == null) return;

        currentPin = pin;
        pin.AddPlug(this);
        pin.SetConnected(true);

        transform.position = pin.transform.position;
        transform.rotation = pin.transform.rotation;

        SetPlugColor(pluggedColor);

        if (parentWire != null)
        {
            parentWire.OnPlugStateChanged();
        }
    }

    public void Unplug()
    {
        if (currentPin == null) return;

        PinPoint prevPin = currentPin;
        currentPin.RemovePlug(this);
        currentPin.SetConnected(false);
        currentPin = null;

        SetPlugColor(normalColor);

        if (parentWire != null)
        {
            parentWire.OnPlugStateChanged(prevPin);
        }
    }
}
