using System;
using UnityEngine;
using UnityEngine.InputSystem;

/// <summary>
/// Drives this transform with the pose of a SteamVR tracker exposed through
/// <see cref="ViveTrackerProfile"/>, and shows <see cref="visual"/> only while that tracker is
/// actually tracked.
///
/// This deliberately replaces a plain <c>TrackedPoseDriver</c>. SteamVR reports the tracker
/// interaction profile as active for <em>every</em> role user path at once, so Unity creates a
/// <see cref="ViveTrackerProfile.ViveTracker"/> device for all roles regardless of how many
/// physical trackers exist. A binding such as <c>&lt;ViveTracker&gt;/devicePosition</c> then sees
/// a dozen candidate devices, all but one of them untracked at the origin, and the Input System's
/// tie-breaking between them is not reliable (identity rotations all "actuate" equally). This
/// component instead picks the device that reports valid tracking, optionally restricted to one
/// role, and copies its pose directly.
///
/// The transform is expected to sit under the XR Origin's Camera Offset so that the tracker's
/// tracking-space pose maps into the same Floor-level room space as the headset and the cube.
/// </summary>
public class TrackerFollower : MonoBehaviour
{
    [Tooltip("The renderer object to toggle. Should be a child of this object.")]
    [SerializeField] private GameObject visual;

    [Tooltip("Optional SteamVR tracker role to follow (e.g. Waist, Camera). Leave empty to follow whichever " +
             "tracker is currently tracked; with several trackers connected, set this to pick one.")]
    [SerializeField] private string role = "";

    [Tooltip("How long a tracker may report an invalid pose before the visual is hidden. Brief marker occlusions " +
             "make SteamVR flag single frames as untracked; during the hold the visual stays at its last good pose.")]
    [SerializeField, Min(0f)] private float holdSeconds = 0.5f;

    // InputTrackingState bits as delivered by the OpenXR pose: 1 = position valid, 2 = rotation valid.
    private const int PoseValidBits = 3;
    private const float DiagnosticsInterval = 2f;

    private ViveTrackerProfile.ViveTracker current;
    private float lastValidTime;
    private float nextDiagnostics;

    private void Awake()
    {
        if (visual != null)
            visual.SetActive(false);
    }

    private void OnEnable()
    {
        // Refresh once more right before rendering so the puck uses the freshest pose available.
        Application.onBeforeRender += ApplyPose;
    }

    private void OnDisable()
    {
        Application.onBeforeRender -= ApplyPose;
        SetCurrent(null);
    }

    private void Update()
    {
        ApplyPose();

        // While nothing is being followed, periodically dump what every tracker device reports so
        // a missing puck can be diagnosed from the Console alone (role, flags, raw position).
        if (current == null && Time.unscaledTime >= nextDiagnostics)
        {
            nextDiagnostics = Time.unscaledTime + DiagnosticsInterval;
            LogDiagnostics();
        }
    }

    private void LogDiagnostics()
    {
        var sb = new System.Text.StringBuilder("[TrackerFollower] No tracker followed. Devices:");
        int count = 0;
        foreach (var device in InputSystem.devices)
        {
            if (device is not ViveTrackerProfile.ViveTracker tracker)
                continue;
            count++;
            sb.Append($"\n  {tracker.role,-14} isTracked={tracker.isTracked.isPressed,-5} " +
                      $"trackingState={tracker.trackingState.ReadValue()} pos={tracker.devicePosition.ReadValue()}");
        }
        if (count == 0)
            sb.Append(" (none - the Vive Tracker Profile feature is not active or the runtime lacks the extension)");
        Debug.Log(sb.ToString());
    }

    private void ApplyPose()
    {
        float now = Time.unscaledTime;

        if (current == null || !IsTracked(current))
        {
            var found = FindTracked();
            if (found != null)
            {
                SetCurrent(found);
            }
            else if (current != null)
            {
                // Momentary dropout: keep the visual at its last good pose for the hold period,
                // then give up. Nothing is read from the device while holding.
                if (now - lastValidTime <= holdSeconds)
                    return;
                SetCurrent(null);
            }
        }

        if (current == null)
            return;

        lastValidTime = now;
        transform.localPosition = current.devicePosition.ReadValue();
        transform.localRotation = current.deviceRotation.ReadValue();
    }

    private ViveTrackerProfile.ViveTracker FindTracked()
    {
        foreach (var device in InputSystem.devices)
        {
            if (device is ViveTrackerProfile.ViveTracker tracker && Matches(tracker) && IsTracked(tracker))
                return tracker;
        }
        return null;
    }

    private bool Matches(ViveTrackerProfile.ViveTracker tracker) =>
        string.IsNullOrEmpty(role) || string.Equals(tracker.role, role, StringComparison.OrdinalIgnoreCase);

    // A real Vive Tracker sets isTracked; virtual trackers pushed into SteamVR by a driver may only
    // report their position/rotation as *valid* without the "tracked" bits. Accept either, since a
    // role device with no tracker behind it reports neither.
    private static bool IsTracked(ViveTrackerProfile.ViveTracker tracker) =>
        tracker.added &&
        (tracker.isTracked.isPressed || (tracker.trackingState.ReadValue() & PoseValidBits) == PoseValidBits);

    private void SetCurrent(ViveTrackerProfile.ViveTracker tracker)
    {
        if (ReferenceEquals(tracker, current))
            return;

        current = tracker;
        if (visual != null)
            visual.SetActive(tracker != null);

        Debug.Log(tracker != null
            ? $"[TrackerFollower] Following tracker role='{tracker.role}' ({tracker.description.product})."
            : "[TrackerFollower] No tracked tracker; hiding visual.");
    }
}
