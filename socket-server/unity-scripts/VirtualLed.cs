using UnityEngine;

/// <summary>Visual-only LED response driven by QuestCircuitBridge.</summary>
public class VirtualLed : MonoBehaviour
{
    [SerializeField] private Renderer ledRenderer;
    [SerializeField] private Light glowLight;
    [SerializeField] private Color onColor = new Color(1f, 0.12f, 0.02f);
    [SerializeField] private float onIntensity = 3f;

    private Material ledMaterial;

    private void Awake()
    {
        if (ledRenderer == null) ledRenderer = GetComponentInChildren<Renderer>();
        if (ledRenderer != null)
        {
            ledMaterial = ledRenderer.material;
            ledMaterial.EnableKeyword("_EMISSION");
        }
        SetLit(false);
    }

    public void SetLit(bool isOn)
    {
        if (ledMaterial != null)
            ledMaterial.SetColor("_EmissionColor", isOn ? onColor * onIntensity : Color.black);
        if (glowLight != null)
            glowLight.enabled = isOn;
    }
}
