using UnityEngine;
#if ENABLE_INPUT_SYSTEM
using UnityEngine.InputSystem;
#endif

/// <summary>
/// One-key orientation calibration for a visual that is a child of a tracker.
///
/// A DTrack body's coordinate frame is whatever it was at body calibration, so the tracker's
/// rotation rarely matches the physical object's natural axes. Instead of guessing the correction,
/// put the object into a known pose and press the capture key:
///
/// - <see cref="Mode.ForwardPointsUp"/>: the visual's local +Z (an <see cref="ArrowGizmo"/>'s
///   direction) is rotated to point world-up at that instant. Stand the screwdriver on its
///   battery with the chuck pointing up, press the key, and the arrow now follows the tool axis.
/// - <see cref="Mode.FlatOnTable"/>: the visual's local +Y is rotated to world-up and its local
///   +X to world +X yawed by <see cref="yawDegrees"/>. Lay the board flat, press the key, then
///   tune <see cref="yawDegrees"/> until the box follows the board's long edge.
///
/// The captured tracker rotation and yaw are saved in PlayerPrefs and re-applied on the next run,
/// so the calibration survives leaving Play mode. Shift + capture key clears it. The resulting
/// local Euler angles are also logged so they can be typed into the Inspector for a permanent
/// scene-file value.
/// </summary>
public class TrackedVisualAligner : MonoBehaviour
{
    public enum Mode
    {
        ForwardPointsUp,
        FlatOnTable,
    }

    [SerializeField] private Mode mode = Mode.ForwardPointsUp;

    [Tooltip("Function key number that captures the alignment (5 = F5). Shift + key clears it.")]
    [SerializeField, Range(1, 12)] private int functionKey = 5;

    [Tooltip("FlatOnTable only: rotation about world up applied after capture, in degrees. Tune live until the box follows the board's long edge.")]
    [SerializeField] private float yawDegrees;

    private bool captured;
    private Quaternion capturedParentRotation = Quaternion.identity;
    private float appliedYaw;

    private string PrefsKey => "TrackedVisualAligner." + gameObject.name;

    private void Start()
    {
        if (PlayerPrefs.HasKey(PrefsKey + ".w"))
        {
            capturedParentRotation = new Quaternion(
                PlayerPrefs.GetFloat(PrefsKey + ".x"), PlayerPrefs.GetFloat(PrefsKey + ".y"),
                PlayerPrefs.GetFloat(PrefsKey + ".z"), PlayerPrefs.GetFloat(PrefsKey + ".w"));
            yawDegrees = PlayerPrefs.GetFloat(PrefsKey + ".yaw", yawDegrees);
            captured = true;
            Apply();
            Debug.Log($"[Aligner:{name}] Applied saved alignment, local euler = {transform.localEulerAngles:F1}. " +
                      $"Shift+F{functionKey} clears it.");
        }
    }

    private void Update()
    {
        bool pressed, shift;
#if ENABLE_INPUT_SYSTEM
        var kb = Keyboard.current;
        if (kb == null)
            return;
        pressed = kb[Key.F1 + (functionKey - 1)].wasPressedThisFrame;
        shift = kb.leftShiftKey.isPressed || kb.rightShiftKey.isPressed;
#else
        pressed = Input.GetKeyDown(KeyCode.F1 + (functionKey - 1));
        shift = Input.GetKey(KeyCode.LeftShift) || Input.GetKey(KeyCode.RightShift);
#endif
        if (pressed)
        {
            if (shift) Clear(); else Capture();
        }
        else if (captured && mode == Mode.FlatOnTable && !Mathf.Approximately(yawDegrees, appliedYaw))
        {
            // Yaw edited in the Inspector while playing: re-apply and persist.
            Apply();
            Save();
        }
    }

    private void Capture()
    {
        capturedParentRotation = transform.parent != null ? transform.parent.rotation : Quaternion.identity;
        captured = true;
        Apply();
        Save();
        Debug.Log($"[Aligner:{name}] Captured {mode}. Local euler = {transform.localEulerAngles:F1} " +
                  "(type these into the Inspector rotation to bake them into the scene; saved for next run too).");
    }

    private void Clear()
    {
        captured = false;
        transform.localRotation = Quaternion.identity;
        PlayerPrefs.DeleteKey(PrefsKey + ".x"); PlayerPrefs.DeleteKey(PrefsKey + ".y");
        PlayerPrefs.DeleteKey(PrefsKey + ".z"); PlayerPrefs.DeleteKey(PrefsKey + ".w");
        PlayerPrefs.DeleteKey(PrefsKey + ".yaw");
        PlayerPrefs.Save();
        Debug.Log($"[Aligner:{name}] Cleared alignment; local rotation reset to identity.");
    }

    private void Apply()
    {
        Quaternion desiredWorld = mode == Mode.ForwardPointsUp
            ? Quaternion.LookRotation(Vector3.up, Vector3.forward)
            : Quaternion.Euler(0f, yawDegrees, 0f);
        transform.localRotation = Quaternion.Inverse(capturedParentRotation) * desiredWorld;
        appliedYaw = yawDegrees;
    }

    private void Save()
    {
        PlayerPrefs.SetFloat(PrefsKey + ".x", capturedParentRotation.x);
        PlayerPrefs.SetFloat(PrefsKey + ".y", capturedParentRotation.y);
        PlayerPrefs.SetFloat(PrefsKey + ".z", capturedParentRotation.z);
        PlayerPrefs.SetFloat(PrefsKey + ".w", capturedParentRotation.w);
        PlayerPrefs.SetFloat(PrefsKey + ".yaw", yawDegrees);
        PlayerPrefs.Save();
    }
}
