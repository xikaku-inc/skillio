using System.Collections.Generic;
using UnityEngine;
#if ENABLE_INPUT_SYSTEM
using UnityEngine.InputSystem;
#endif

/// <summary>
/// Discrete keyboard repositioning of this GameObject while in Play mode.
/// Every key press moves the object by exactly one step of size <see cref="stepSize"/>
/// (no held-key repeat), and Z/X yaw it around the world Y axis by
/// <see cref="yawStepDegrees"/> per press. Holding Shift scales both the move
/// and the yaw step by <see cref="FineFactor"/> for fine alignment. Works with
/// either the new Input System or the legacy Input Manager, whichever is
/// active, so it compiles and runs regardless of the project's Active Input
/// Handling setting.
/// </summary>
public class CubeMover : MonoBehaviour
{
    [SerializeField] private float stepSize = 0.1f; // meters per press; 10 cm default, one cube-length per press
    [SerializeField] private float yawStepDegrees = 5f; // degrees per Z/X press

    [Tooltip("Name shown in the on-screen overlay and Console logs, e.g. Cube or Crosshair.")]
    [SerializeField] private string displayName = "Cube";

    [Tooltip("Which mover owns the keyboard when Play starts. Tab cycles through all enabled movers.")]
    [SerializeField] private bool focusedByDefault;

    private const float FineFactor = 0.1f; // step multiplier while Shift is held

    // Several objects share the same keyboard scheme; only the focused one reacts to it.
    private static readonly List<CubeMover> All = new List<CubeMover>();
    private static CubeMover focused;
    private static int lastTabFrame = -1;

    private Vector3 spawnPosition;
    private Quaternion spawnRotation;

    private void OnEnable()
    {
        All.Add(this);
        if (focused == null || focusedByDefault)
            focused = this;
    }

    private void OnDisable()
    {
        All.Remove(this);
        if (focused == this)
            focused = All.Count > 0 ? All[0] : null;
    }

    private void Start()
    {
        spawnPosition = transform.position;
        spawnRotation = transform.rotation;
    }

    /// <summary>Tab moves keyboard focus to the next enabled mover. Guarded so that only one
    /// instance per frame acts on the key press.</summary>
    private static void HandleFocusCycle(bool tabPressed)
    {
        if (!tabPressed || lastTabFrame == Time.frameCount || All.Count == 0)
            return;
        lastTabFrame = Time.frameCount;
        int i = Mathf.Max(0, All.IndexOf(focused));
        focused = All[(i + 1) % All.Count];
        Debug.Log("CubeMover: keyboard focus -> " + focused.displayName);
    }

    private void Update()
    {
#if ENABLE_INPUT_SYSTEM
        if (Mouse.current != null && Mouse.current.rightButton.isPressed)
        {
            // Right mouse button drives DesktopFlyCamera's look/fly controls;
            // don't also step the cube while flying.
            return;
        }

        Keyboard keyboard = Keyboard.current;
        if (keyboard == null)
        {
            return;
        }

        HandleFocusCycle(keyboard.tabKey.wasPressedThisFrame);
        if (focused != this)
        {
            return;
        }

        bool fine = keyboard.leftShiftKey.isPressed || keyboard.rightShiftKey.isPressed;
        float step = stepSize * (fine ? FineFactor : 1f);
        float yawStep = yawStepDegrees * (fine ? FineFactor : 1f);

        Vector3 pos = transform.position;
        bool moved = false;
        float yawDelta = 0f;

        if (keyboard.wKey.wasPressedThisFrame || keyboard.upArrowKey.wasPressedThisFrame)
        {
            pos += Vector3.forward * step;
            moved = true;
        }
        if (keyboard.sKey.wasPressedThisFrame || keyboard.downArrowKey.wasPressedThisFrame)
        {
            pos += Vector3.back * step;
            moved = true;
        }
        if (keyboard.aKey.wasPressedThisFrame || keyboard.leftArrowKey.wasPressedThisFrame)
        {
            pos += Vector3.left * step;
            moved = true;
        }
        if (keyboard.dKey.wasPressedThisFrame || keyboard.rightArrowKey.wasPressedThisFrame)
        {
            pos += Vector3.right * step;
            moved = true;
        }
        if (keyboard.eKey.wasPressedThisFrame || keyboard.pageUpKey.wasPressedThisFrame)
        {
            pos += Vector3.up * step;
            moved = true;
        }
        if (keyboard.qKey.wasPressedThisFrame || keyboard.pageDownKey.wasPressedThisFrame || keyboard.leftCtrlKey.wasPressedThisFrame)
        {
            pos += Vector3.down * step;
            moved = true;
        }

        if (keyboard.zKey.wasPressedThisFrame)
        {
            yawDelta -= yawStep;
        }
        if (keyboard.xKey.wasPressedThisFrame)
        {
            yawDelta += yawStep;
        }

        if (keyboard.rKey.wasPressedThisFrame)
        {
            pos = spawnPosition;
            transform.rotation = spawnRotation;
            moved = true;
        }

        if (keyboard.digit1Key.wasPressedThisFrame)
        {
            stepSize = 0.001f;
        }
        else if (keyboard.digit2Key.wasPressedThisFrame)
        {
            stepSize = 0.01f;
        }
        else if (keyboard.digit3Key.wasPressedThisFrame)
        {
            stepSize = 0.1f;
        }
        else if (keyboard.digit4Key.wasPressedThisFrame)
        {
            stepSize = 1f;
        }

        if (moved)
        {
            transform.position = pos;
            Debug.Log(displayName + ": new position = " + pos.ToString("F3"));
        }
        if (yawDelta != 0f)
        {
            transform.Rotate(0f, yawDelta, 0f, Space.World);
            Debug.Log(displayName + ": new yaw = " + transform.eulerAngles.y.ToString("F1") + " deg");
        }
#else
        if (Input.GetMouseButton(1))
        {
            // Right mouse button drives DesktopFlyCamera's look/fly controls;
            // don't also step the cube while flying.
            return;
        }

        HandleFocusCycle(Input.GetKeyDown(KeyCode.Tab));
        if (focused != this)
        {
            return;
        }

        bool fine = Input.GetKey(KeyCode.LeftShift) || Input.GetKey(KeyCode.RightShift);
        float step = stepSize * (fine ? FineFactor : 1f);
        float yawStep = yawStepDegrees * (fine ? FineFactor : 1f);

        Vector3 pos = transform.position;
        bool moved = false;
        float yawDelta = 0f;

        if (Input.GetKeyDown(KeyCode.W) || Input.GetKeyDown(KeyCode.UpArrow))
        {
            pos += Vector3.forward * step;
            moved = true;
        }
        if (Input.GetKeyDown(KeyCode.S) || Input.GetKeyDown(KeyCode.DownArrow))
        {
            pos += Vector3.back * step;
            moved = true;
        }
        if (Input.GetKeyDown(KeyCode.A) || Input.GetKeyDown(KeyCode.LeftArrow))
        {
            pos += Vector3.left * step;
            moved = true;
        }
        if (Input.GetKeyDown(KeyCode.D) || Input.GetKeyDown(KeyCode.RightArrow))
        {
            pos += Vector3.right * step;
            moved = true;
        }
        if (Input.GetKeyDown(KeyCode.E) || Input.GetKeyDown(KeyCode.PageUp))
        {
            pos += Vector3.up * step;
            moved = true;
        }
        if (Input.GetKeyDown(KeyCode.Q) || Input.GetKeyDown(KeyCode.PageDown) || Input.GetKeyDown(KeyCode.LeftControl))
        {
            pos += Vector3.down * step;
            moved = true;
        }

        if (Input.GetKeyDown(KeyCode.Z))
        {
            yawDelta -= yawStep;
        }
        if (Input.GetKeyDown(KeyCode.X))
        {
            yawDelta += yawStep;
        }

        if (Input.GetKeyDown(KeyCode.R))
        {
            pos = spawnPosition;
            transform.rotation = spawnRotation;
            moved = true;
        }

        if (Input.GetKeyDown(KeyCode.Alpha1))
        {
            stepSize = 0.001f;
        }
        else if (Input.GetKeyDown(KeyCode.Alpha2))
        {
            stepSize = 0.01f;
        }
        else if (Input.GetKeyDown(KeyCode.Alpha3))
        {
            stepSize = 0.1f;
        }
        else if (Input.GetKeyDown(KeyCode.Alpha4))
        {
            stepSize = 1f;
        }

        if (moved)
        {
            transform.position = pos;
            Debug.Log(displayName + ": new position = " + pos.ToString("F3"));
        }
        if (yawDelta != 0f)
        {
            transform.Rotate(0f, yawDelta, 0f, Space.World);
            Debug.Log(displayName + ": new yaw = " + transform.eulerAngles.y.ToString("F1") + " deg");
        }
#endif
    }

    private void OnGUI()
    {
        if (focused != this)
        {
            return;
        }

        GUI.Label(new Rect(10, 10, 560, 62),
            "[" + displayName + "]  Pos: " + transform.position.ToString("F3") + "   Yaw: " + transform.eulerAngles.y.ToString("F1") + " deg   Step: " + stepSize + " m\n" +
            "WASD/Arrows: move   Down/Up: Q/E, PgDn/PgUp (Ctrl: down)   Z/X: yaw   Tab: next object   Space: new screw target\n" +
            "Shift: fine (x0.1)   R: reset   1-4: 1mm/1cm/10cm/1m");
    }
}
