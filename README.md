# skillio — a screw coach that lives on the workbench

[![Skillio demo video](https://img.youtube.com/vi/2c8QF_UCZBo/maxresdefault.jpg)](https://youtu.be/2c8QF_UCZBo)

**▶ Watch the result: https://youtu.be/2c8QF_UCZBo**

Built at the AI Tinkerers *Agents Everywhere* global hackathon (LA, 2026-09-12)
by Trillium Smith and Klaus Petersen. Challenge: build an agent that belongs
somewhere new instead of a chat window. Ours belongs **in the room, on the
workbench**: it sees the tool and the workpiece, shows the trainee where the
next screw goes, and talks them through it while their hands are busy.

## What we built

Two coaches that work the same job from two senses:

1. **Visual screw coach** (Unity on Apple Vision Pro) — the trainee wears a
   Vision Pro and looks at a real wooden board and a real electric screwdriver.
   Both are optically tracked. The headset overlays a wireframe on the board, an
   arrow along the screwdriver showing where its tip is pointing, and a
   crosshair on the board's surface marking where the next screw goes.
2. **Voice coach** (browser + local server) — the trainee talks; the coach
   listens and answers with **one concise direction**, spoken back. A runbook
   tracks the job step by step and only advances when the trainee explicitly
   confirms. The same direction capability is also reachable as a CopilotKit
   sidecar, an MCP tool and a Slack bot.

In the demo the two run side by side on the same job: the voice coach
announces and confirms each step, and the crosshair on the wood marks the
target for that step (Space moves it to the next random target position). The
trainee never looks at a screen; the guidance is in their ears and on the wood.

## How the visual coach works

```
ART SmartTrack3 (DTrack, 120 Hz)
   ├── headset markers  ─┐
   ├── screwdriver       ├──► FusionHub ──► ALVR ──────────► Vision Pro (video + chroma key)
   └── board             │        │
                         │        └──► steamvrTracker sink ──► SteamVR (two Vive-style trackers)
                         │                                          │
                         └──────────────────────────────────────────┴──► OpenXR ──► Unity scene
```

- **Tracking.** An ART SmartTrack3 tracks passive marker targets on the
  headset, the screwdriver and the board. FusionHub fuses the headset pose with
  the Vision Pro's IMU and streams it, together with rendered frames, to the
  headset over ALVR. The screwdriver and the board are pushed into SteamVR as
  generic trackers by FusionHub's `lpvr_trackers` driver.
- **Trackers into Unity.** Core OpenXR has no notion of a tracker, so the Unity
  project ships a custom OpenXR interaction feature for the
  `XR_HTCX_vive_tracker_interaction` extension. Every SteamVR tracker role
  becomes a Unity input device; the screwdriver is the *Waist* tracker and the
  board the *Chest* tracker. During the hackathon we also fixed the FusionHub
  driver to identify its devices as Vive trackers, which is what SteamVR keys
  its role persistence and OpenXR exposure on.
- **Compositing.** Unity renders the overlays on a pure-green background; the
  client on the Vision Pro keys the green out, so the trainee sees the real
  bench through the headset's passthrough with only the guidance drawn on top.
- **Overlays.** All three are small procedural meshes with Inspector fields so
  they can be fitted to the real objects live: an arrow whose base is the
  screwdriver's tracked origin and whose tip is the bit, a thick-edged wireframe
  box sized to the board, and a crosshair placed on whichever box face currently
  points up. Orientation corrections are captured from a known pose with one
  key (tool upright: `F5`, board flat: `F6`). Brief marker occlusions don't make
  overlays flicker; a tracker has to be lost for half a second before its
  overlay hides.

The Unity project lives in [`sources/static-desk-cube/`](sources/static-desk-cube/)
with its own [README](sources/static-desk-cube/README.md) covering setup,
calibration and every key.

| Key (Unity, in Play) | Action |
|---|---|
| `Space` | Move the crosshair to a new random target on the board's top face |
| `Tab` | Switch keyboard focus between the alignment cube and the crosshair |
| `WASD` `QE` `Z` `X` `1`–`4` `Shift` `R` | Nudge / yaw / step size / reset the focused object |
| `F5` / `F6` | Capture arrow / board orientation from the tool-upright / board-flat pose |
| `C` | Show or hide the room-calibration cube |

## How the voice coach works

```
microphone ──► Vite client ──► local server ──► conversational voice API ──► spoken direction
                                   │  (OpenAI Responses audio-in/audio-out, or a
                                   │   full-duplex realtime relay: OpenAI Realtime / Deepgram Agent)
                                   └──► runbook (confirm-back gate, current screw) ──► /api/scene
```

- **One capability, four surfaces.** *Next concise direction* is served by the
  hold-to-talk voice slice, a CopilotKit sidecar with a generative-UI card, an
  MCP tool typed with `@skillio/mcp-protocol`, and a Slack bot that answers
  @mentions in-thread.
- **Runbook authority.** `@skillio/voice-coach` holds the task spec and phases
  (setup → confirm-back → coaching → escalated → done). Nothing advances without
  an explicit confirm, so the coach can't run ahead of the trainee's hands.
- **Realtime relay.** A server-owned WebSocket session streams audio both ways
  with either OpenAI Realtime or Deepgram's Agent API behind the same local
  protocol; the provider is a single environment switch.
- **Deterministic feedback.** Every direction turn carries a seed derived from
  the job, step and direction text. The same seed drives the two-note audio cue
  and the visual highlight, so audio and visuals agree on every client and run.
- **Credentials stay server-side.** The browser never holds a key; a missing key
  is reported by `/api/health` and as a `503`, never invented.

Code and the full endpoint table are in
[`hackathon/voice-director/`](hackathon/voice-director/README.md).

## Running it

Voice coach (needs an OpenAI key; Deepgram and Slack are optional):

```bash
pnpm install
cd hackathon/voice-director
cp .env.example .env        # set OPENAI_API_KEY
pnpm dev                    # server :8787 + web :5173
```

Visual coach: open `sources/static-desk-cube/` in Unity 6000.0.59f2 with
SteamVR as the active OpenXR runtime, FusionHub streaming to the Vision Pro,
and the two trackers assigned the *Waist* (tool) and *Chest* (board) roles in
SteamVR. Details, calibration and troubleshooting are in that project's README.

## What's wired and what's next

- **Done:** both coaches run end to end on the real bench (see the video).
- **Integration point, not yet consumed:** the voice server publishes the
  runbook and a versioned scene layout at `GET /api/scene/:sessionId`, meant for
  a remote Unity process. Today the crosshair target is advanced by hand
  (`Space`); reading that endpoint from Unity is the next step, so the target
  follows the spoken step automatically.
- **Next:** compare the tracked screwdriver tip against the crosshair to detect
  approach, angle and seating, and feed that back into the runbook so the coach
  can react to what the hands actually do.

## Repository layout

- `sources/static-desk-cube/` — the Unity visual coach (Vision Pro via SteamVR + FusionHub, tracker support, overlays)
- `hackathon/voice-director/` — the voice coach: server, web client, realtime relay, CopilotKit / MCP / Slack surfaces
- `packages/voice-coach/` — task spec, confirm-back gate and coach state machine shared by the voice surfaces
- `packages/mcp-protocol/`, `packages/mcp-client/` — shared MCP tool types and the browser-safe client
- `packages/ui/`, `apps/web/`, `apps/site/` — design system, app shell, and the project page deployed to GitHub Pages
- `integrations/mcp-servers/<service>/` — one runnable per integration
- `hackathon/` — event brief, stack playbook, sponsor notes, starter kit and this team's build space
- `sources/agents-everywhere-starter-kit/` — the event's official starter kit, vendored

## Conventions

- UI renders state; `apps/web → packages/ui` one direction.
- Browser calls MCP over HTTP/SSE via `mcp-client`; types from `mcp-protocol`.
- One tool = one file. New integration = new folder under `mcp-servers/`.
- Hackathon work stays inside `hackathon/<team-folder>/`.

See `CONTRIBUTORS.md` and `hackathon/README.md`.
