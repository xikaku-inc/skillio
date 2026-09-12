using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.Controls;
using UnityEngine.InputSystem.Layouts;
using UnityEngine.InputSystem.Utilities;
using UnityEngine.InputSystem.XR;
using UnityEngine.Scripting;
using UnityEngine.XR;
using UnityEngine.XR.OpenXR;
using UnityEngine.XR.OpenXR.Features;
using UnityEngine.XR.OpenXR.Input;

#if UNITY_EDITOR
using UnityEditor;
using UnityEditor.XR.OpenXR.Features;
#endif

#if USE_INPUT_SYSTEM_POSE_CONTROL
using PoseControl = UnityEngine.InputSystem.XR.PoseControl;
#else
using PoseControl = UnityEngine.XR.OpenXR.Input.PoseControl;
#endif

/// <summary>
/// OpenXR interaction feature that exposes SteamVR trackers (HTC Vive Tracker, Tundra Tracker,
/// or any other device SteamVR lists under "Manage Trackers") to the Unity Input System via the
/// <c>XR_HTCX_vive_tracker_interaction</c> extension.
///
/// Core OpenXR has no notion of a generic tracker; the extension models each tracker as a
/// separate top-level user path named after the body role it was assigned in SteamVR
/// (<c>/user/vive_tracker_htcx/role/waist</c>, <c>.../role/camera</c>, ...). This feature
/// registers one action map per role, all bound to the tracker's grip pose. Each connected
/// tracker then shows up as a <see cref="ViveTracker"/> input device whose usage is the role
/// name, so it can be bound in a <c>TrackedPoseDriver</c> as <c>&lt;ViveTracker&gt;/devicePosition</c>
/// (any tracker) or <c>&lt;ViveTracker&gt;{Waist}/devicePosition</c> (a specific role).
///
/// SteamVR only exposes trackers that have a role assigned (SteamVR Settings > Controllers >
/// Manage Trackers) and that are powered on when the OpenXR session starts. A tracker set to
/// "Held in hand" is reported as a hand controller instead and will not appear here.
/// </summary>
#if UNITY_EDITOR
[OpenXRFeature(UiName = "Vive Tracker Profile",
    BuildTargetGroups = new[] { BuildTargetGroup.Standalone },
    Company = "Static Desk Cube",
    Desc = "Exposes SteamVR trackers (XR_HTCX_vive_tracker_interaction) as ViveTracker input devices, one per assigned tracker role.",
    DocumentationLink = "https://registry.khronos.org/OpenXR/specs/1.0/html/xrspec.html#XR_HTCX_vive_tracker_interaction",
    OpenxrExtensionStrings = ExtensionString,
    Version = "0.0.1",
    Category = FeatureCategory.Interaction,
    FeatureId = FeatureId)]
#endif
public class ViveTrackerProfile : OpenXRInteractionFeature
{
    public const string FeatureId = "com.staticdeskcube.openxr.feature.input.vivetracker";
    public const string ExtensionString = "XR_HTCX_vive_tracker_interaction";

    /// <summary>Interaction profile path defined by the extension.</summary>
    public const string Profile = "/interaction_profiles/htc/vive_tracker_htcx";

    /// <summary>Grip pose binding, the only input this project needs from a tracker.</summary>
    public const string GripPose = "/input/grip/pose";

    private const string UserPathPrefix = "/user/vive_tracker_htcx/role/";

    /// <summary>
    /// Product-name prefix shared by every tracker device. The role name is appended, which is
    /// how <see cref="ViveTracker.FinishSetup"/> recovers the role (the Input System device
    /// description carries no user path).
    /// </summary>
    private const string DeviceNamePrefix = "Vive Tracker OpenXR ";

    /// <summary>Input System layout name, i.e. the <c>&lt;ViveTracker&gt;</c> in binding paths.</summary>
    public const string LayoutName = "ViveTracker";

    /// <summary>
    /// Tracker roles from the extension spec (revision 1), as (user-path segment, Input System
    /// usage) pairs. Only roles SteamVR is known to accept are listed: suggesting a binding on an
    /// unsupported role path makes the runtime reject the whole interaction profile.
    /// </summary>
    private static readonly (string Path, string Usage)[] Roles =
    {
        ("handheld_object", "HandheldObject"),
        ("left_foot", "LeftFoot"),
        ("right_foot", "RightFoot"),
        ("left_shoulder", "LeftShoulder"),
        ("right_shoulder", "RightShoulder"),
        ("left_elbow", "LeftElbow"),
        ("right_elbow", "RightElbow"),
        ("left_knee", "LeftKnee"),
        ("right_knee", "RightKnee"),
        ("waist", "Waist"),
        ("chest", "Chest"),
        ("camera", "Camera"),
        ("keyboard", "Keyboard"),
    };

    /// <summary>
    /// Input System device for one tracker. Pose data lives at the same state offsets as the
    /// built-in OpenXR controller layouts so <c>devicePosition</c>/<c>deviceRotation</c>/
    /// <c>trackingState</c> can be bound directly by a <c>TrackedPoseDriver</c>.
    /// </summary>
    [Preserve, InputControlLayout(displayName = "Vive Tracker (OpenXR)", commonUsages = new[]
    {
        "HandheldObject", "LeftFoot", "RightFoot", "LeftShoulder", "RightShoulder", "LeftElbow",
        "RightElbow", "LeftKnee", "RightKnee", "Waist", "Chest", "Camera", "Keyboard"
    })]
    public class ViveTracker : OpenXRDevice
    {
        /// <summary>The grip pose of the tracker.</summary>
        [Preserve, InputControl(offset = 0, aliases = new[] { "device", "gripPose" }, usage = "Device")]
        public PoseControl devicePose { get; private set; }

        [Preserve, InputControl(offset = 0)]
        public ButtonControl isTracked { get; private set; }

        [Preserve, InputControl(offset = 4)]
        public IntegerControl trackingState { get; private set; }

        [Preserve, InputControl(offset = 8, noisy = true)]
        public Vector3Control devicePosition { get; private set; }

        [Preserve, InputControl(offset = 20, noisy = true)]
        public QuaternionControl deviceRotation { get; private set; }

        /// <summary>The SteamVR tracker role this device represents, e.g. "Waist". Empty if unknown.</summary>
        public string role { get; private set; } = "";

        protected override void FinishSetup()
        {
            base.FinishSetup();
            devicePose = GetChildControl<PoseControl>("devicePose");
            isTracked = GetChildControl<ButtonControl>("isTracked");
            trackingState = GetChildControl<IntegerControl>("trackingState");
            devicePosition = GetChildControl<Vector3Control>("devicePosition");
            deviceRotation = GetChildControl<QuaternionControl>("deviceRotation");

            var product = description.product ?? "";
            if (product.StartsWith(DeviceNamePrefix, StringComparison.Ordinal))
            {
                role = product.Substring(DeviceNamePrefix.Length).Trim();
                if (role.Length > 0)
                    InputSystem.SetDeviceUsage(this, new InternedString(role));
            }
        }
    }

    protected override bool OnInstanceCreate(ulong xrInstance)
    {
        if (!OpenXRRuntime.IsExtensionEnabled(ExtensionString))
        {
            Debug.LogWarning($"[ViveTrackerProfile] The active OpenXR runtime does not provide {ExtensionString}; " +
                             "trackers will not be available. SteamVR supports it; Varjo Base and most others do not.");
            return false;
        }

        return base.OnInstanceCreate(xrInstance);
    }

    protected override void RegisterDeviceLayout()
    {
#if UNITY_EDITOR
        if (!OpenXRLoaderEnabledForSelectedBuildTarget(EditorUserBuildSettings.selectedBuildTargetGroup))
            return;
#endif
        // Every role's device name starts with DeviceNamePrefix, so a single layout matches them all.
        InputSystem.RegisterLayout(typeof(ViveTracker), LayoutName,
            matches: new InputDeviceMatcher()
                .WithInterface(XRUtilities.InterfaceMatchAnyVersion)
                .WithProduct(DeviceNamePrefix.TrimEnd() + ".*"));
    }

    protected override void UnregisterDeviceLayout()
    {
#if UNITY_EDITOR
        if (!OpenXRLoaderEnabledForSelectedBuildTarget(EditorUserBuildSettings.selectedBuildTargetGroup))
            return;
#endif
        InputSystem.RemoveLayout(LayoutName);
    }

    protected override string GetDeviceLayoutName() => LayoutName;

    protected override InteractionProfileType GetInteractionProfileType() => InteractionProfileType.Device;

    protected override void RegisterActionMapsWithRuntime()
    {
        // One action map (= one OpenXR action set) per role. All devices inside a single action map
        // would share the same product name, and the Input System would then have no way to tell
        // roles apart; a map per role gives each tracker a distinct name ending in its role.
        // The OpenXR plugin merges the suggested bindings of all maps per interaction profile, so
        // this still results in exactly one xrSuggestInteractionProfileBindings call for the profile.
        foreach (var (path, usage) in Roles)
        {
            AddActionMap(new ActionMapConfig
            {
                name = "vivetracker" + path.Replace("_", ""),
                localizedName = DeviceNamePrefix + usage,
                desiredInteractionProfile = Profile,
                manufacturer = "HTC",
                serialNumber = "",
                deviceInfos = new List<DeviceConfig>
                {
                    new DeviceConfig
                    {
                        characteristics = InputDeviceCharacteristics.TrackedDevice,
                        userPath = UserPathPrefix + path,
                    }
                },
                actions = new List<ActionConfig>
                {
                    new ActionConfig
                    {
                        name = "devicePose",
                        localizedName = "Device Pose",
                        type = ActionType.Pose,
                        usages = new List<string> { "Device" },
                        bindings = new List<ActionBinding>
                        {
                            new ActionBinding
                            {
                                interactionPath = GripPose,
                                interactionProfileName = Profile,
                            }
                        }
                    }
                }
            });
        }
    }
}
