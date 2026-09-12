# Static Desk Cube

A minimal Unity scene for aligning virtual content to a physical desk using
mixed-reality passthrough: a single 10 cm cube (about the size of a computer
mouse) spawns at the world origin and is meant to be viewed *over your real
desk*, seen through a Varjo headset's video passthrough (or any other OpenXR
headset/runtime with passthrough or mixed-reality support). You nudge the
cube using the keyboard controls until it lines up with your real keyboard
on the desk, as a way to check how well the virtual and real worlds line up.
There is deliberately no virtual desk, floor, or other furniture in the
scene — that's intentional: the real world, seen through passthrough,
provides all of that. The project also runs flat on the desktop with no
headset at all, using a Scene-view-style fly-camera to look around.

## What's in the scene

- **MovableCube** — an empty root GameObject holding the `CubeMover`
  component; its pivot spawns at exactly world `(0, 0, 0)`. Its child,
  **CubeVisual**, is a bright-orange default cube at local position
  `(0, 0.05, 0)` with scale `0.1` — i.e. a 0.1 m (10 cm) cube offset so its
  pivot sits at the center of its *bottom* face rather than at its center.
  That makes the pivot the point that should touch the desk surface: put the
  pivot at desk height and the cube rests on the desk. The whole thing can be
  repositioned at runtime with the keyboard (see below).
- **XR Origin** — an `XROrigin` rig (from `com.unity.xr.core-utils`)
  positioned at world `(0, 0, 0)`, using **Floor** tracking-origin mode.
  The world origin therefore coincides with the XR runtime's calibrated
  room origin (Varjo Base floor calibration / SteamVR room setup) at floor
  level — a fixed spot in your physical room that stays put across
  sessions, instead of depending on where the headset happens to be when
  the app starts.
- **Directional Light** — a single soft-shadowed sun light.

### Real-world scale reference

Unity units are meters. The cube is `0.1` m on a side — about the size of a
computer mouse (typical mice are 10–13 cm long). Because the tracking origin
is the calibrated floor, the cube starts sitting *on the floor* at the room
origin; a standard desk surface sits at roughly `0.74` m above the floor
(DIN 74 cm ± 2), so expect to raise the cube by about that much (`E` at the
default 10 cm step, then fine-tune) to bring it up to desk height.

There is no virtual desk or floor in the scene. With passthrough active you
see your real desk (and the rest of the room) directly; the cube above is
the only virtual geometry present. At runtime, `PassthroughBackground.cs`
sets the Main Camera's background to transparent black so an OpenXR
passthrough compositor can show the real world behind the cube (see
[Requirements](#requirements) for the headset-side setup this depends on).

## Requirements

- Unity **6000.4.7f1**
- Windows 10/11
- An OpenXR runtime installed and set as the active OpenXR runtime if you
  want to run on a headset:
  - **Varjo**: install Varjo Base and set it as the active OpenXR runtime
    (Varjo Base > OpenXR > "Set active"), then enable video passthrough /
    mixed reality in Varjo Base so the headset shows your real surroundings
    instead of a black void. If the real world still doesn't show through
    once the scene is running, you may additionally need to enable the
    Varjo OpenXR plugin's alpha-blend (mixed reality) feature (XR Plug-in
    Management > OpenXR settings) — the app side is already prepared for
    this, since the Main Camera's background is set to transparent black at
    runtime (see `Assets/Scripts/PassthroughBackground.cs`).
  - Any other OpenXR headset/runtime should also work — this project only
    depends on the standard OpenXR HMD pose bindings, not on any
    vendor-specific features.
- No HMD is required at all to try the scene — see below.

Render pipeline is the **Built-in Render Pipeline** (this project intentionally
does not use URP/HDRP).

## How to run

1. Open the project in Unity Hub / Unity Editor `6000.4.7f1`.
2. Open the scene `Assets/Scenes/DeskCube.unity` (it is also the only scene
   registered in Build Settings).
3. Press **Play**.
   - If an OpenXR headset + runtime is active, the scene starts in XR and
     you see the orange cube floating at the world origin, composited over
     your real surroundings via passthrough. Use the keyboard controls
     below to nudge the cube into place until it lines up with your real
     desk and keyboard (default 10 cm steps are already sensible; press `1`
     or `2` for mm/cm precision when fine-aligning).
   - With no headset connected, the scene still runs on the desktop using the
     Main Camera — you just won't get head tracking, but all keyboard
     controls work identically. See
     [Desktop simulation view (no headset)](#desktop-simulation-view-no-headset)
     below for free-look navigation controls to move around the scene.

## Desktop simulation view (no headset)

When Play starts and no XR headset/OpenXR device successfully initializes, a
`DesktopFlyCamera` component automatically attaches itself to the Main
Camera at runtime — nothing in the scene file changes to enable this, and if
a headset *is* running, the component never attaches at all. Plain `WASD`
still steps the cube exactly as described below; the fly-camera controls are
purely for moving your viewpoint around the cube to inspect it, and are only
active while the right mouse button is held down (the same gesture as the
Unity editor's Scene view camera).

| Input                          | Action                                              |
|----------------------------------|------------------------------------------------------|
| Hold **Right Mouse Button**      | Enable look + fly (cursor is hidden/locked while held) |
| Move mouse (while held)          | Look around (yaw/pitch, Scene-view style)             |
| `W` / `S` (while held)           | Fly forward / backward                                |
| `A` / `D` (while held)           | Strafe left / right                                   |
| `E` / `Q` (while held)           | Fly up / down (world space)                           |
| `Left Shift` (while held)        | 4x fast movement                                      |
| Scroll wheel (while held)        | Adjust fly speed (multiplicative, clamped 0.2-20 m/s) |
| Release Right Mouse Button       | Stop looking/flying; cursor is restored               |

This is purely a desktop convenience for exploring the scene without a
headset — it has no effect on the XR experience and does not touch the
XR Origin rig.

## Keyboard controls

The cube moves in discrete steps — one step per key press (no held-key
repeat). Default step size is **0.1 m** (10 cm, one cube-length per press) —
a sensible middle ground for desk-scale alignment; switch to a finer step
size (`1` or `2`), or simply hold `Shift`, for precise alignment work.

| Key(s)                     | Action                                   |
|-----------------------------|-------------------------------------------|
| `W` / `Up Arrow`             | Move +Z (forward)                         |
| `S` / `Down Arrow`           | Move -Z (backward)                        |
| `A` / `Left Arrow`           | Move -X (left)                            |
| `D` / `Right Arrow`          | Move +X (right)                           |
| `E` / `Page Up` / `Space`    | Move +Y (up)                              |
| `Q` / `Page Down` / `Left Ctrl` | Move -Y (down)                         |
| `Z` / `X`                    | Yaw left / right (5° per press)           |
| hold `Shift`                 | Fine adjustment: move and yaw steps ×0.1  |
| `R`                          | Reset to spawn position `(0, 0, 0)` and yaw 0° |
| `1`                          | Set step size to `0.001 m` (1 mm, finest) |
| `2`                          | Set step size to `0.01 m` (1 cm)          |
| `3`                          | Set step size to `0.1 m` (10 cm, default) |
| `4`                          | Set step size to `1 m` (coarse)           |

Holding `Shift` scales both the move step and the yaw step to a tenth
(e.g. Shift+`W` at the default 10 cm step moves 1 cm; Shift+`Z` yaws 0.5°),
so rough and fine adjustments are always one modifier apart without
switching step sizes.

The current position, yaw, step size, and control hints are shown as an
on-screen overlay in the top-left corner while in Play mode, and every move is
also logged to the Console.

Note: the cube's pivot (the `MovableCube` GameObject) spawns at exactly
world `(0, 0, 0)`. The visual cube (`CubeVisual`) is offset so the pivot
sits at the center of its *bottom* face (local `y = 0.05`, scale `0.1`)
rather than at its center — so the cube rests on whatever plane the pivot
sits on. Pressing `R` at any time snaps the pivot back to that spawn
position.

## Building a standalone player

`Assets/Editor/BuildScript.cs` builds the Windows player from the command
line, without opening the editor UI:

```powershell
& "C:\Program Files\Unity\Hub\Editor\<version>\Editor\Unity.exe" `
    -batchmode -projectPath . -executeMethod BuildScript.Build `
    -logFile build.log
```

The build lands in `Builds/StaticDeskCube/StaticDeskCube.exe` (the `Builds/`
folder is gitignored). The script exits Unity with code 0 on success and 1 on
failure, so it is usable from CI or scripts; errors are written to the log
file given via `-logFile`. Close the Unity editor before running it — two
Unity instances cannot open the same project at once.

(`Assets/Editor/SceneBuilder.cs` is a historical batch-mode generator that
originally created `DeskCube.unity`. The scene has since been edited by hand,
so running it would overwrite the current scene with an outdated desk+floor
variant — don't run it unless you want to regenerate from scratch.)

## Packages

- `com.unity.inputsystem`
- `com.unity.xr.management`
- `com.unity.xr.openxr`
- `com.unity.xr.core-utils`

Active Input Handling is set to **Both**, so the keyboard controls work
whether the new Input System or the legacy Input Manager is active.
