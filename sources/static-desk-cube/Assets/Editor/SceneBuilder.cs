using System;
using Unity.XR.CoreUtils;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEditor.XR.Management;
using UnityEditor.XR.Management.Metadata;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.XR;
using UnityEngine.SceneManagement;
using UnityEngine.XR.Management;

/// <summary>
/// Batchmode-only scene construction for Assets/Scenes/DeskCube.unity.
/// Builds the desk + movable cube + XR rig hierarchy, creates real material
/// assets, saves the scene, wires it into EditorBuildSettings, configures the
/// OpenXR loader for Standalone, and sets Active Input Handling to "Both".
/// </summary>
public static class SceneBuilder
{
    private const string ScenePath = "Assets/Scenes/DeskCube.unity";

    public static void Build()
    {
        try
        {
            EnsureFolder("Assets/Scenes");
            EnsureFolder("Assets/Materials");

            Scene scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

            CreateLight();
            CreateFloor();
            CreateDesk();
            CreateMovableCube();
            CreateXROrigin();

            bool saved = EditorSceneManager.SaveScene(scene, ScenePath);
            if (!saved)
            {
                throw new Exception("EditorSceneManager.SaveScene returned false for " + ScenePath);
            }

            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };

            ConfigureOpenXR();
            TryAddKhronosSimpleControllerProfile();
            SetActiveInputHandlingBoth();

            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();

            Debug.Log("SCENEBUILDER SUCCESS");
            EditorApplication.Exit(0);
        }
        catch (Exception e)
        {
            Debug.LogError("SceneBuilder failed: " + e);
            EditorApplication.Exit(1);
        }
    }

    private static void EnsureFolder(string path)
    {
        if (AssetDatabase.IsValidFolder(path))
        {
            return;
        }

        string parent = System.IO.Path.GetDirectoryName(path)?.Replace("\\", "/");
        string leaf = System.IO.Path.GetFileName(path);
        if (!string.IsNullOrEmpty(parent) && !AssetDatabase.IsValidFolder(parent))
        {
            EnsureFolder(parent);
        }
        AssetDatabase.CreateFolder(parent, leaf);
    }

    private static Material CreateMaterial(string name, Color color)
    {
        string path = "Assets/Materials/" + name + ".mat";
        Material existing = AssetDatabase.LoadAssetAtPath<Material>(path);
        if (existing != null)
        {
            existing.color = color;
            return existing;
        }

        Shader shader = Shader.Find("Standard");
        Material mat = new Material(shader) { color = color };
        AssetDatabase.CreateAsset(mat, path);
        return mat;
    }

    private static void CreateLight()
    {
        GameObject lightGo = new GameObject("Directional Light");
        Light light = lightGo.AddComponent<Light>();
        light.type = LightType.Directional;
        light.intensity = 1f;
        light.shadows = LightShadows.Soft;
        lightGo.transform.rotation = Quaternion.Euler(50f, -30f, 0f);
    }

    private static void CreateFloor()
    {
        GameObject floor = GameObject.CreatePrimitive(PrimitiveType.Plane);
        floor.name = "Floor";
        // Default Unity plane is already 10x10 world units at scale 1.
        floor.transform.position = new Vector3(0f, -0.75f, 0f);
        floor.transform.localScale = Vector3.one;
        floor.GetComponent<MeshRenderer>().sharedMaterial = CreateMaterial("LightGray", new Color(0.8f, 0.8f, 0.8f));
    }

    private static void CreateDesk()
    {
        GameObject desk = new GameObject("Desk");
        desk.transform.position = Vector3.zero;

        Material wood = CreateMaterial("WoodBrown", new Color(0.45f, 0.29f, 0.15f));

        // Top slab: 1.2 x 0.04 x 0.7, top surface exactly at world y = 0 => center y = -0.02.
        GameObject top = GameObject.CreatePrimitive(PrimitiveType.Cube);
        top.name = "DeskTop";
        top.transform.SetParent(desk.transform, false);
        top.transform.localPosition = new Vector3(0f, -0.02f, 0f);
        top.transform.localScale = new Vector3(1.2f, 0.04f, 0.7f);
        top.GetComponent<MeshRenderer>().sharedMaterial = wood;

        // 4 legs: 0.05 x 0.71 x 0.05, from floor (y=-0.75) up to slab bottom (y=-0.04).
        // Center y = -0.75 + 0.71/2 = -0.395.
        Vector3[] legLocalPositions =
        {
            new Vector3( 0.5f, -0.395f,  0.25f),
            new Vector3(-0.5f, -0.395f,  0.25f),
            new Vector3( 0.5f, -0.395f, -0.25f),
            new Vector3(-0.5f, -0.395f, -0.25f),
        };
        string[] legNames = { "Leg_FrontRight", "Leg_FrontLeft", "Leg_BackRight", "Leg_BackLeft" };

        for (int i = 0; i < legLocalPositions.Length; i++)
        {
            GameObject leg = GameObject.CreatePrimitive(PrimitiveType.Cube);
            leg.name = legNames[i];
            leg.transform.SetParent(desk.transform, false);
            leg.transform.localPosition = legLocalPositions[i];
            leg.transform.localScale = new Vector3(0.05f, 0.71f, 0.05f);
            leg.GetComponent<MeshRenderer>().sharedMaterial = wood;
        }
    }

    private static void CreateMovableCube()
    {
        GameObject movableCube = new GameObject("MovableCube");
        movableCube.transform.position = Vector3.zero;
        movableCube.AddComponent<CubeMover>();

        GameObject visual = GameObject.CreatePrimitive(PrimitiveType.Cube);
        visual.name = "CubeVisual";
        visual.transform.SetParent(movableCube.transform, false);
        visual.transform.localPosition = new Vector3(0f, 0.1f, 0f);
        visual.transform.localScale = new Vector3(0.2f, 0.2f, 0.2f);
        visual.GetComponent<MeshRenderer>().sharedMaterial = CreateMaterial("BrightOrange", new Color(1f, 0.45f, 0f));
    }

    private static void CreateXROrigin()
    {
        GameObject xrOriginGo = new GameObject("XR Origin");
        xrOriginGo.transform.position = new Vector3(0f, 0f, -0.8f);

        GameObject cameraOffsetGo = new GameObject("Camera Offset");
        cameraOffsetGo.transform.SetParent(xrOriginGo.transform, false);

        GameObject mainCameraGo = new GameObject("Main Camera");
        mainCameraGo.transform.SetParent(cameraOffsetGo.transform, false);
        mainCameraGo.tag = "MainCamera";

        Camera cam = mainCameraGo.AddComponent<Camera>();
        cam.nearClipPlane = 0.05f;
        cam.clearFlags = CameraClearFlags.SolidColor;
        cam.backgroundColor = new Color(0.1f, 0.1f, 0.1f, 1f);
        mainCameraGo.AddComponent<AudioListener>();

        TrackedPoseDriver tpd = mainCameraGo.AddComponent<TrackedPoseDriver>();
        InputAction positionAction = new InputAction("Position", InputActionType.Value, "<XRHMD>/centerEyePosition", expectedControlType: "Vector3");
        InputAction rotationAction = new InputAction("Rotation", InputActionType.Value, "<XRHMD>/centerEyeRotation", expectedControlType: "Quaternion");
        positionAction.Enable();
        rotationAction.Enable();
        tpd.positionAction = positionAction;
        tpd.rotationAction = rotationAction;
        tpd.trackingType = TrackedPoseDriver.TrackingType.RotationAndPosition;
        tpd.updateType = TrackedPoseDriver.UpdateType.UpdateAndBeforeRender;

        XROrigin xrOrigin = xrOriginGo.AddComponent<XROrigin>();
        xrOrigin.Camera = cam;
        xrOrigin.CameraFloorOffsetObject = cameraOffsetGo;
        xrOrigin.RequestedTrackingOriginMode = XROrigin.TrackingOriginMode.Device;
        xrOrigin.CameraYOffset = 1.2f;
    }

    private static void ConfigureOpenXR()
    {
        const BuildTargetGroup group = BuildTargetGroup.Standalone;

        XRGeneralSettingsPerBuildTarget buildTargetSettings;
        EditorBuildSettings.TryGetConfigObject(XRGeneralSettings.k_SettingsKey, out buildTargetSettings);

        if (buildTargetSettings == null)
        {
            buildTargetSettings = ScriptableObject.CreateInstance<XRGeneralSettingsPerBuildTarget>();
            EnsureFolder("Assets/XR");
            AssetDatabase.CreateAsset(buildTargetSettings, "Assets/XR/XRGeneralSettings.asset");
            EditorBuildSettings.AddConfigObject(XRGeneralSettings.k_SettingsKey, buildTargetSettings, true);
        }

        XRGeneralSettings settings = buildTargetSettings.SettingsForBuildTarget(group);
        if (settings == null)
        {
            settings = ScriptableObject.CreateInstance<XRGeneralSettings>();
            settings.name = group + " Settings";
            buildTargetSettings.SetSettingsForBuildTarget(group, settings);
            AssetDatabase.AddObjectToAsset(settings, buildTargetSettings);
        }

        XRManagerSettings manager = settings.AssignedSettings;
        if (manager == null)
        {
            manager = ScriptableObject.CreateInstance<XRManagerSettings>();
            manager.name = group + " Providers";
            AssetDatabase.AddObjectToAsset(manager, settings);
            settings.AssignedSettings = manager;
        }

        bool assigned = XRPackageMetadataStore.AssignLoader(manager, "UnityEngine.XR.OpenXR.OpenXRLoader", group);
        Debug.Log("SceneBuilder: OpenXR loader assigned = " + assigned);

        settings.InitManagerOnStart = true;

        EditorUtility.SetDirty(buildTargetSettings);
        EditorUtility.SetDirty(settings);
        EditorUtility.SetDirty(manager);
        AssetDatabase.SaveAssets();
    }

    private static void TryAddKhronosSimpleControllerProfile()
    {
        try
        {
            UnityEngine.XR.OpenXR.OpenXRSettings settings =
                UnityEngine.XR.OpenXR.OpenXRSettings.GetSettingsForBuildTargetGroup(BuildTargetGroup.Standalone);

            if (settings == null)
            {
                Debug.LogWarning("SceneBuilder: OpenXRSettings not found for Standalone; skipping interaction profile.");
                return;
            }

            UnityEngine.XR.OpenXR.Features.Interactions.KHRSimpleControllerProfile feature =
                settings.GetFeature<UnityEngine.XR.OpenXR.Features.Interactions.KHRSimpleControllerProfile>();

            if (feature != null)
            {
                feature.enabled = true;
                EditorUtility.SetDirty(settings);
                AssetDatabase.SaveAssets();
                Debug.Log("SceneBuilder: Khronos Simple Controller profile enabled.");
            }
            else
            {
                Debug.LogWarning("SceneBuilder: KHRSimpleControllerProfile feature not found; skipping.");
            }
        }
        catch (Exception e)
        {
            Debug.LogWarning("SceneBuilder: skipping OpenXR interaction profile setup: " + e.Message);
        }
    }

    private static void SetActiveInputHandlingBoth()
    {
        UnityEngine.Object playerSettings = Unsupported.GetSerializedAssetInterfaceSingleton("PlayerSettings");
        SerializedObject so = new SerializedObject(playerSettings);
        SerializedProperty prop = so.FindProperty("activeInputHandler");
        prop.intValue = 2; // Both
        so.ApplyModifiedProperties();
        AssetDatabase.SaveAssets();
    }
}
