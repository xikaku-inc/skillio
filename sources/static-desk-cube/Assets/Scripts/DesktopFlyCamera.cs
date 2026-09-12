using UnityEngine;
#if ENABLE_INPUT_SYSTEM
using UnityEngine.InputSystem;
#endif
using UnityEngine.XR.Management;

/// <summary>
/// Unity-Scene-View-style desktop navigation for exploring <c>DeskCube.unity</c> on a flat
/// screen, with no XR headset attached. Hold the right mouse button to look around (mouse)
/// and fly (WASD/QE), exactly like the editor's Scene view camera.
///
/// This component only ever exists when no XR device actually initialized: the
/// <see cref="Bootstrap"/> method below runs once after the scene loads, checks whether an
/// XR loader is active, and — only if it isn't — attaches this component to
/// <see cref="Camera.main"/>. Nothing in the scene asset changes to make this work, and on a
/// real headset the component is never added at all.
/// </summary>
public class DesktopFlyCamera : MonoBehaviour
{
    // Tuned to feel roughly like the Unity editor's Scene view camera.
    private const float LookSensitivityInputSystem = 0.12f; // degrees per pixel of Mouse.delta
    private const float LookSensitivityLegacy = 5f;          // degrees per unit of Input.GetAxis("Mouse X/Y")
    private const float PitchClamp = 89f;

    private const float BaseSpeedDefault = 2f; // m/s
    private const float FastMultiplier = 4f;   // Left Shift
    private const float MinSpeed = 0.2f;
    private const float MaxSpeed = 20f;
    private const float ScrollSpeedFactor = 1.2f; // multiplicative speed change per scroll unit

    private float baseSpeed = BaseSpeedDefault;
    private float yaw;
    private float pitch;
    private bool cursorLocked;

    /// <summary>
    /// Runs once after the scene loads. Attaches <see cref="DesktopFlyCamera"/> to the main
    /// camera only when no XR loader is active (i.e. no headset/OpenXR runtime initialized),
    /// so the desktop simulation view and an active XR session never coexist.
    /// </summary>
    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
    private static void Bootstrap()
    {
        if (IsXRActive())
        {
            return;
        }

        Camera cam = Camera.main;
        if (cam == null)
        {
            return;
        }

        // With the rig in Floor tracking-origin mode the camera starts at the
        // world origin (floor level, inside the cube). Head tracking would lift
        // it on a headset, but on the desktop nothing does, so hoist the camera
        // to a standing-height vantage behind the cube looking down at it.
        cam.transform.SetPositionAndRotation(
            new Vector3(0f, 1.2f, -0.8f), Quaternion.Euler(45f, 0f, 0f));

        cam.gameObject.AddComponent<DesktopFlyCamera>();
    }

    private static bool IsXRActive()
    {
        try
        {
            return XRGeneralSettings.Instance?.Manager?.activeLoader != null;
        }
        catch
        {
            // Any failure querying XR state is treated as "no XR" so the desktop
            // simulation view degrades gracefully instead of throwing at startup.
            return false;
        }
    }

    private void Start()
    {
        // Seed yaw/pitch from however this camera is already oriented so the first
        // right-mouse-button press doesn't snap it to a different look direction.
        Vector3 startEuler = transform.localEulerAngles;
        yaw = startEuler.y;
        pitch = Mathf.Clamp(NormalizeAngle(startEuler.x), -PitchClamp, PitchClamp);
    }

    private void Update()
    {
#if ENABLE_INPUT_SYSTEM
        Mouse mouse = Mouse.current;
        Keyboard keyboard = Keyboard.current;
        bool held = mouse != null && mouse.rightButton.isPressed;

        SetCursorLocked(held);
        if (!held || keyboard == null)
        {
            return;
        }

        Vector2 mouseDelta = mouse.delta.ReadValue();
        ApplyLook(mouseDelta.x, mouseDelta.y, LookSensitivityInputSystem);
        ApplyScrollToSpeed(mouse.scroll.ReadValue().y);

        Vector3 move = Vector3.zero;
        if (keyboard.wKey.isPressed) move += transform.forward;
        if (keyboard.sKey.isPressed) move -= transform.forward;
        if (keyboard.dKey.isPressed) move += transform.right;
        if (keyboard.aKey.isPressed) move -= transform.right;
        if (keyboard.eKey.isPressed) move += Vector3.up;
        if (keyboard.qKey.isPressed) move -= Vector3.up;

        float currentSpeed = baseSpeed * (keyboard.leftShiftKey.isPressed ? FastMultiplier : 1f);
        ApplyMove(move, currentSpeed);
#else
        bool held = Input.GetMouseButton(1);

        SetCursorLocked(held);
        if (!held)
        {
            return;
        }

        ApplyLook(Input.GetAxis("Mouse X"), Input.GetAxis("Mouse Y"), LookSensitivityLegacy);
        ApplyScrollToSpeed(Input.mouseScrollDelta.y);

        Vector3 move = Vector3.zero;
        if (Input.GetKey(KeyCode.W)) move += transform.forward;
        if (Input.GetKey(KeyCode.S)) move -= transform.forward;
        if (Input.GetKey(KeyCode.D)) move += transform.right;
        if (Input.GetKey(KeyCode.A)) move -= transform.right;
        if (Input.GetKey(KeyCode.E)) move += Vector3.up;
        if (Input.GetKey(KeyCode.Q)) move -= Vector3.up;

        float currentSpeed = baseSpeed * (Input.GetKey(KeyCode.LeftShift) ? FastMultiplier : 1f);
        ApplyMove(move, currentSpeed);
#endif
    }

    /// <summary>Hides/locks the cursor while RMB is held, restores it on release.</summary>
    private void SetCursorLocked(bool wantLocked)
    {
        if (wantLocked == cursorLocked)
        {
            return;
        }

        cursorLocked = wantLocked;
        Cursor.lockState = wantLocked ? CursorLockMode.Locked : CursorLockMode.None;
        Cursor.visible = !wantLocked;
    }

    /// <summary>Yaw around world up, pitch around the local right axis, clamped to +-89 deg.</summary>
    private void ApplyLook(float deltaX, float deltaY, float sensitivity)
    {
        yaw += deltaX * sensitivity;
        pitch = Mathf.Clamp(pitch - deltaY * sensitivity, -PitchClamp, PitchClamp);
        transform.localRotation = Quaternion.Euler(pitch, yaw, 0f);
    }

    private void ApplyScrollToSpeed(float scroll)
    {
        if (Mathf.Approximately(scroll, 0f))
        {
            return;
        }

        baseSpeed = Mathf.Clamp(baseSpeed * Mathf.Pow(ScrollSpeedFactor, scroll), MinSpeed, MaxSpeed);
    }

    private void ApplyMove(Vector3 direction, float currentSpeed)
    {
        if (direction.sqrMagnitude <= 0f)
        {
            return;
        }

        transform.position += direction.normalized * currentSpeed * Time.deltaTime;
    }

    private static float NormalizeAngle(float angle)
    {
        angle %= 360f;
        if (angle > 180f) angle -= 360f;
        if (angle < -180f) angle += 360f;
        return angle;
    }

    private void OnGUI()
    {
        GUI.Label(new Rect(10, 76, 460, 20),
            "Sim view: hold RMB to look, +WASD fly, E/Q up/down, Shift fast, scroll speed");
    }
}
