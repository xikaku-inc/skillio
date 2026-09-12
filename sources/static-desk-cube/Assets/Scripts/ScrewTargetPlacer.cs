using UnityEngine;
#if ENABLE_INPUT_SYSTEM
using UnityEngine.InputSystem;
#endif

/// <summary>
/// Places this object (the crosshair) on the top face of a <see cref="WireframeBox"/> and jumps it
/// to a new random spot on that face each time Space is pressed. The box's size and centre are
/// taken from the wireframe, so once the wireframe hugs the real board, the crosshair lands on the
/// real wood.
///
/// "Top face" is decided at jump time as the box face whose outward normal points most upward in
/// world space, so it works whichever box axis is the board's thickness and however the board is
/// lying. The crosshair is oriented with its arms in the face plane and its tick along the face
/// normal. Positions are also logged in the board's local frame, which is what a guidance
/// sequence will later need to compare against the screwdriver tip.
/// </summary>
public class ScrewTargetPlacer : MonoBehaviour
{
    [Tooltip("The wireframe whose top face the crosshair is placed on.")]
    [SerializeField] private WireframeBox board;

    [Tooltip("Keep-out distance from the face edges, in meters, so targets never sit on an edge.")]
    [SerializeField, Min(0f)] private float edgeMargin = 0.02f;

    [Tooltip("0 = different sequence every run; any other value gives a repeatable sequence of positions.")]
    [SerializeField] private int randomSeed;

    /// <summary>Last target in the board's local frame (the wireframe transform's space).</summary>
    public Vector3 CurrentBoardLocal { get; private set; }

    private System.Random rng;

    private void Start()
    {
        rng = randomSeed == 0 ? new System.Random() : new System.Random(randomSeed);
        Jump();
    }

    private void Update()
    {
        bool pressed;
#if ENABLE_INPUT_SYSTEM
        var kb = Keyboard.current;
        pressed = kb != null && kb.spaceKey.wasPressedThisFrame;
#else
        pressed = Input.GetKeyDown(KeyCode.Space);
#endif
        if (pressed)
            Jump();
    }

    /// <summary>Move to a new random point on the board's top face.</summary>
    public void Jump()
    {
        if (board == null)
        {
            Debug.LogWarning("[ScrewTarget] No board wireframe assigned; cannot place the crosshair.");
            return;
        }

        Transform bt = board.transform;
        Vector3[] axes = { bt.right, bt.up, bt.forward };
        Vector3 half = board.Size * 0.5f;

        // Box axis pointing most upward in world space = top face normal.
        int up = 0;
        float best = -1f;
        float sign = 1f;
        for (int i = 0; i < 3; i++)
        {
            float d = Vector3.Dot(axes[i], Vector3.up);
            if (Mathf.Abs(d) > best)
            {
                best = Mathf.Abs(d);
                up = i;
                sign = d < 0f ? -1f : 1f;
            }
        }
        int a = (up + 1) % 3;
        int b = (up + 2) % 3;

        Vector3 local = board.Center;
        local[up] += sign * half[up];
        local[a] += Random(Mathf.Max(0f, half[a] - edgeMargin));
        local[b] += Random(Mathf.Max(0f, half[b] - edgeMargin));
        CurrentBoardLocal = local;

        Vector3 normal = sign * axes[up];
        transform.position = bt.TransformPoint(local);
        transform.rotation = Quaternion.LookRotation(axes[b], normal);

        Debug.Log($"[ScrewTarget] Crosshair on board top face at board-local {local:F3}.");
    }

    private float Random(float halfRange) => (float)(rng.NextDouble() * 2.0 - 1.0) * halfRange;
}
