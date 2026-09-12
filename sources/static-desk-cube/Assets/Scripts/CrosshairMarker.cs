using System.Collections.Generic;
using UnityEngine;

/// <summary>
/// Draws a crosshair as solid bars: two arms on the local XZ plane (the surface plane when the
/// transform's +Y is the surface normal), a ring around the centre, and a short tick along +Y so
/// the point is readable from a shallow viewing angle. The centre of the crosshair is this
/// transform's origin; that is the point a screw should go.
///
/// Bars are square-section (see <see cref="ThickLines"/>) rather than one-pixel lines, so the
/// crosshair stays readable on the headset stream.
/// </summary>
[ExecuteAlways]
[RequireComponent(typeof(MeshFilter))]
public class CrosshairMarker : MonoBehaviour
{
    [Tooltip("Half-length of each arm, in meters.")]
    [SerializeField, Min(0.001f)] private float armLength = 0.03f;

    [Tooltip("Radius of the ring around the centre, in meters. 0 disables the ring.")]
    [SerializeField, Min(0f)] private float ringRadius = 0.015f;

    [Tooltip("Height of the tick along +Y, in meters. 0 disables the tick.")]
    [SerializeField, Min(0f)] private float tickHeight = 0.03f;

    [Tooltip("Thickness of the bars, in meters.")]
    [SerializeField, Min(0.0005f)] private float thickness = 0.004f;

    [SerializeField, Range(8, 64)] private int ringSegments = 32;

    private Mesh mesh;

    private void OnEnable() => Rebuild();

    private void OnValidate()
    {
        if (!isActiveAndEnabled)
            return;
#if UNITY_EDITOR
        UnityEditor.EditorApplication.delayCall += () => { if (this != null) Rebuild(); };
#else
        Rebuild();
#endif
    }

    private void OnDestroy()
    {
        if (mesh == null)
            return;
        if (Application.isPlaying) Destroy(mesh); else DestroyImmediate(mesh);
    }

    public void Rebuild()
    {
        if (mesh == null)
            mesh = new Mesh { name = "Crosshair", hideFlags = HideFlags.DontSave };

        var verts = new List<Vector3>();
        var tris = new List<int>();
        float half = thickness * 0.5f;

        ThickLines.AddSegment(verts, tris, new Vector3(-armLength, 0f, 0f), new Vector3(armLength, 0f, 0f), half);
        ThickLines.AddSegment(verts, tris, new Vector3(0f, 0f, -armLength), new Vector3(0f, 0f, armLength), half);
        if (tickHeight > 0f)
            ThickLines.AddSegment(verts, tris, Vector3.zero, new Vector3(0f, tickHeight, 0f), half);
        if (ringRadius > 0f)
        {
            for (int i = 0; i < ringSegments; i++)
            {
                float a0 = i * Mathf.PI * 2f / ringSegments;
                float a1 = (i + 1) * Mathf.PI * 2f / ringSegments;
                ThickLines.AddSegment(verts, tris,
                    new Vector3(Mathf.Cos(a0) * ringRadius, 0f, Mathf.Sin(a0) * ringRadius),
                    new Vector3(Mathf.Cos(a1) * ringRadius, 0f, Mathf.Sin(a1) * ringRadius), half);
            }
        }

        mesh.Clear();
        mesh.SetVertices(verts);
        mesh.SetTriangles(tris, 0);
        mesh.RecalculateNormals();
        mesh.RecalculateBounds();
        GetComponent<MeshFilter>().sharedMesh = mesh;
    }
}
