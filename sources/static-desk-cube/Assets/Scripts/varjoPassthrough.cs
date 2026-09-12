using UnityEngine;
using Varjo.XR;

namespace FusionHub
{
    public class varjoPassthrough : MonoBehaviour
    {
        void OnEnable()
        {
            VarjoMixedReality.StartRender();
        }

        void OnDisable()
        {
            VarjoMixedReality.StopRender();
        }
    }

}

