using System.Collections.Generic;
using UnityEngine;

/// <summary>
/// Helpers for building "thick line" geometry as triangle meshes. Unity's line-topology meshes
/// always render one pixel wide, which is nearly invisible on a headset stream; these emit each
/// segment as a square-section bar instead. Triangles are emitted in both windings so the result
/// is double-sided and looks right from any angle with a single-sided material.
/// </summary>
public static class ThickLines
{
    /// <summary>
    /// Appends a bar of square cross-section (side = 2 * <paramref name="halfThickness"/>) from
    /// <paramref name="a"/> to <paramref name="b"/>. The bar is extended by the half-thickness at
    /// both ends so bars meeting at a corner close the corner without a gap.
    /// </summary>
    public static void AddSegment(List<Vector3> verts, List<int> tris, Vector3 a, Vector3 b, float halfThickness)
    {
        Vector3 d = b - a;
        float len = d.magnitude;
        if (len < 1e-6f)
            return;
        d /= len;

        Vector3 hint = Mathf.Abs(d.y) < 0.9f ? Vector3.up : Vector3.right;
        Vector3 u = Vector3.Cross(d, hint).normalized * halfThickness;
        Vector3 v = Vector3.Cross(d, u).normalized * halfThickness;

        Vector3 a0 = a - d * halfThickness;
        Vector3 b0 = b + d * halfThickness;

        // 8 corners: index bit 0 = ±u, bit 1 = ±v, bit 2 = a/b end.
        var c = new Vector3[8];
        for (int i = 0; i < 8; i++)
        {
            Vector3 end = (i & 4) == 0 ? a0 : b0;
            c[i] = end + ((i & 1) == 0 ? -u : u) + ((i & 2) == 0 ? -v : v);
        }

        Quad(verts, tris, c[0], c[1], c[3], c[2]); // a end cap
        Quad(verts, tris, c[4], c[6], c[7], c[5]); // b end cap
        Quad(verts, tris, c[0], c[4], c[5], c[1]); // -v side
        Quad(verts, tris, c[2], c[3], c[7], c[6]); // +v side
        Quad(verts, tris, c[0], c[2], c[6], c[4]); // -u side
        Quad(verts, tris, c[1], c[5], c[7], c[3]); // +u side
    }

    private static void Quad(List<Vector3> verts, List<int> tris, Vector3 p0, Vector3 p1, Vector3 p2, Vector3 p3)
    {
        Tri(verts, tris, p0, p1, p2);
        Tri(verts, tris, p0, p2, p3);
    }

    private static void Tri(List<Vector3> verts, List<int> tris, Vector3 p0, Vector3 p1, Vector3 p2)
    {
        int i = verts.Count;
        verts.Add(p0); verts.Add(p1); verts.Add(p2);
        tris.Add(i); tris.Add(i + 1); tris.Add(i + 2);
        verts.Add(p0); verts.Add(p2); verts.Add(p1);
        tris.Add(i + 3); tris.Add(i + 4); tris.Add(i + 5);
    }
}
