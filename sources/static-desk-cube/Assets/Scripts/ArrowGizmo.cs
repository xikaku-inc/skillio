using System.Collections.Generic;
using UnityEngine;

/// <summary>
/// Builds a solid arrow mesh (cylindrical shaft + cone head) pointing along this transform's
/// local +Z axis, with its base at the local origin and its tip at <see cref="length"/> along Z.
///
/// Placed as a child of the screwdriver's tracker, the base marks the tracked origin and the tip
/// should coincide with the real screwdriver tip once the DTrack target is defined accordingly.
/// All dimensions are Inspector fields and the mesh rebuilds whenever they change, in Edit mode
/// too, so the arrow can be tuned live against the tracked tool. The mesh is generated
/// double-sided so it stays visible from any angle regardless of the material.
/// </summary>
[ExecuteAlways]
[RequireComponent(typeof(MeshFilter))]
public class ArrowGizmo : MonoBehaviour
{
    [Tooltip("Total length from base (local origin) to tip, in meters.")]
    [SerializeField, Min(0.001f)] private float length = 0.15f;

    [Tooltip("Radius of the shaft, in meters.")]
    [SerializeField, Min(0.0005f)] private float shaftRadius = 0.004f;

    [Tooltip("Length of the cone head, in meters (taken from the total length).")]
    [SerializeField, Min(0.001f)] private float headLength = 0.03f;

    [Tooltip("Radius of the cone head at its base, in meters.")]
    [SerializeField, Min(0.001f)] private float headRadius = 0.01f;

    [SerializeField, Range(6, 64)] private int segments = 24;

    private Mesh mesh;

    /// <summary>World-space position of the arrow tip.</summary>
    public Vector3 TipWorld => transform.TransformPoint(0f, 0f, length);

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
            mesh = new Mesh { name = "Arrow", hideFlags = HideFlags.DontSave };

        float head = Mathf.Min(headLength, length);
        float shaftLength = length - head;

        var verts = new List<Vector3>();
        var tris = new List<int>();

        // Emit every triangle with its own vertices, in both windings, so the mesh is double-sided
        // and RecalculateNormals yields clean per-face normals.
        void Tri(Vector3 a, Vector3 b, Vector3 c)
        {
            int i = verts.Count;
            verts.Add(a); verts.Add(b); verts.Add(c);
            tris.Add(i); tris.Add(i + 1); tris.Add(i + 2);
            verts.Add(a); verts.Add(c); verts.Add(b);
            tris.Add(i + 3); tris.Add(i + 4); tris.Add(i + 5);
        }

        Vector3 Ring(float radius, float z, int i)
        {
            float a = i * Mathf.PI * 2f / segments;
            return new Vector3(Mathf.Cos(a) * radius, Mathf.Sin(a) * radius, z);
        }

        var baseCenter = Vector3.zero;
        var headBaseCenter = new Vector3(0f, 0f, shaftLength);
        var tip = new Vector3(0f, 0f, length);

        for (int i = 0; i < segments; i++)
        {
            int j = i + 1;
            // Base cap.
            Tri(baseCenter, Ring(shaftRadius, 0f, j), Ring(shaftRadius, 0f, i));
            if (shaftLength > 0f)
            {
                // Shaft wall (two triangles per segment).
                Tri(Ring(shaftRadius, 0f, i), Ring(shaftRadius, 0f, j), Ring(shaftRadius, shaftLength, j));
                Tri(Ring(shaftRadius, 0f, i), Ring(shaftRadius, shaftLength, j), Ring(shaftRadius, shaftLength, i));
            }
            // Annulus between shaft and head base.
            Tri(Ring(shaftRadius, shaftLength, i), Ring(shaftRadius, shaftLength, j), Ring(headRadius, shaftLength, j));
            Tri(Ring(shaftRadius, shaftLength, i), Ring(headRadius, shaftLength, j), Ring(headRadius, shaftLength, i));
            // Cone.
            Tri(Ring(headRadius, shaftLength, i), Ring(headRadius, shaftLength, j), tip);
        }

        mesh.Clear();
        mesh.SetVertices(verts);
        mesh.SetTriangles(tris, 0);
        mesh.RecalculateNormals();
        mesh.RecalculateBounds();
        GetComponent<MeshFilter>().sharedMesh = mesh;
    }
}
