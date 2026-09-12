using System;
using System.IO;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEngine;

/// <summary>
/// Batchmode-only helper that builds the Windows standalone player for this project.
/// Intended to be invoked via -executeMethod BuildScript.Build from the command line.
/// </summary>
public static class BuildScript
{
    private const string SceneToBuild = "Assets/Scenes/DeskCube.unity";
    private const string OutputPath = "Builds/StaticDeskCube/StaticDeskCube.exe"; // relative to the project root

    public static void Build()
    {
        try
        {
            PlayerSettings.productName = "Static Desk Cube";
            PlayerSettings.companyName = "Xikaku Inc";

            string outputDir = Path.GetDirectoryName(OutputPath);
            if (!string.IsNullOrEmpty(outputDir) && !Directory.Exists(outputDir))
            {
                Directory.CreateDirectory(outputDir);
            }

            BuildPlayerOptions buildPlayerOptions = new BuildPlayerOptions
            {
                scenes = new[] { SceneToBuild },
                locationPathName = OutputPath,
                target = BuildTarget.StandaloneWindows64,
                options = BuildOptions.None
            };

            BuildReport report = BuildPipeline.BuildPlayer(buildPlayerOptions);
            BuildSummary summary = report.summary;

            if (summary.result == BuildResult.Succeeded)
            {
                Debug.Log("BUILD SUCCESS - size: " + summary.totalSize + " bytes, output: " + summary.outputPath);
                EditorApplication.Exit(0);
            }
            else
            {
                Debug.LogError("BuildScript: FAILED - result=" + summary.result +
                    ", totalErrors=" + summary.totalErrors +
                    ", totalWarnings=" + summary.totalWarnings);

                foreach (BuildStep step in report.steps)
                {
                    foreach (BuildStepMessage message in step.messages)
                    {
                        if (message.type == LogType.Error || message.type == LogType.Exception)
                        {
                            Debug.LogError("BuildScript: [" + step.name + "] " + message.content);
                        }
                    }
                }

                EditorApplication.Exit(1);
            }
        }
        catch (Exception ex)
        {
            Debug.LogError("BuildScript: EXCEPTION - " + ex);
            EditorApplication.Exit(1);
        }
    }
}
