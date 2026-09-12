using UnityEngine;
using UnityEngine.InputSystem;

/// <summary>
/// Toggles a GameObject's active state with a single key press. Used to show and hide the
/// alignment cube's visual, which is hidden by default now that the guidance elements are the
/// point of the scene, but still useful for checking the room calibration against the desk.
/// </summary>
public class KeyToggleActive : MonoBehaviour
{
    [Tooltip("The object to show/hide.")]
    [SerializeField] private GameObject target;

    [Tooltip("Key that toggles the target.")]
    [SerializeField] private Key key = Key.C;

    private void Update()
    {
        var kb = Keyboard.current;
        if (kb == null || target == null || !kb[key].wasPressedThisFrame)
            return;

        target.SetActive(!target.activeSelf);
        Debug.Log($"[Toggle] {target.name} {(target.activeSelf ? "shown" : "hidden")}");
    }
}
