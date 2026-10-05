# YouTube Side Player (`youtube-side-player`) — Claude Code Mod

A [Claude Code Mod](https://code.claude.com/docs/en/plugins/mods/overview) plugin that lets you watch YouTube videos on the side in **any screen or terminal position** while coding with Claude Code.

It combines:
1. **In-Claude Code UI Controls (`Pane`, `AbovePrompt`, `Spinner`)**:
   - **Side Dock (`Pane`)**: Interactive 4-tab control panel (`Player`, `Position`, `Playlist`, `Notes & AI`) with a live terminal `Raster` / desktop `Svg` screen-position radar, configurable sidebar width (`44`, `58`, or `74` columns), timestamped notes, and 1-click AI video topic summaries via `$.model.complete`.
   - **Mini-Player Bar (`AbovePrompt`)**: Compact status and control strip directly above your Claude Code prompt with `Play/Pause`, `Move ↻` (cycles screen corners/sides), and `Pane` buttons.
   - **Spinner Status (`Spinner`)**: Shows the currently playing video title and position in Claude's thinking spinner.
2. **Native Floating Side-by-Side macOS Player (`bin/yt-pip`)**:
   - Borderless, non-activating, always-on-top Picture-in-Picture window (`NSPanel` + `WKWebView`) that stays visible across spaces without stealing keyboard focus from your terminal.
   - Snap to **any of 9 screen positions** (`top-left`, `top-center`, `top-right`, `left-side`, `center`, `right-side`, `bottom-left`, `bottom-center`, `bottom-right`), **full-height left/right side split**, **custom `x,y,w,h` coordinates**, or **drag freely** with your mouse.

---

## Quick Start

Install from GitHub inside Claude Code (`2.1.287+`, where mods are on by default):

```
/plugin marketplace add hemanth/claude-code-youtube-mod
/plugin install youtube-side-player@claude-code-youtube-mod
```

Or run it from a clone:

```bash
git clone https://github.com/hemanth/claude-code-youtube-mod
claude --plugin-dir ./claude-code-youtube-mod
```

Then `/yt lofi hip hop`. macOS only (the popout window is a native Cocoa app; inline audio uses AudioToolbox).

### Dependencies are handled for you

Inline video needs `yt-dlp` and `ffmpeg`. If they are already on your `PATH` they are used as is. If not, the first `/yt` play in Ghostty or kitty (or `/yt setup`, or the pane's **Install** button) runs `bin/install-deps.sh`, which:

- downloads the standalone `yt-dlp_macos` binary and a static `ffmpeg` 9.0.2 build (~100 MB total) into `~/.claude/plugins/data/youtube-side-player/bin/`
- checks each against a SHA-256 (yt-dlp's published `SHA2-256SUMS`; ffmpeg's pinned in the script) and refuses on mismatch
- never touches Homebrew or anything system-wide; delete that folder to remove them

That copy of yt-dlp is updated weekly (`yt-dlp -U`), since YouTube changes break old releases. The popout window needs nothing extra.

---

## Slash Commands

| Command | Description | Examples |
| :--- | :--- | :--- |
| `/yt` | Open the player pane | `/yt` |
| `/yt [play] <url \| id \| search> [@position] [size]` | Play a video (inline in the pane on Ghostty/kitty, else the popout window) | `/yt zjkBMFhNj_g`<br>`/yt play lofi hip hop @bottom-left small` |
| `/yt pause` / `/yt resume` | Pause (toggles when already paused) or resume | `/yt pause` |
| `/yt stop` | Stop playback and close the pane and the mini-player bar | `/yt stop` |
| `/yt hide` / `/yt show` | Hide or show the UI; playback keeps going | `/yt hide` |
| `/yt pos <position> [size]` | Move the popout window to a screen position or `x,y,w,h`, or set Claude UI placement (`pane`, `band`, `both`, `spinner`) | `/yt pos left-side sidebar`<br>`/yt pos 980,60,480,270`<br>`/yt pos band` |
| `/yt mode auto\|inline\|window` | Choose inline vs popout playback; `auto` detects the terminal | `/yt mode window` |
| `/yt status` | Current video and why it plays inline or in a window | `/yt status` |

### Inline vs popout playback

At session start the mod checks where it is running. Inline (video drawn in the side pane) needs a terminal that draws images, Ghostty or kitty (`TERM_PROGRAM`, `TERM`, `KITTY_WINDOW_ID`, `GHOSTTY_RESOURCES_DIR`), not inside tmux, plus `yt-dlp` and `ffmpeg` on `PATH` (`brew install yt-dlp ffmpeg`). Anywhere else, including the desktop app, it uses the native popout window. Inline mode runs one `ffmpeg` that reads `yt-dlp`'s video and audio downloads at the same pace, writes 480×270 frames at 24 fps for the pane's `Image`, and plays the sound through macOS AudioToolbox, so picture and sound stay in sync.

---

## Positioning Anywhere You Like

### 1. 9-Point Screen Compass & Side Splits
Inside the `/yt` pane (`2: Position` tab) or via `/yt pos <position>`:

| Compass Grid | Left | Center | Right |
| :--- | :--- | :--- | :--- |
| **Top** | `top-left` (`tl`, hotkey `q`) | `top-center` (`tc`, hotkey `w`) | `top-right` (`tr`, hotkey `e`) |
| **Middle / Side Split** | `left-side` (`left`, hotkey `a`) | `center` (`c`, hotkey `s`) | `right-side` (`right`, hotkey `d`) |
| **Bottom** | `bottom-left` (`bl`, hotkey `z`) | `bottom-center` (`bc`, hotkey `x`) | `bottom-right` (`br`, hotkey `c`) |

### 2. Custom Coordinates & Free Mouse Dragging
- **Custom Coordinates**: Run `/yt pos 980,60,480,270` (or enter `x,y,w,h` in Tab 2).
- **Mouse Drag**: Drag the floating player's hover bar anywhere on your display; its new coordinates are saved to `/tmp/claude-yt-mod-state.json` and synced back into the Claude Code mod.

### 3. In-Claude UI Placement
Choose where the controls live inside Claude Code (`/yt pos <placement>` or Tab 2):
- `both` — Side Pane + Above-Prompt Mini-Player Bar
- `pane` — Side Pane only (`44`, `58`, or `74` columns wide)
- `band` — Above-Prompt Mini-Player Bar only
- `spinner` — Minimal status in Claude's thinking spinner only

---

## Natural Language Control (Claude Tool)

The mod registers `mcp__youtube-side-player__youtube_player`, so you can also ask Claude directly:
- *"Play Andrej Karpathy's Intro to LLMs on the bottom-left of my screen"*
- *"Move the YouTube player to a full-height right-side split"*
- *"Pause the YouTube video"*

---

## Development & Testing

```bash
# Validate plugin manifest and static analysis rules
claude plugin validate --strict .

# Run automated test suite
claude plugin test

# Recompile the native macOS floating player binary
swiftc -O native/YTPiPPlayer.swift -o bin/yt-pip -framework Cocoa -framework WebKit
```
