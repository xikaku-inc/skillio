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

## Apple Vision Pro (AVP branch)

**This branch (`AVP`) shows the scene on an Apple Vision Pro** — but not by
building for visionOS. The AVP is driven as a regular SteamVR headset through
**FusionHub** and its ALVR-based streaming node, so on the Unity side this is
nothing more than a normal OpenXR VR app running against the SteamVR runtime.
No visionOS SDK, PolySpatial, URP, or Unity Pro license is involved; the
project stays on the Built-in Render Pipeline, and the XR loader for this
branch is plain OpenXR (make sure SteamVR is the active OpenXR runtime).

The one deliberate difference from `main`: the Main Camera renders a **solid
green background** (`RGB 0,1,0`, opaque) instead of transparent black. The
client running on the headset chroma-keys that green and replaces it with
transparency, so the cube appears over the real world. For that reason this
branch has no `PassthroughBackground` bootstrap (it would overwrite the green
at startup) and no Varjo passthrough component in the scene — the compositing
happens entirely in the headset client, not in an OpenXR passthrough layer.

### Running on the Vision Pro

1. Make **SteamVR** the active OpenXR runtime (SteamVR → Settings → OpenXR →
   "Set SteamVR as OpenXR runtime"). If Varjo Base is installed, make sure it
   is *not* the active runtime.
2. Start **FusionHub** with the ALVR streaming node and connect the client
   app on the Vision Pro, so the AVP shows up as a SteamVR display.
3. Run the scene — press Play in the editor, or launch the built player (see
   [Building a standalone player](#building-a-standalone-player)). The cube
   renders over the solid green background on the headset.
4. The headset client keys out the green and shows the cube over the real
   world. Use the [keyboard controls](#keyboard-controls) on the host to
   align the cube with your physical desk — hold `Shift` for fine steps.

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
- **ScrewdriverTracker** — an empty GameObject under the XR Origin's Camera
  Offset that follows the SteamVR tracker with the `Waist` role via
  `TrackerFollower.cs` (see [Showing a SteamVR tracker](#showing-a-steamvr-tracker)).
  Its child **ScrewdriverArrow** is a blue procedural arrow (`ArrowGizmo.cs`)
  whose base is the tracker origin and whose tip marks the screwdriver tip;
  see [Guidance elements](#guidance-elements) for how it is aligned.
- **BoardTracker** — same as above for the tracker with the `Chest` role
  (the wooden board). Its child **BoardWireframe** is a magenta wireframe box
  (`WireframeBox.cs`) whose size and centre offset are tuned to the real board.
- **Crosshair** — a yellow crosshair (`CrosshairMarker.cs`), child of
  BoardWireframe, marking where the next screw goes. `ScrewTargetPlacer.cs`
  puts it on a random spot of the board's top face at start and on every
  `Space` press. It also carries a `CubeMover`, so the same keyboard scheme as
  the cube nudges it manually; press `Tab` to switch keyboard focus between the
  cube and the crosshair.
- Tracked visuals stay hidden until their tracker is actually tracked, so
  nothing sits misleadingly at the origin when a tracker is missing.
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

## Showing a SteamVR tracker

Anything SteamVR treats as a *tracker* (an HTC Vive Tracker, a Tundra
Tracker, or a virtual device pushed into SteamVR by a driver such as
FusionHub's `steamvrTracker` node) can be shown in the scene next to the
headset. Core OpenXR has no concept of a generic tracker, so this goes through
the `XR_HTCX_vive_tracker_interaction` extension, which SteamVR implements.

`Assets/Scripts/ViveTrackerProfile.cs` is a custom OpenXR *interaction
feature* (enabled under Project Settings > XR Plug-in Management > OpenXR >
Interaction Profiles > "Vive Tracker Profile") that registers that extension's
interaction profile. The extension addresses trackers by the **body role**
assigned to them in SteamVR (`waist`, `chest`, `camera`, `keyboard`,
`left_foot`, ...), so each connected tracker shows up in the Unity Input
System as a `ViveTracker` device whose usage is its role name.

### SteamVR-side setup

1. Have the tracker connected and powered **before** pressing Play. SteamVR
   only enumerates trackers for OpenXR when the session starts; a tracker
   that appears later is not picked up until you stop and restart Play.
2. In SteamVR > Settings > Controllers > **Manage Trackers**, give the
   tracker a body role (any role except "Held in hand" / "Disabled" works —
   `Waist` or `Camera` are convenient). Without a role, SteamVR does **not**
   expose the tracker through the extension at all, and "Held in hand" makes
   it masquerade as a hand controller instead of a tracker.

### Unity side

The scene contains two tracker objects, **ScrewdriverTracker** (role `Waist`)
and **BoardTracker** (role `Chest`), both children of XR Origin > Camera Offset
so they live in the same Floor-level room space as the cube and the headset.
Each carries a `TrackerFollower` component that:

- each frame (and again just before rendering) finds the `ViveTracker`
  device that currently reports valid tracking and copies its position and
  rotation onto the Tracker transform;
- hides its child visual (the screwdriver arrow, the board wireframe) while
  no tracker is tracked. A dropout shorter than *Hold Seconds* (default 0.5 s)
  keeps the visual at its last good pose instead, since SteamVR flags single
  frames as untracked whenever a marker is briefly occluded, and hiding on
  every such frame makes the visual flash. It also
  logs to the Console whenever it starts or stops following a tracker,
  including the role it found. A tracker counts as tracked if it either sets
  the `isTracked` flag (real Vive Trackers) or reports both position and
  rotation as valid (virtual trackers from third-party SteamVR drivers often
  only do the latter). While nothing is followed, it dumps every tracker
  device's role, flags and raw position to the Console every 2 seconds;
- has an optional *Role* field (`Waist`, `Camera`, `LeftFoot`, ...) to follow
  one specific tracker when several are connected. Leave it empty to follow
  whichever single tracker is present.

Why not a plain `TrackedPoseDriver`? SteamVR reports the tracker interaction
profile as active for *every* role path at once, so Unity creates a
`ViveTracker` device for all roles (you'll see a dozen of them in the Input
Debugger) even with a single physical tracker. A `TrackedPoseDriver` bound to
`<ViveTracker>/devicePosition` then has to pick between a dozen devices, all
but one untracked at the origin, and its tie-breaking is not reliable. If you
do want to use a `TrackedPoseDriver` for your own objects, bind it to a
specific role instead, e.g. `<ViveTracker>{Waist}/devicePosition` — the usage
in braces is the role name in PascalCase — and it works fine.

The `TrackerVisual` puck is 7 × 3 × 7 cm, roughly a Vive Tracker's footprint;
its pivot is the tracker's grip pose, which for a physical Vive Tracker is the
base of the tracker where it screws onto the mount.

### Troubleshooting

- Console shows `The active OpenXR runtime does not provide
  XR_HTCX_vive_tracker_interaction`: the active runtime is not SteamVR (see
  [Running on the Vision Pro](#running-on-the-vision-pro)).
- No `[TrackerFollower] Following tracker role=...` line ever appears: the
  tracker has no role in SteamVR, was turned on after Play started, or
  SteamVR itself does not list it under Manage Trackers (in which case it is
  not being exposed as a tracker device class at all). Note that
  `ViveTracker` devices exist for every role regardless; only the one whose
  `isTracked` is set is the real tracker.
- Tracker appears with the wrong role: SteamVR remembers roles per device
  serial number in `Steam/config/steamvr.vrsettings` under `"trackers"`; a
  virtual tracker that changes its serial between runs needs its role
  reassigned.

## Guidance elements

The scene carries the graphical elements for the screwdriving-guidance
application: an arrow on the tracked screwdriver, a wireframe on the tracked
board, and a crosshair for the target screw position. All three are procedural
meshes built by small scripts with Inspector fields, rebuilt live in Edit and
Play mode, so they can be tuned against the real objects without any art tool.
Nothing here is green: the AVP branch chroma-keys pure green out of the frame.

### Screwdriver arrow (`ScrewdriverTracker/ScrewdriverArrow`)

`ArrowGizmo.cs` builds a shaft + cone along the object's local +Z, base at the
local origin. Fields: *Length* (base to tip, default 15 cm), *Shaft Radius*,
*Head Length*, *Head Radius*. Adjust *Length* until the tip sits on the real
screwdriver tip; the DTrack target origin should sit on the tool axis so the
arrow's base is on-axis too.

### Board wireframe (`BoardTracker/BoardWireframe`)

`WireframeBox.cs` draws the 12 edges of a box as solid square-section bars
(one-pixel line meshes are nearly invisible on the headset stream). Fields:
*Size* (local X/Y/Z, default 60 × 4 × 10 cm), *Center* (offset of the box
centre from the tracker origin) and *Edge Thickness* (default 1 cm). Measure
the board and set *Size*, then nudge *Center* until the box hugs the wood.

### Crosshair (`Crosshair`)

`CrosshairMarker.cs` draws two arms on the XZ plane, a ring, and a vertical
tick, all as solid bars (*Thickness*, default 4 mm) so they read on the headset
stream; *Arm Length* (3 cm), *Ring Radius* (1.5 cm) and *Tick Height* (3 cm)
size it. The crosshair is a child of `BoardWireframe`, so it follows the board
and is hidden with it when the board is not tracked.

`ScrewTargetPlacer.cs` places it: when the board first becomes tracked and on
every `Space` press, the crosshair jumps to a random point on the board's top
face, arms in the face plane and tick along the face normal. The face is
chosen at jump time as the wireframe face whose normal points most upward, and
its extent comes from the wireframe's *Size*/*Center*, so once the wireframe
hugs the real board the targets land on the real wood. *Edge Margin* (default
2 cm) keeps targets away from the edges; *Random Seed* other than 0 makes the
sequence repeatable. Each jump logs the target in the board's local frame.

For manual nudging, press `Tab` until the overlay shows `[Crosshair]`, then use
the [keyboard controls](#keyboard-controls) (its default step is 1 cm).

### Aligning the visuals to the tracker frames

A DTrack body frame is whatever it was at body calibration, so the tracker's
axes rarely match the object's natural axes. `TrackedVisualAligner.cs` on both
visuals captures the correction from a known physical pose:

| Key            | Object           | Put the object like this, then press          |
|----------------|------------------|-----------------------------------------------|
| `F5`           | Screwdriver arrow | Tool standing upright, chuck/tip pointing up  |
| `F6`           | Board wireframe   | Board lying flat on the table                 |
| `Shift`+`F5`/`F6` | either        | Clear the captured alignment (back to identity) |

`F5` rotates the arrow so it points straight up at that instant, i.e. along
the tool axis from then on. `F6` rotates the box so its top face is level; a
single flat pose cannot reveal which way the board's long edge runs, so tune
the aligner's *Yaw Degrees* field live until the box follows the wood. Both
captures are saved in `PlayerPrefs` and re-applied on the next run; the
resulting local Euler angles are also logged so they can be typed into the
child's Transform rotation to bake them into the scene file permanently.

Only the tracker needs to be tracked for a capture; the headset can be idle.

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
| `E` / `Page Up`              | Move +Y (up)                              |
| `Space`                      | Jump the crosshair to a new random spot on the board's top face (always, regardless of focus) |
| `Q` / `Page Down` / `Left Ctrl` | Move -Y (down)                         |
| `Z` / `X`                    | Yaw left / right (5° per press)           |
| hold `Shift`                 | Fine adjustment: move and yaw steps ×0.1  |
| `R`                          | Reset to spawn position `(0, 0, 0)` and yaw 0° |
| `1`                          | Set step size to `0.001 m` (1 mm, finest) |
| `2`                          | Set step size to `0.01 m` (1 cm)          |
| `3`                          | Set step size to `0.1 m` (10 cm, default) |
| `4`                          | Set step size to `1 m` (coarse)           |
| `Tab`                        | Move keyboard focus to the next object (Cube → Crosshair → …) |
| `C`                          | Show / hide the cube's visual (hidden by default; the cube can still be moved while hidden) |

Several objects share this scheme (the cube and the crosshair); only the one
with keyboard focus reacts, and the on-screen overlay names it in brackets.
The cube has focus when Play starts.

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
- `com.varjo.xr` (Varjo passthrough, added via git URL)

The AVP branch needs no extra packages — see
[Apple Vision Pro (AVP branch)](#apple-vision-pro-avp-branch).

Active Input Handling is set to **Both**, so the keyboard controls work
whether the new Input System or the legacy Input Manager is active.
