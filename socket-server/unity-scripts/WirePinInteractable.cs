using UnityEngine;

// Attach to each Pin_XXX object alongside PinPoint.
// Hook this up to a Ray Interactable's "When Select" event (via InteractableUnityEventWrapper),
// same pattern you already used for Poke - just call Select() instead of OnPinchStart().
public class WirePinInteractable : MonoBehaviour
{
    public PinPoint pin;
    public WireManager wireManager;

    // Call this from the Ray Interactable's When Select event
    public void Select()
    {
        wireManager.SelectPin(pin);
    }
}
