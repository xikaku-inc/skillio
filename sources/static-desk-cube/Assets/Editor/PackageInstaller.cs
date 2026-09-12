using UnityEditor;
using UnityEditor.PackageManager;
using UnityEditor.PackageManager.Requests;
using UnityEngine;

/// <summary>
/// Batchmode-only helper that adds all packages required by the project in a single
/// AddAndRemove request (one domain reload instead of one per package). Uses only
/// UnityEditor.PackageManager, which is always available, so this compiles even
/// before the XR packages themselves are present in the project.
/// </summary>
public static class PackageInstaller
{
    private static AddAndRemoveRequest request;

    public static void Install()
    {
        string[] packagesToAdd =
        {
            "com.unity.inputsystem",
            "com.unity.xr.management",
            "com.unity.xr.openxr",
            "com.unity.xr.core-utils"
        };

        Debug.Log("PackageInstaller: requesting AddAndRemove for: " + string.Join(", ", packagesToAdd));
        request = Client.AddAndRemove(packagesToAdd, null);
        EditorApplication.update += Progress;
    }

    private static void Progress()
    {
        if (request == null || !request.IsCompleted)
        {
            return;
        }

        EditorApplication.update -= Progress;

        if (request.Status == StatusCode.Success)
        {
            Debug.Log("PackageInstaller: SUCCESS - resolved packages:");
            foreach (UnityEditor.PackageManager.PackageInfo info in request.Result)
            {
                Debug.Log("  " + info.name + "@" + info.version);
            }
            EditorApplication.Exit(0);
        }
        else
        {
            string message = request.Error != null ? request.Error.message : "unknown error";
            Debug.LogError("PackageInstaller: FAILED - " + message);
            EditorApplication.Exit(1);
        }
    }
}
