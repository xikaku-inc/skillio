using UnityEngine;

/// <summary>
/// Forces the main camera to a transparent-black background (solid color,
/// alpha 0) so mixed-reality OpenXR runtimes (e.g. Varjo passthrough) can
/// composite the real world behind the scene's virtual content. On a
/// desktop run with no passthrough compositor, this just renders as plain
/// black.
/// </summary>
public static class PassthroughBackground
{
    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
    private static void Bootstrap()
    {
        Camera cam = Camera.main;
        if (cam == null)
        {
            cam = Object.FindFirstObjectByType<Camera>();
        }

        if (cam == null)
        {
            return;
        }

        cam.clearFlags = CameraClearFlags.SolidColor;
        cam.backgroundColor = new Color(0f, 0f, 0f, 0f);
    }
}
