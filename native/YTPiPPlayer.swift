import AppKit
import Foundation
import WebKit

// MARK: - Shared State Model

struct PlayerState: Codable, Equatable {
    var videoId: String
    var title: String
    var position: String        // top-right, top-left, bottom-right, bottom-left, right-side, left-side, top-center, bottom-center, center, custom
    var sizePreset: String      // small, medium, large, sidebar
    var customX: Double?
    var customY: Double?
    var customWidth: Double?
    var customHeight: Double?
    var opacity: Double
    var isPinned: Bool
    var isPaused: Bool
    var isMuted: Bool
    var playbackRate: Double
    var seekToSeconds: Double?
    var commandSeq: Int
    var shouldQuit: Bool
    var updatedAt: Double

    static let stateFilePath = "/tmp/claude-yt-mod-state.json"

    static func defaultState() -> PlayerState {
        PlayerState(
            videoId: "jfKfPfyJRdk",
            title: "lofi hip hop radio - beats to relax/study to",
            position: "top-right",
            sizePreset: "medium",
            customX: nil,
            customY: nil,
            customWidth: nil,
            customHeight: nil,
            opacity: 0.96,
            isPinned: true,
            isPaused: false,
            isMuted: false,
            playbackRate: 1.0,
            seekToSeconds: nil,
            commandSeq: 1,
            shouldQuit: false,
            updatedAt: Date().timeIntervalSince1970
        )
    }

    static func load() -> PlayerState {
        let url = URL(fileURLWithPath: stateFilePath)
        guard let data = try? Data(contentsOf: url),
              let decoded = try? JSONDecoder().decode(PlayerState.self, from: data) else {
            return defaultState()
        }
        return decoded
    }

    func save() {
        let url = URL(fileURLWithPath: Self.stateFilePath)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        if let data = try? encoder.encode(self) {
            try? data.write(to: url, options: .atomic)
        }
    }
}

// MARK: - URL / ID Parser

enum YouTubeParser {
    static func extractVideoId(from raw: String) -> String {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.count == 11,
           trimmed.range(of: #"^[A-Za-z0-9_-]{11}$"#, options: .regularExpression) != nil {
            return trimmed
        }
        if let url = URL(string: trimmed) {
            if let host = url.host?.lowercased() {
                if host.contains("youtu.be") {
                    let pathId = url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
                    if !pathId.isEmpty { return String(pathId.prefix(11)) }
                }
                if let comps = URLComponents(url: url, resolvingAgainstBaseURL: false),
                   let v = comps.queryItems?.first(where: { $0.name == "v" })?.value,
                   !v.isEmpty {
                    return String(v.prefix(11))
                }
                let parts = url.pathComponents
                if let embedIdx = parts.firstIndex(where: { $0 == "embed" || $0 == "shorts" || $0 == "live" }),
                   embedIdx + 1 < parts.count {
                    return String(parts[embedIdx + 1].prefix(11))
                }
            }
        }
        return trimmed
    }

    static func normalizePosition(_ raw: String) -> String {
        switch raw.lowercased().trimmingCharacters(in: .whitespacesAndNewlines) {
        case "tr", "top-right", "topright", "ne": return "top-right"
        case "tl", "top-left", "topleft", "nw": return "top-left"
        case "br", "bottom-right", "bottomright", "se": return "bottom-right"
        case "bl", "bottom-left", "bottomleft", "sw": return "bottom-left"
        case "right", "right-side", "r", "east", "dock-right": return "right-side"
        case "left", "left-side", "l", "west", "dock-left": return "left-side"
        case "tc", "top-center", "top", "north": return "top-center"
        case "bc", "bottom-center", "bottom", "south": return "bottom-center"
        case "c", "center", "middle": return "center"
        case "custom": return "custom"
        default: return raw.lowercased()
        }
    }
}

// MARK: - Floating Non-Activating Panel

final class FloatingYouTubePanel: NSPanel {
    var onUserMovedWindow: ((NSPoint, NSSize) -> Void)?
    var isProgrammaticMove = false

    init(contentRect: NSRect) {
        super.init(
            contentRect: contentRect,
            styleMask: [.borderless, .nonactivatingPanel, .resizable],
            backing: .buffered,
            defer: false
        )
        self.isFloatingPanel = true
        self.level = .floating
        self.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        self.isOpaque = false
        self.backgroundColor = .clear
        self.hasShadow = true
        self.hidesOnDeactivate = false
        self.isMovableByWindowBackground = true
        self.minSize = NSSize(width: 260, height: 170)
    }

    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

// MARK: - Daemon Application Delegate

@MainActor
final class YTPiPAppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate {
    private var panel: FloatingYouTubePanel!
    private var webView: WKWebView!
    private var titleLabel: NSTextField!
    private var posBadgeLabel: NSTextField!
    private var playPauseBtn: NSButton!
    private var currentState: PlayerState = PlayerState.load()
    private var loadedVideoId: String = ""
    private var lastAppliedSeq: Int = -1
    private var pollTimer: Timer?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        setupWindow()
        applyState(currentState, forceReloadVideo: true)

        pollTimer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.checkStateFile()
            }
        }
    }

    private func setupWindow() {
        let rect = computeWindowRect(for: currentState)
        panel = FloatingYouTubePanel(contentRect: rect)
        panel.delegate = self

        let container = NSView(frame: NSRect(origin: .zero, size: rect.size))
        container.wantsLayer = true
        container.layer?.backgroundColor = NSColor(calibratedWhite: 0.08, alpha: 0.96).cgColor
        container.layer?.cornerRadius = 12
        container.layer?.masksToBounds = true
        container.layer?.borderWidth = 1
        container.layer?.borderColor = NSColor.white.withAlphaComponent(0.18).cgColor
        container.autoresizingMask = [.width, .height]

        // Top HUD Header Bar (28pt height)
        let headerHeight: CGFloat = 30
        let header = NSView(frame: NSRect(x: 0, y: rect.height - headerHeight, width: rect.width, height: headerHeight))
        header.wantsLayer = true
        header.layer?.backgroundColor = NSColor(calibratedWhite: 0.11, alpha: 0.98).cgColor
        header.autoresizingMask = [.width, .minYMargin]

        titleLabel = NSTextField(labelWithString: "▶ YouTube Side Player")
        titleLabel.font = NSFont.systemFont(ofSize: 11, weight: .semibold)
        titleLabel.textColor = .white
        titleLabel.lineBreakMode = .byTruncatingTail
        titleLabel.frame = NSRect(x: 10, y: 6, width: max(80, rect.width - 235), height: 16)
        titleLabel.autoresizingMask = [.width]
        header.addSubview(titleLabel)

        // Quick Position & Control Buttons on Right of Header
        let controlsStack = NSStackView()
        controlsStack.orientation = .horizontal
        controlsStack.spacing = 4
        controlsStack.frame = NSRect(x: rect.width - 220, y: 4, width: 212, height: 22)
        controlsStack.autoresizingMask = [.minXMargin]

        let tlBtn = makeHeaderButton("↖", tooltip: "Snap Top-Left", action: #selector(snapTopLeft))
        let trBtn = makeHeaderButton("↗", tooltip: "Snap Top-Right", action: #selector(snapTopRight))
        let blBtn = makeHeaderButton("↙", tooltip: "Snap Bottom-Left", action: #selector(snapBottomLeft))
        let brBtn = makeHeaderButton("↘", tooltip: "Snap Bottom-Right", action: #selector(snapBottomRight))
        let sideBtn = makeHeaderButton("⇥", tooltip: "Dock Right Side", action: #selector(snapRightSide))
        playPauseBtn = makeHeaderButton("⏸", tooltip: "Play / Pause", action: #selector(togglePlayPause))
        let closeBtn = makeHeaderButton("✕", tooltip: "Close Player", action: #selector(closePlayer))

        for b in [tlBtn, trBtn, blBtn, brBtn, sideBtn, playPauseBtn!, closeBtn] {
            controlsStack.addArrangedSubview(b)
        }
        header.addSubview(controlsStack)

        // WebView for YouTube Video
        let config = WKWebViewConfiguration()
        config.mediaTypesRequiringUserActionForPlayback = []
        let contentController = WKUserContentController()

        // Theater-mode CSS & JS injection so the video fills the floating window cleanly without clutter
        let cleanYouTubeJS = """
        (function() {
          const style = document.createElement('style');
          style.textContent = `
            html, body {
              margin: 0 !important;
              padding: 0 !important;
              background: #000 !important;
              overflow: hidden !important;
            }
            #masthead-container, ytd-masthead, #secondary, #comments, #below,
            #related, #info, #meta, # merchandising, tp-yt-app-drawer,
            .ytp-ce-element, .ytp-cards-teaser, .ytp-pause-overlay {
              display: none !important;
            }
            ytd-app, #page-manager, ytd-watch-flexy, #player-theater-container,
            #player-container-outer, #player-container-inner, #player-container,
            #ytd-player, #container.ytd-player, .html5-video-player {
              position: fixed !important;
              top: 0 !important;
              left: 0 !important;
              width: 100vw !important;
              height: 100vh !important;
              max-width: 100vw !important;
              max-height: 100vh !important;
              margin: 0 !important;
              padding: 0 !important;
              z-index: 2147483647 !important;
              background: #000 !important;
            }
            video.html5-main-video {
              width: 100vw !important;
              height: 100vh !important;
              left: 0 !important;
              top: 0 !important;
              object-fit: contain !important;
            }
          `;
          document.documentElement.appendChild(style);
        })();
        """
        let userScript = WKUserScript(source: cleanYouTubeJS, injectionTime: .atDocumentEnd, forMainFrameOnly: true)
        contentController.addUserScript(userScript)
        config.userContentController = contentController

        webView = WKWebView(frame: NSRect(x: 0, y: 0, width: rect.width, height: rect.height - headerHeight), configuration: config)
        webView.customUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        webView.setValue(false, forKey: "drawsBackground")

        container.addSubview(webView)
        container.addSubview(header)

        panel.contentView = container
        panel.orderFrontRegardless()
    }

    private func makeHeaderButton(_ title: String, tooltip: String, action: Selector) -> NSButton {
        let btn = NSButton(title: title, target: self, action: action)
        btn.bezelStyle = .recessed
        btn.isBordered = false
        btn.font = NSFont.systemFont(ofSize: 11, weight: .bold)
        btn.contentTintColor = .white
        btn.toolTip = tooltip
        btn.frame = NSRect(x: 0, y: 0, width: 24, height: 20)
        return btn
    }

    @objc private func snapTopLeft() { updatePosition("top-left") }
    @objc private func snapTopRight() { updatePosition("top-right") }
    @objc private func snapBottomLeft() { updatePosition("bottom-left") }
    @objc private func snapBottomRight() { updatePosition("bottom-right") }
    @objc private func snapRightSide() {
        var st = PlayerState.load()
        st.position = "right-side"
        st.sizePreset = "sidebar"
        st.commandSeq += 1
        st.updatedAt = Date().timeIntervalSince1970
        st.save()
        applyState(st, forceReloadVideo: false)
    }

    @objc private func togglePlayPause() {
        var st = PlayerState.load()
        st.isPaused.toggle()
        st.commandSeq += 1
        st.updatedAt = Date().timeIntervalSince1970
        st.save()
        applyState(st, forceReloadVideo: false)
    }

    @objc private func closePlayer() {
        var st = PlayerState.load()
        st.shouldQuit = true
        st.updatedAt = Date().timeIntervalSince1970
        st.save()
        NSApp.terminate(nil)
    }

    private func updatePosition(_ pos: String) {
        var st = PlayerState.load()
        st.position = pos
        if st.sizePreset == "sidebar" && pos != "right-side" && pos != "left-side" {
            st.sizePreset = "medium"
        }
        st.commandSeq += 1
        st.updatedAt = Date().timeIntervalSince1970
        st.save()
        applyState(st, forceReloadVideo: false)
    }

    func windowDidMove(_ notification: Notification) {
        guard !panel.isProgrammaticMove else { return }
        let frame = panel.frame
        var st = PlayerState.load()
        st.position = "custom"
        st.customX = Double(frame.origin.x)
        st.customY = Double(frame.origin.y)
        st.customWidth = Double(frame.size.width)
        st.customHeight = Double(frame.size.height)
        st.updatedAt = Date().timeIntervalSince1970
        st.save()
        currentState = st
        titleLabel.stringValue = "▶ [custom \(Int(frame.origin.x)),\(Int(frame.origin.y))] \(st.title)"
    }

    func windowDidEndLiveResize(_ notification: Notification) {
        let frame = panel.frame
        var st = PlayerState.load()
        st.customWidth = Double(frame.size.width)
        st.customHeight = Double(frame.size.height)
        st.updatedAt = Date().timeIntervalSince1970
        st.save()
        currentState = st
    }

    private func checkStateFile() {
        let latest = PlayerState.load()
        if latest.shouldQuit {
            NSApp.terminate(nil)
            return
        }
        if latest != currentState || latest.commandSeq != lastAppliedSeq {
            let videoChanged = latest.videoId != loadedVideoId
            applyState(latest, forceReloadVideo: videoChanged)
        }
    }

    private func applyState(_ state: PlayerState, forceReloadVideo: Bool) {
        currentState = state
        lastAppliedSeq = state.commandSeq

        titleLabel.stringValue = "▶ [\(state.position)] \(state.title)"
        playPauseBtn.title = state.isPaused ? "▶" : "⏸"
        panel.alphaValue = CGFloat(max(0.25, min(1.0, state.opacity)))
        panel.level = state.isPinned ? .floating : .normal

        let targetRect = computeWindowRect(for: state)
        if panel.frame != targetRect {
            panel.isProgrammaticMove = true
            panel.setFrame(targetRect, display: true, animate: true)
            panel.isProgrammaticMove = false
        }

        if forceReloadVideo && !state.videoId.isEmpty {
            loadedVideoId = state.videoId
            var urlStr = "https://www.youtube.com/watch?v=\(state.videoId)"
            if let seek = state.seekToSeconds, seek > 0 {
                urlStr += "&t=\(Int(seek))s"
            }
            if let url = URL(string: urlStr) {
                webView.load(URLRequest(url: url))
            }
        } else {
            // Apply play/pause, mute, playbackRate, and optional seek via JS
            var js = """
            (function() {
              const v = document.querySelector('video');
              if (!v) return;
              v.muted = \(state.isMuted ? "true" : "false");
              v.playbackRate = \(state.playbackRate);
            """
            if state.isPaused {
                js += "if (!v.paused) v.pause();"
            } else {
                js += "if (v.paused) v.play();"
            }
            if let seek = state.seekToSeconds {
                js += "if (Math.abs(v.currentTime - \(seek)) > 1.5) v.currentTime = \(seek);"
            }
            js += "})();"
            webView.evaluateJavaScript(js, completionHandler: nil)
        }
    }

    private func computeWindowRect(for state: PlayerState) -> NSRect {
        let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let pad: CGFloat = 18

        var width: CGFloat
        var height: CGFloat
        switch state.sizePreset.lowercased() {
        case "small", "mini", "sm":
            width = 340
            height = 222
        case "large", "lg", "xl":
            width = 640
            height = 390
        case "sidebar", "tall", "split":
            width = 460
            height = max(480, screen.height - pad * 2)
        default: // medium
            width = 460
            height = 290
        }

        if let cw = state.customWidth, let ch = state.customHeight, state.position == "custom" {
            width = CGFloat(cw)
            height = CGFloat(ch)
        }

        let pos = YouTubeParser.normalizePosition(state.position)
        var x: CGFloat
        var y: CGFloat

        switch pos {
        case "top-left":
            x = screen.minX + pad
            y = screen.maxY - height - pad
        case "top-center":
            x = screen.midX - width / 2
            y = screen.maxY - height - pad
        case "top-right":
            x = screen.maxX - width - pad
            y = screen.maxY - height - pad
        case "bottom-left":
            x = screen.minX + pad
            y = screen.minY + pad
        case "bottom-center":
            x = screen.midX - width / 2
            y = screen.minY + pad
        case "bottom-right":
            x = screen.maxX - width - pad
            y = screen.minY + pad
        case "left-side":
            x = screen.minX + pad
            y = screen.midY - height / 2
        case "right-side":
            x = screen.maxX - width - pad
            y = screen.midY - height / 2
        case "center":
            x = screen.midX - width / 2
            y = screen.midY - height / 2
        case "custom":
            x = CGFloat(state.customX ?? Double(screen.maxX - width - pad))
            y = CGFloat(state.customY ?? Double(screen.maxY - height - pad))
        default:
            // Support "x,y" or "x,y,w,h"
            let parts = pos.split(separator: ",").compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }
            if parts.count >= 2 {
                x = CGFloat(parts[0])
                y = CGFloat(parts[1])
                if parts.count >= 4 {
                    width = CGFloat(parts[2])
                    height = CGFloat(parts[3])
                }
            } else {
                x = screen.maxX - width - pad
                y = screen.maxY - height - pad
            }
        }

        return NSRect(x: x, y: y, width: width, height: height)
    }
}

// MARK: - CLI Entrypoint

func isDaemonRunning() -> Bool {
    let task = Process()
    task.executableURL = URL(fileURLWithPath: "/usr/bin/pgrep")
    task.arguments = ["-f", "yt-pip --daemon"]
    let pipe = Pipe()
    task.standardOutput = pipe
    try? task.run()
    task.waitUntilExit()
    return task.terminationStatus == 0
}

func ensureDaemonLaunched() {
    guard !isDaemonRunning() else { return }
    let execPath = CommandLine.arguments[0]
    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: execPath)
    proc.arguments = ["--daemon"]
    proc.standardOutput = FileHandle.nullDevice
    proc.standardError = FileHandle.nullDevice
    try? proc.run()
}

let args = Array(CommandLine.arguments.dropFirst())

if args.first == "--daemon" {
    let app = NSApplication.shared
    let delegate = MainActor.assumeIsolated { YTPiPAppDelegate() }
    app.delegate = delegate
    app.run()
    exit(0)
}

var state = PlayerState.load()
let subcommand = args.first?.lowercased() ?? "status"

switch subcommand {
case "play", "open":
    state.shouldQuit = false
    state.isPaused = false
    state.seekToSeconds = nil
    if args.count >= 2 {
        state.videoId = YouTubeParser.extractVideoId(from: args[1])
    }
    var i = 2
    while i < args.count {
        let flag = args[i]
        if flag == "--position" || flag == "-p", i + 1 < args.count {
            state.position = YouTubeParser.normalizePosition(args[i + 1])
            i += 2
        } else if flag == "--size" || flag == "-s", i + 1 < args.count {
            state.sizePreset = args[i + 1].lowercased()
            i += 2
        } else if flag == "--title" || flag == "-t", i + 1 < args.count {
            state.title = args[i + 1]
            i += 2
        } else if flag == "--opacity" || flag == "-o", i + 1 < args.count, let v = Double(args[i + 1]) {
            state.opacity = max(0.25, min(1.0, v))
            i += 2
        } else {
            i += 1
        }
    }
    state.commandSeq += 1
    state.updatedAt = Date().timeIntervalSince1970
    state.save()
    ensureDaemonLaunched()

case "position", "pos", "move":
    state.shouldQuit = false
    if args.count >= 2 {
        let rawPos = args[1]
        let normalized = YouTubeParser.normalizePosition(rawPos)
        state.position = normalized
        if normalized == "right-side" || normalized == "left-side" {
            if args.count >= 3 {
                state.sizePreset = args[2].lowercased()
            }
        }
        let coords = rawPos.split(separator: ",").compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }
        if coords.count >= 2 {
            state.position = "custom"
            state.customX = coords[0]
            state.customY = coords[1]
            if coords.count >= 4 {
                state.customWidth = coords[2]
                state.customHeight = coords[3]
            }
        }
    }
    state.commandSeq += 1
    state.updatedAt = Date().timeIntervalSince1970
    state.save()
    ensureDaemonLaunched()

case "size":
    if args.count >= 2 {
        state.sizePreset = args[1].lowercased()
    }
    state.commandSeq += 1
    state.updatedAt = Date().timeIntervalSince1970
    state.save()
    ensureDaemonLaunched()

case "pause":
    state.isPaused = true
    state.commandSeq += 1
    state.updatedAt = Date().timeIntervalSince1970
    state.save()

case "resume":
    state.isPaused = false
    state.commandSeq += 1
    state.updatedAt = Date().timeIntervalSince1970
    state.save()
    ensureDaemonLaunched()

case "toggle":
    state.isPaused.toggle()
    state.commandSeq += 1
    state.updatedAt = Date().timeIntervalSince1970
    state.save()

case "mute":
    state.isMuted = true
    state.commandSeq += 1
    state.updatedAt = Date().timeIntervalSince1970
    state.save()

case "unmute":
    state.isMuted = false
    state.commandSeq += 1
    state.updatedAt = Date().timeIntervalSince1970
    state.save()

case "rate", "speed":
    if args.count >= 2, let r = Double(args[1]) {
        state.playbackRate = max(0.25, min(3.0, r))
    }
    state.commandSeq += 1
    state.updatedAt = Date().timeIntervalSince1970
    state.save()

case "opacity":
    if args.count >= 2, let o = Double(args[1]) {
        state.opacity = max(0.25, min(1.0, o))
    }
    state.commandSeq += 1
    state.updatedAt = Date().timeIntervalSince1970
    state.save()

case "seek":
    if args.count >= 2, let s = Double(args[1]) {
        state.seekToSeconds = max(0, s)
    }
    state.commandSeq += 1
    state.updatedAt = Date().timeIntervalSince1970
    state.save()

case "stop", "quit", "close":
    state.shouldQuit = true
    state.updatedAt = Date().timeIntervalSince1970
    state.save()

default: // status
    break
}

let encoder = JSONEncoder()
encoder.outputFormatting = [.sortedKeys]
if let out = try? encoder.encode(state), let str = String(data: out, encoding: .utf8) {
    print(str)
}
