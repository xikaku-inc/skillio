using System.Collections.Generic;
using UnityEngine;

/// <summary>
/// Draws the 12 edges of a box as solid bars, sized by <see cref="size"/> and centred at
/// <see cref="center"/> in this transform's local space. Intended as a see-through overlay for a
/// tracked physical object (the wooden board): the DTrack target origin rarely sits at the
/// object's geometric centre, so both the size and the centre offset are Inspector fields, and
/// the mesh rebuilds live in Edit and Play mode while they are tuned.
///
/// Edges are square-section bars of <see cref="edgeThickness"/> (see <see cref="ThickLines"/>)
/// rather than one-pixel lines, so the outline stays readable on the headset stream.
/// </summary>
[ExecuteAlways]
[RequireComponent(typeof(MeshFilter))]
public class WireframeBox : MonoBehaviour
{
    [Tooltip("Box dimensions in meters (local X, Y, Z).")]
    [SerializeField] private Vector3 size = new Vector3(0.6f, 0.04f, 0.1f);

    [Tooltip("Offset of the box centre from this transform's origin, in local meters.")]
    [SerializeField] private Vector3 center = Vector3.zero;

    [Tooltip("Thickness of each edge bar, in meters.")]
    [SerializeField, Min(0.0005f)] private float edgeThickness = 0.01f;

    private Mesh mesh;

    public Vector3 Size { get => size; set { size = value; Rebuild(); } }
    public Vector3 Center { get => center; set { center = value; Rebuild(); } }
    public float EdgeThickness { get => edgeThickness; set { edgeThickness = value; Rebuild(); } }

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
            mesh = new Mesh { name = "WireframeBox", hideFlags = HideFlags.DontSave };

        Vector3 h = size * 0.5f;
        var corner = new Vector3[8];
        for (int i = 0; i < 8; i++)
        {
            corner[i] = center + new Vector3(
                (i & 1) == 0 ? -h.x : h.x,
                (i & 2) == 0 ? -h.y : h.y,
                (i & 4) == 0 ? -h.z : h.z);
        }

        // Pairs of corner indices: 4 edges along X, 4 along Y, 4 along Z.
        int[] edges =
        {
            0, 1, 2, 3, 4, 5, 6, 7,
            0, 2, 1, 3, 4, 6, 5, 7,
            0, 4, 1, 5, 2, 6, 3, 7,
        };

        var verts = new List<Vector3>();
        var tris = new List<int>();
        float half = edgeThickness * 0.5f;
        for (int e = 0; e < edges.Length; e += 2)
            ThickLines.AddSegment(verts, tris, corner[edges[e]], corner[edges[e + 1]], half);

        mesh.Clear();
        mesh.SetVertices(verts);
        mesh.SetTriangles(tris, 0);
        mesh.RecalculateNormals();
        mesh.RecalculateBounds();
        GetComponent<MeshFilter>().sharedMesh = mesh;
    }
}
